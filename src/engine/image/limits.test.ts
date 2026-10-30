import { describe, expect, it } from "vitest";
import { ImageLoadError, loadImageFile } from "./load";
import {
  MAX_CANVAS_SIDE,
  MAX_IMAGE_PIXELS,
  checkImageSize,
  describeSize,
  readImageSize,
} from "./limits";

// ---- tiny image headers, built by hand so no binary fixtures are committed ----
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

const png = (w: number, h: number) =>
  new Uint8Array([
    0x89,
    ...text("PNG"),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    ...text("IHDR"),
    ...u32(w),
    ...u32(h),
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);

function jpeg(w: number, h: number, opts: { sof?: number; exifBytes?: number } = {}) {
  const app1 = opts.exifBytes
    ? [0xff, 0xe1, ...u16(opts.exifBytes + 2), ...new Array(opts.exifBytes).fill(0x45)]
    : [];
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...u16(16),
    ...text("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    ...app1,
    0xff,
    0xc4,
    ...u16(5),
    0,
    1,
    2, // a Huffman table: must not be mistaken for the frame header
    0xff,
    opts.sof ?? 0xc0,
    ...u16(17),
    8,
    ...u16(h),
    ...u16(w),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xda,
  ]);
}

const riff = (...rest: number[]) =>
  new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...rest]);
const webpX = (w: number, h: number) =>
  riff(...text("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1));
const webpL = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riff(
    ...text("VP8L"),
    5,
    0,
    0,
    0,
    0x2f,
    bits & 255,
    (bits >>> 8) & 255,
    (bits >>> 16) & 255,
    (bits >>> 24) & 255,
  );
};
const webpLossy = (w: number, h: number) =>
  riff(...text("VP8 "), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h));

describe("readImageSize", () => {
  it("reads PNG", () =>
    expect(readImageSize(png(4032, 3024))).toEqual({ width: 4032, height: 3024 }));

  it("reads a PNG that claims a huge size, without decoding it", () => {
    expect(readImageSize(png(60000, 60000))).toEqual({ width: 60000, height: 60000 });
  });

  it("reads JPEG (baseline and progressive)", () => {
    expect(readImageSize(jpeg(6000, 4000))).toEqual({ width: 6000, height: 4000 });
    expect(readImageSize(jpeg(6000, 4000, { sof: 0xc2 }))).toEqual({ width: 6000, height: 4000 });
  });

  it("finds the JPEG size after a large EXIF block", () => {
    expect(readImageSize(jpeg(8000, 6000, { exifBytes: 40000 }))).toEqual({
      width: 8000,
      height: 6000,
    });
  });

  it("reads all three WebP layouts", () => {
    expect(readImageSize(webpX(5000, 3000))).toEqual({ width: 5000, height: 3000 });
    expect(readImageSize(webpL(1234, 777))).toEqual({ width: 1234, height: 777 });
    expect(readImageSize(webpLossy(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("returns null for things that aren't a recognisable image, or are cut short", () => {
    expect(readImageSize(new Uint8Array([]))).toBeNull();
    expect(readImageSize(new Uint8Array(text("hello world, not an image at all")))).toBeNull();
    expect(readImageSize(png(10, 10).slice(0, 20))).toBeNull();
    expect(readImageSize(jpeg(10, 10).slice(0, 30))).toBeNull();
    expect(readImageSize(webpX(10, 10).slice(0, 20))).toBeNull();
  });
});

describe("checkImageSize", () => {
  it("accepts ordinary photos and the exact limit", () => {
    expect(checkImageSize(4032, 3024).ok).toBe(true);
    expect(checkImageSize(10000, 10000).ok).toBe(true);
    expect(checkImageSize(MAX_CANVAS_SIDE, 3000).ok).toBe(true); // a long panorama is fine
  });

  it("rejects too many pixels, with a message a person can act on", () => {
    const check = checkImageSize(12000, 9000);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.message).toContain("12,000 × 9,000 (108 MP)");
      expect(check.message).toContain(`${MAX_IMAGE_PIXELS / 1_000_000} MP`);
      expect(check.message).not.toMatch(/error|exception|undefined/i);
    }
    expect(checkImageSize(10000, 10001).ok).toBe(false);
  });

  it("rejects a side no browser canvas can have", () => {
    expect(checkImageSize(MAX_CANVAS_SIDE + 1, 100).ok).toBe(false);
  });

  it("describes sizes with thousands separators and megapixels", () => {
    expect(describeSize(4032, 3024)).toBe("4,032 × 3,024 (12.2 MP)");
  });
});

describe("loadImageFile", () => {
  it("refuses an oversized photo from its header, before trying to decode it", async () => {
    // Node has no `Image`, so reaching the decoder would throw a ReferenceError instead.
    const bomb = new File([png(60000, 60000)], "scan.png", { type: "image/png" });
    await expect(loadImageFile(bomb)).rejects.toBeInstanceOf(ImageLoadError);
    await expect(loadImageFile(bomb)).rejects.toThrow(/larger than Pictoe can open/);
  });

  it("still rejects unsupported file types first", async () => {
    const gif = new File([new Uint8Array([71, 73, 70])], "a.gif", { type: "image/gif" });
    await expect(loadImageFile(gif)).rejects.toThrow(/supports JPG, PNG and WebP/);
  });
});
