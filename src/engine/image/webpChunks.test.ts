import { describe, expect, it } from "vitest";
import { findWebpExif, isWebp, withExifWebpChunk } from "./webpChunks";
import { bytesReader } from "./rangeReader";
import {
  cameraWebp,
  canvasAlphaLosslessWebp,
  canvasAlphaWebp,
  canvasLosslessWebp,
  canvasLossyWebp,
} from "./photoInfo.fixtures";

const SIZE = { width: 40, height: 30 };
const TIFF = Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (n: number) =>
  Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
const chunk = (type: string, data: Uint8Array) =>
  concat(
    ascii(type),
    u32(data.length),
    data,
    data.length % 2 ? Uint8Array.of(0) : new Uint8Array(),
  );
const riff = (...chunks: Uint8Array[]) => {
  const body = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), u32(body.length), body);
};

type Chunk = { type: string; data: Uint8Array };
function chunksOf(webp: Uint8Array): { chunks: Chunk[]; end: number } {
  const chunks: Chunk[] = [];
  let pos = 12;
  const v = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  while (pos < webp.length) {
    const n = v.getUint32(pos + 4, true);
    chunks.push({
      type: String.fromCharCode(...webp.subarray(pos, pos + 4)),
      data: webp.subarray(pos + 8, pos + 8 + n),
    });
    pos += 8 + n + (n & 1);
  }
  return { chunks, end: pos };
}
const imageChunks = (webp: Uint8Array) =>
  chunksOf(webp)
    .chunks.filter((c) => ["VP8 ", "VP8L", "ALPH"].includes(c.type))
    .map((c) => [c.type, Array.from(c.data)]);
const canvas = (webp: Uint8Array) => {
  const x = chunksOf(webp).chunks[0]!.data;
  return {
    width: (x[4]! | (x[5]! << 8) | (x[6]! << 16)) + 1,
    height: (x[7]! | (x[8]! << 8) | (x[9]! << 16)) + 1,
    flags: x[0]!,
  };
};

describe("isWebp", () => {
  it("recognises RIFF/WEBP", () => {
    expect(isWebp(canvasLossyWebp())).toBe(true);
    expect(isWebp(ascii("RIFF....WAVE"))).toBe(false);
    expect(isWebp(new Uint8Array(8))).toBe(false);
  });
});

describe("findWebpExif", () => {
  it("finds the camera data of a real WebP, as TIFF", async () => {
    const tiff = (await findWebpExif(bytesReader(cameraWebp())))!;
    expect(["II", "MM"]).toContain(String.fromCharCode(tiff[0]!, tiff[1]!));
  });
  it("finds nothing when there is none", async () => {
    for (const f of [canvasLossyWebp, canvasLosslessWebp, canvasAlphaWebp]) {
      expect(await findWebpExif(bytesReader(f()))).toBeNull();
    }
  });
  it("drops the Exif header some writers add", async () => {
    const withHeader = riff(
      chunk("VP8L", new Uint8Array(5)),
      chunk("EXIF", concat(ascii("Exif\0\0"), TIFF)),
    );
    expect(Array.from((await findWebpExif(bytesReader(withHeader)))!)).toEqual(Array.from(TIFF));
  });
  it("finds nothing in a damaged or truncated file", async () => {
    const w = cameraWebp();
    expect(await findWebpExif(bytesReader(w.subarray(0, 30)))).toBeNull();
    const lying = w.slice();
    new DataView(lying.buffer).setUint32(16, 0xfffffff0, true); // the first chunk claims to run far past the end
    expect(await findWebpExif(bytesReader(lying))).toBeNull();
  });
});

