import { describe, expect, it } from "vitest";
import {
  MARKER,
  MAX_SEGMENT_PAYLOAD,
  buildExifSegment,
  buildSegment,
  findExifPayload,
  isExifSegment,
  isJpeg,
  readJpegLayout,
  withExifSegment,
} from "./jpegSegments";
import { cameraBigEndian, canvasOutput } from "./photoInfo.fixtures";

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const bytes = (...n: number[]) => Uint8Array.from(n);
const SOI = bytes(0xff, 0xd8);
/** A minimal "picture" part: a start-of-scan header and some data, then the end marker. */
const SCAN = bytes(0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9);

describe("readJpegLayout", () => {
  it("walks the segments of a real JPEG up to the picture data", () => {
    const file = canvasOutput();
    const layout = readJpegLayout(file)!;
    expect(layout.complete).toBe(true);
    expect(layout.segments[0]!.marker).toBe(MARKER.APP0);
    expect(layout.segments.at(-1)!.marker).toBe(MARKER.SOS);
    expect(file[layout.scanStart]).toBe(0xff);
    expect(file[layout.scanStart + 1]).toBe(MARKER.SOS);
  });

  it("finds the EXIF segment of a camera file, once", () => {
    const file = cameraBigEndian();
    const layout = readJpegLayout(file)!;
    expect(layout.segments.filter((s) => isExifSegment(file, s))).toHaveLength(1);
    const tiff = findExifPayload(file, layout)!;
    expect(String.fromCharCode(tiff[0]!, tiff[1]!)).toBe("MM");
  });

  it("finds no EXIF in a file without any", () => {
    const file = canvasOutput();
    expect(findExifPayload(file, readJpegLayout(file)!)).toBeNull();
  });

  it("says what it can't read instead of guessing", () => {
    expect(readJpegLayout(new Uint8Array())).toBeNull();
    expect(readJpegLayout(bytes(1, 2, 3, 4, 5))).toBeNull();
    expect(readJpegLayout(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull(); // a PNG
    expect(isJpeg(bytes(0xff, 0xd8))).toBe(false); // too short to be one
  });

  it("calls a file that ends before its picture data incomplete", () => {
    const file = canvasOutput();
    const layout = readJpegLayout(file.subarray(0, 40))!;
    expect(layout.complete).toBe(false);
  });

  it("rejects a segment that says it is shorter than its own length field", () => {
    expect(readJpegLayout(concat(SOI, bytes(0xff, 0xe1, 0x00, 0x01), SCAN))).toBeNull();
  });

  it("rejects a stuffed zero where a marker must be, and bytes that aren't a marker", () => {
    expect(readJpegLayout(concat(SOI, bytes(0xff, 0x00, 0x00, 0x00)))).toBeNull();
    expect(
      readJpegLayout(concat(SOI, bytes(0xff, 0xe0, 0x00, 0x02), bytes(0x12, 0x34, 0x56))),
    ).toBeNull();
  });

  it("skips fill bytes and stand-alone markers", () => {
    const file = concat(
      SOI,
      bytes(0xff, 0xff, 0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb),
      bytes(0xff, 0x01),
      SCAN,
    );
    const layout = readJpegLayout(file)!;
    expect(layout.segments.map((s) => s.marker)).toEqual([0xe0, 0x01, MARKER.SOS]);
  });

  it("never runs past the end of a segment that claims to be longer than the file", () => {
    const layout = readJpegLayout(concat(SOI, bytes(0xff, 0xe1, 0xff, 0xff, 0x01, 0x02)))!;
    expect(layout.complete).toBe(false);
    expect(layout.segments).toHaveLength(0);
  });
});

describe("buildSegment / buildExifSegment", () => {
  it("writes the marker, a length that includes itself, and the payload", () => {
    expect(Array.from(buildSegment(0xe1, bytes(9, 8, 7)))).toEqual([
      0xff, 0xe1, 0x00, 0x05, 9, 8, 7,
    ]);
  });
  it("refuses a payload that can't fit in one segment", () => {
    expect(() => buildSegment(0xe1, new Uint8Array(MAX_SEGMENT_PAYLOAD + 1))).toThrow(RangeError);
    expect(buildSegment(0xe1, new Uint8Array(MAX_SEGMENT_PAYLOAD))).toHaveLength(0xffff + 2);
  });
  it("starts an EXIF segment with the EXIF header", () => {
    const seg = buildExifSegment(bytes(1, 2));
    expect(String.fromCharCode(...seg.subarray(4, 8))).toBe("Exif");
  });
});

describe("withExifSegment", () => {
  const exif = buildExifSegment(bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00));
  const pictureOf = (file: Uint8Array) => file.subarray(readJpegLayout(file)!.scanStart);

  it("puts the segment after the JFIF segment and leaves the picture bytes alone", () => {
    const before = canvasOutput();
    const after = withExifSegment(before, exif);
    const layout = readJpegLayout(after)!;
    expect(layout.segments[0]!.marker).toBe(MARKER.APP0);
    expect(isExifSegment(after, layout.segments[1]!)).toBe(true);
    expect(Array.from(pictureOf(after))).toEqual(Array.from(pictureOf(before)));
    expect(after.length).toBe(before.length + exif.length);
  });

  it("puts it right after the start marker when there is no JFIF segment", () => {
    const file = concat(SOI, bytes(0xff, 0xdb, 0x00, 0x03, 0x00), SCAN);
    const after = withExifSegment(file, exif);
    expect(isExifSegment(after, readJpegLayout(after)!.segments[0]!)).toBe(true);
  });

  it("replaces EXIF the file already had, so there is exactly one", () => {
    const camera = cameraBigEndian();
    const after = withExifSegment(camera, exif);
    const layout = readJpegLayout(after)!;
    expect(layout.segments.filter((s) => isExifSegment(after, s))).toHaveLength(1);
    expect(after.length).toBeLessThan(camera.length); // the old thumbnail and maker note are gone
    expect(Array.from(pictureOf(after))).toEqual(Array.from(pictureOf(camera)));
  });

  it("is idempotent", () => {
    const once = withExifSegment(canvasOutput(), exif);
    expect(Array.from(withExifSegment(once, exif))).toEqual(Array.from(once));
  });

  it("hands back the same bytes when it isn't a JPEG it can walk", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0);
    expect(withExifSegment(png, exif)).toBe(png);
  });
});