describe("withExifWebpChunk", () => {
  it("turns a plain lossy WebP into an extended one, with the EXIF flag and the right size", () => {
    const before = canvasLossyWebp();
    expect(chunksOf(before).chunks.map((c) => c.type)).toEqual(["VP8 "]); // the plain layout
    const out = withExifWebpChunk(before, TIFF, SIZE);
    const { chunks, end } = chunksOf(out);
    expect(chunks.map((c) => c.type)).toEqual(["VP8X", "VP8 ", "EXIF"]);
    expect(canvas(out)).toEqual({ ...SIZE, flags: 0x08 });
    expect(imageChunks(out)).toEqual(imageChunks(before));
    expect(Array.from(chunks[2]!.data)).toEqual(Array.from(TIFF));
    expect(new DataView(out.buffer).getUint32(4, true) + 8).toBe(out.length); // RIFF size is right
    expect(end).toBe(out.length);
  });

  it("does the same for a lossless WebP", () => {
    const out = withExifWebpChunk(canvasLosslessWebp(), TIFF, SIZE);
    expect(chunksOf(out).chunks.map((c) => c.type)).toEqual(["VP8X", "VP8L", "EXIF"]);
    expect(canvas(out).flags & 0x08).toBe(0x08);
    expect(imageChunks(out)).toEqual(imageChunks(canvasLosslessWebp()));
  });

  it("sets the alpha flag when a plain lossless WebP says it uses alpha", () => {
    const before = canvasAlphaLosslessWebp();
    expect(chunksOf(before).chunks.map((c) => c.type)).toEqual(["VP8L"]);
    const out = withExifWebpChunk(before, TIFF, SIZE);
    expect(chunksOf(out).chunks.map((c) => c.type)).toEqual(["VP8X", "VP8L", "EXIF"]);
    expect(canvas(out).flags).toBe(0x18); // EXIF and alpha
    expect(canvas(withExifWebpChunk(canvasLosslessWebp(), TIFF, SIZE)).flags).toBe(0x08); // no alpha
  });

  it("keeps an existing extended header and its other flags, and adds the EXIF flag", () => {
    const before = canvasAlphaWebp();
    expect(canvas(before).flags & 0x10).toBe(0x10); // alpha
    const out = withExifWebpChunk(before, TIFF, SIZE);
    expect(chunksOf(out).chunks.map((c) => c.type)).toEqual(["VP8X", "ALPH", "VP8 ", "EXIF"]);
    expect(canvas(out).flags).toBe(0x18); // alpha kept, EXIF added
    expect(imageChunks(out)).toEqual(imageChunks(before));
  });

  it("replaces an EXIF chunk the file already had, so there is exactly one", () => {
    const out = withExifWebpChunk(cameraWebp(), TIFF, { width: 64, height: 48 });
    const exifs = chunksOf(out).chunks.filter((c) => c.type === "EXIF");
    expect(exifs).toHaveLength(1);
    expect(Array.from(exifs[0]!.data)).toEqual(Array.from(TIFF));
  });

  it("puts the EXIF chunk before any XMP chunk", () => {
    const vp8x = new Uint8Array(10);
    vp8x[4] = 39; // width 40
    vp8x[7] = 29; // height 30
    const withXmp = riff(
      chunk("VP8X", vp8x),
      chunk("VP8 ", chunksOf(canvasLossyWebp()).chunks[0]!.data),
      chunk("XMP ", ascii("<x/>")),
    );
    const types = chunksOf(withExifWebpChunk(withXmp, TIFF, SIZE)).chunks.map((c) => c.type);
    expect(types).toEqual(["VP8X", "VP8 ", "EXIF", "XMP "]);
  });

  it("pads odd-sized chunks to an even length, and the RIFF size stays right", () => {
    const odd = Uint8Array.from([...TIFF, 0]); // 15 bytes
    const out = withExifWebpChunk(canvasLossyWebp(), odd, SIZE);
    expect(out.length % 2).toBe(0);
    expect(chunksOf(out).end).toBe(out.length);
    expect(new DataView(out.buffer).getUint32(4, true) + 8).toBe(out.length);
  });

  it("is idempotent", () => {
    const once = withExifWebpChunk(canvasLossyWebp(), TIFF, SIZE);
    expect(Array.from(withExifWebpChunk(once, TIFF, SIZE))).toEqual(Array.from(once));
  });

  it("writes nothing when the stated size disagrees with the picture", () => {
    for (const f of [canvasLossyWebp(), canvasLosslessWebp(), canvasAlphaWebp()]) {
      expect(withExifWebpChunk(f, TIFF, { width: 41, height: 30 })).toBe(f);
      expect(withExifWebpChunk(f, TIFF, { width: 40, height: 31 })).toBe(f);
    }
  });

  it("leaves animated files, odd layouts and non-WebP bytes alone", () => {
    // The right size and the animation flag, so only the animation check can stop it.
    const header = new Uint8Array(10);
    header[0] = 0x02;
    header[4] = 39;
    header[7] = 29;
    const animated = riff(
      chunk("VP8X", header),
      chunk("ANIM", new Uint8Array(6)),
      chunk("ANMF", new Uint8Array(20)),
    );
    expect(withExifWebpChunk(animated, TIFF, SIZE)).toBe(animated);
    const two = riff(chunk("VP8 ", new Uint8Array(12)), chunk("VP8 ", new Uint8Array(12)));
    expect(withExifWebpChunk(two, TIFF, SIZE)).toBe(two);
    const empty = riff();
    expect(withExifWebpChunk(empty, TIFF, SIZE)).toBe(empty);
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(withExifWebpChunk(png, TIFF, SIZE)).toBe(png);
    const truncated = canvasLossyWebp().subarray(0, 20);
    expect(withExifWebpChunk(truncated, TIFF, SIZE)).toBe(truncated);
  });
});
