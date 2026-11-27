import { describe, expect, it } from "vitest";
import {
  addPhotoInfoToJpeg,
  buildPhotoInfoSegment,
  describePhotoInfo,
  hasLocation,
  parsePhotoInfo,
  photoInfoChoice,
  photoInfoExportOptions,
  readPhotoInfo,
  readPhotoInfoFromBytes,
  withPhotoInfo,
  type PhotoInfo,
} from "./photoInfo";
import { findExifPayload, isExifSegment, readJpegLayout } from "./jpegSegments";
import {
  NEVER_EXPORTED,
  cameraBigEndian,
  cameraLittleEndian,
  canvasOutput,
} from "./photoInfo.fixtures";

const SIZE = { width: 40, height: 30 };
const off = { ...SIZE, includeLocation: false };
const on = { ...SIZE, includeLocation: true };

const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

/**
 * A reader written for these tests that does NOT filter: it lists every tag actually present in
 * the file's EXIF, so a test can prove something is absent rather than merely not parsed.
 */
function allTags(file: Uint8Array) {
  const layout = readJpegLayout(file)!;
  const tiff = findExifPayload(file, layout)!;
  const little = text(tiff.subarray(0, 2)) === "II";
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const read = (at: number) => {
    const n = v.getUint16(at, little);
    const tags = new Map<number, { type: number; count: number; raw: Uint8Array; at: number }>();
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const type = v.getUint16(e + 2, little);
      const count = v.getUint32(e + 4, little);
      const size =
        ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type]! * count;
      const start = size > 4 ? v.getUint32(e + 8, little) : e + 8;
      tags.set(v.getUint16(e, little), {
        type,
        count,
        raw: tiff.slice(start, start + size),
        at: e,
      });
    }
    return { tags, next: v.getUint32(at + 2 + n * 12, little) };
  };
  const ifd0 = read(v.getUint32(4, little));
  const ptr = (t: number) => (ifd0.tags.has(t) ? v.getUint32(ifd0.tags.get(t)!.at + 8, little) : 0);
  return {
    little,
    ifd0: ifd0.tags,
    exif: ptr(0x8769) ? read(ptr(0x8769)).tags : new Map(),
    gps: ptr(0x8825) ? read(ptr(0x8825)).tags : new Map(),
    nextAfterIfd0: ifd0.next,
    tiff,
  };
}
const u16 = (e: { raw: Uint8Array }, little: boolean) =>
  new DataView(e.raw.buffer, e.raw.byteOffset).getUint16(0, little);
const u32 = (e: { raw: Uint8Array }, little: boolean) =>
  new DataView(e.raw.buffer, e.raw.byteOffset).getUint32(0, little);

function exported(source: Uint8Array, options = off) {
  const info = readPhotoInfoFromBytes(source)!;
  return addPhotoInfoToJpeg(canvasOutput(), info, options);
}

describe.each([
  ["big-endian", cameraBigEndian],
  ["little-endian", cameraLittleEndian],
])("reading and exporting a %s camera file", (_name, load) => {
  it("reads the camera, exposure, date and artist details", () => {
    const info = readPhotoInfoFromBytes(load())!;
    expect(describePhotoInfo(info)).toBe("camera, exposure, date, artist and copyright");
    expect(hasLocation(info)).toBe(true);
  });

  it("writes the allowed details into the export, with the right values", () => {
    const out = exported(load());
    const t = allTags(out);
    expect(text(t.ifd0.get(0x010f)!.raw)).toBe("TestCam\0");
    expect(text(t.ifd0.get(0x0110)!.raw)).toBe("TC-1000 Pro\0");
    expect(text(t.ifd0.get(0x013b)!.raw)).toBe("Adnan Ansari\0");
    expect(text(t.ifd0.get(0x8298)!.raw)).toBe("(c) 2026 Adnan\0");
    expect(u16(t.exif.get(0x8827)!, t.little)).toBe(400); // ISO
    expect(text(t.exif.get(0x9003)!.raw)).toBe("2026:11:01 09:59:58\0");
    expect(text(t.exif.get(0xa434)!.raw)).toBe("TC 50mm f/1.8 Lens\0");
  });

  it("describes the exported picture, not the original", () => {
    const t = allTags(exported(load()));
    expect(u16(t.ifd0.get(0x0112)!, t.little)).toBe(1); // upright: the pixels already are
    expect(u32(t.exif.get(0xa002)!, t.little)).toBe(40);
    expect(u32(t.exif.get(0xa003)!, t.little)).toBe(30);
    expect(u16(t.exif.get(0xa001)!, t.little)).toBe(1); // sRGB
  });

  it("leaves out everything that identifies or isn't allowed", () => {
    const out = exported(load());
    const raw = text(out);
    for (const secret of NEVER_EXPORTED) expect(raw).not.toContain(secret);
    const t = allTags(out);
    for (const tag of [0x010e, 0x0131, 0x0132]) expect(t.ifd0.has(tag)).toBe(false); // caption, software, modified
    for (const tag of [0x927c, 0x9286, 0xa430, 0xa431, 0xa435]) expect(t.exif.has(tag)).toBe(false);
    expect(t.nextAfterIfd0).toBe(0); // no second block, so no thumbnail
    expect(out.filter((_, i) => out[i] === 0xff && out[i + 1] === 0xd8)).toHaveLength(1);
  });

  it("writes no location at all unless asked: not even an empty GPS block", () => {
    const t = allTags(exported(load(), off));
    expect(t.gps.size).toBe(0);
    expect(t.ifd0.has(0x8825)).toBe(false);
    expect(text(exported(load(), off))).not.toContain("GPS");
  });

  it("writes the location, with the source's own values, when asked", () => {
    const src = allTags(load());
    const t = allTags(exported(load(), on));
    expect(t.gps.size).toBeGreaterThan(0);
    for (const tag of [0x01, 0x02, 0x03, 0x04, 0x06]) {
      expect(Array.from(t.gps.get(tag)!.raw)).toEqual(Array.from(src.gps.get(tag)!.raw));
    }
  });

  it("is a well-formed JPEG with one EXIF segment and the picture untouched", () => {
    const out = exported(load(), on);
    const layout = readJpegLayout(out)!;
    expect(layout.complete).toBe(true);
    expect(layout.segments.filter((s) => isExifSegment(out, s))).toHaveLength(1);
    const pic = (f: Uint8Array) => Array.from(f.subarray(readJpegLayout(f)!.scanStart));
    expect(pic(out)).toEqual(pic(canvasOutput()));
  });

  it("can be read back, so a round trip loses nothing allowed", () => {
    const again = readPhotoInfoFromBytes(exported(load(), on))!;
    expect(describePhotoInfo(again)).toBe("camera, exposure, date, artist and copyright");
    expect(hasLocation(again)).toBe(true);
    // and exporting that again changes nothing
    expect(Array.from(addPhotoInfoToJpeg(canvasOutput(), again, on))).toEqual(
      Array.from(exported(load(), on)),
    );
  });
});

describe("what there is to read", () => {
  it("finds nothing in a file with no EXIF, or that isn't a JPEG", () => {
    expect(readPhotoInfoFromBytes(canvasOutput())).toBeNull();
    expect(readPhotoInfoFromBytes(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4))).toBeNull();
    expect(readPhotoInfoFromBytes(new Uint8Array())).toBeNull();
  });

  it("says no location when the GPS block lacks latitude or longitude", () => {
    const info = readPhotoInfoFromBytes(cameraBigEndian())!;
    expect(hasLocation({ ...info, gps: [] })).toBe(false);
    expect(hasLocation({ ...info, gps: info.gps.filter((e) => e.tag !== 0x04) })).toBe(false);
  });

  it("keeps the rest of the info when location is switched off, and hasLocation stays true for the source", () => {
    const info = readPhotoInfoFromBytes(cameraBigEndian())!;
    expect(hasLocation(info)).toBe(true);
    expect(buildPhotoInfoSegment(info, off)).not.toBeNull();
  });
});

describe("damaged and hostile files", () => {
  const tiffOf = (file: Uint8Array) => allTags(file).tiff;

  it("rejects EXIF data that is too short or has no valid header", () => {
    expect(parsePhotoInfo(new Uint8Array(4))).toBeNull();
    expect(parsePhotoInfo(Uint8Array.from([0x58, 0x58, 0x2a, 0, 8, 0, 0, 0]))).toBeNull();
    expect(parsePhotoInfo(Uint8Array.from([0x49, 0x49, 0x2b, 0, 8, 0, 0, 0]))).toBeNull();
  });

  it("copes with offsets that point outside the data, or back at themselves", () => {
    const tiff = tiffOf(cameraBigEndian()).slice();
    const v = new DataView(tiff.buffer);
    v.setUint32(4, 0xfffffff0, false); // first block far outside the data
    expect(parsePhotoInfo(tiff)).toBeNull();
    const loop = tiffOf(cameraBigEndian()).slice();
    new DataView(loop.buffer).setUint32(4, 4, false); // the first block "starts" in the header
    expect(parsePhotoInfo(loop)).toBeNull();
  });

  it("skips a value whose offset points outside the data, instead of reading a short one", () => {
    const make = (tweak: (view: DataView, at: number, size: number) => void) => {
      const tiff = tiffOf(cameraBigEndian()).slice();
      const entry = allTags(cameraBigEndian()).ifd0.get(0x010f)!; // Make: 8 bytes, stored by offset
      tweak(new DataView(tiff.buffer), entry.at, tiff.length);
      return parsePhotoInfo(tiff)!;
    };
    expect(make(() => {}).ifd0.some((e) => e.tag === 0x010f)).toBe(true); // the untouched file has it
    // far outside the data
    expect(
      make((v, at) => v.setUint32(at + 8, 0xffffff00, false)).ifd0.some((e) => e.tag === 0x010f),
    ).toBe(false);
    // starts inside but runs one byte past the end
    expect(
      make((v, at, len) => v.setUint32(at + 8, len - 7, false)).ifd0.some((e) => e.tag === 0x010f),
    ).toBe(false);
    // starts inside the header
    expect(make((v, at) => v.setUint32(at + 8, 2, false)).ifd0.some((e) => e.tag === 0x010f)).toBe(
      false,
    );
  });

  it("skips a value bigger than any allowed tag needs, even when the data really is there", () => {
    const original = tiffOf(cameraBigEndian());
    const lens = allTags(cameraBigEndian()).exif.get(0xa434)!;
    const grown = new Uint8Array(original.length + 5000).fill(65);
    grown.set(original, 0);
    const v = new DataView(grown.buffer);
    v.setUint32(lens.at + 4, 5000, false); // count
    v.setUint32(lens.at + 8, original.length, false); // offset: inside the data, at the filler
    const info = parsePhotoInfo(grown)!;
    expect(info.exif.some((e) => e.tag === 0xa434)).toBe(false);
    expect(info.exif.some((e) => e.tag === 0x829a)).toBe(true); // the rest is still read
  });

  it("skips a value whose declared size is huge instead of allocating it", () => {
    const tiff = tiffOf(cameraBigEndian()).slice();
    const v = new DataView(tiff.buffer);
    const first = v.getUint32(4, false);
    v.setUint32(first + 2 + 4, 0xffffffff, false); // the first entry now claims 4 billion values
    expect(() => parsePhotoInfo(tiff)).not.toThrow();
  });

  it("never throws on randomly damaged EXIF, and only ever writes tags from the allowed list", () => {
    // Written from the spec, not taken from the code under test.
    const allowed = {
      ifd0: [
        0x010f, 0x0110, 0x0112, 0x011a, 0x011b, 0x0128, 0x013b, 0x0213, 0x8298, 0x8769, 0x8825,
      ],
      exif: [
        0x829a, 0x829d, 0x8822, 0x8827, 0x9000, 0x9003, 0x9004, 0x9010, 0x9011, 0x9012, 0x9101,
        0x9201, 0x9202, 0x9204, 0x9205, 0x9207, 0x9208, 0x9209, 0x920a, 0x9290, 0x9291, 0x9292,
        0xa000, 0xa001, 0xa002, 0xa003, 0xa402, 0xa403, 0xa404, 0xa405, 0xa406, 0xa432, 0xa433,
        0xa434,
      ],
      gps: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x10, 0x11, 0x1d],
    };
    const base = tiffOf(cameraBigEndian());
    let seed = 12345;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    let written = 0;
    for (let round = 0; round < 400; round++) {
      const t = base.slice();
      for (let k = 0; k < 1 + Math.floor(rand() * 8); k++)
        t[Math.floor(rand() * t.length)] = Math.floor(rand() * 256);
      const cut = rand() < 0.2 ? t.subarray(0, Math.floor(rand() * t.length)) : t;
      const info = parsePhotoInfo(cut);
      if (!info) continue;
      const out = addPhotoInfoToJpeg(canvasOutput(), info, on);
      expect(readJpegLayout(out)?.complete).toBe(true);
      const tags = allTags(out);
      expect(tags.nextAfterIfd0).toBe(0);
      for (const tag of tags.ifd0.keys()) expect(allowed.ifd0).toContain(tag);
      for (const tag of tags.exif.keys()) expect(allowed.exif).toContain(tag);
      for (const tag of tags.gps.keys()) expect(allowed.gps).toContain(tag);
      written++;
    }
    expect(written).toBeGreaterThan(100); // the damage often leaves something readable
  });

  it("never throws on a randomly damaged JPEG", () => {
    const base = cameraBigEndian();
    let seed = 99;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let round = 0; round < 400; round++) {
      const f = base.slice();
      for (let k = 0; k < 1 + Math.floor(rand() * 6); k++)
        f[Math.floor(rand() * 400)] = Math.floor(rand() * 256);
      expect(() => readPhotoInfoFromBytes(f)).not.toThrow();
    }
  });

  it("writes nothing, and hands the JPEG back as it was, when the info would not fit in one segment", () => {
    const value = new Uint8Array(4000).fill(65);
    const huge: PhotoInfo = {
      little: true,
      ifd0: [],
      exif: [
        0x9003, 0x9004, 0xa434, 0xa433, 0x9010, 0x9011, 0x9012, 0x9290, 0x9291, 0x9292, 0xa432,
        0x9209, 0x9208, 0x9207, 0x9205, 0x9204, 0x9202, 0x9201, 0x920a, 0xa405,
      ].map((tag) => ({ tag, type: 2, count: 4000, value })),
      gps: [],
    };
    expect(buildPhotoInfoSegment(huge, off)).toBeNull();
    const jpeg = canvasOutput();
    expect(addPhotoInfoToJpeg(jpeg, huge, off)).toBe(jpeg);
  });

  it("hands back a file that isn't a JPEG unchanged", () => {
    const info = readPhotoInfoFromBytes(cameraBigEndian())!;
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0);
    expect(addPhotoInfoToJpeg(png, info, off)).toBe(png);
  });
});

describe("the Blob helpers", () => {
  const blobOf = (b: Uint8Array, type = "image/jpeg") => new Blob([b as BlobPart], { type });

  it("reads photo info from a JPEG file, and from nothing else", async () => {
    expect(await readPhotoInfo(blobOf(cameraBigEndian()))).not.toBeNull();
    expect(await readPhotoInfo(blobOf(cameraBigEndian(), "image/png"))).toBeNull();
    expect(await readPhotoInfo(blobOf(canvasOutput()))).toBeNull();
  });

  it("adds photo info to an exported JPEG blob", async () => {
    const info = (await readPhotoInfo(blobOf(cameraBigEndian())))!;
    const out = await withPhotoInfo(blobOf(canvasOutput()), info, off);
    expect(out.type).toBe("image/jpeg");
    const bytes = new Uint8Array(await out.arrayBuffer());
    expect(readPhotoInfoFromBytes(bytes)).not.toBeNull();
  });

  it("gives the same blob back when it can't add anything", async () => {
    const info = (await readPhotoInfo(blobOf(cameraBigEndian())))!;
    const notJpeg = blobOf(Uint8Array.of(1, 2, 3, 4), "image/png");
    expect(await withPhotoInfo(notJpeg, info, off)).toBe(notJpeg);
  });
});

describe("what the Export panel offers", () => {
  const info = () => readPhotoInfoFromBytes(cameraBigEndian())!;

  it("is available for a JPEG export of a photo that has info, and says what is in it", () => {
    expect(photoInfoChoice("image/jpeg", info())).toEqual({
      kind: "available",
      summary: "camera, exposure, date, artist and copyright",
      hasLocation: true,
    });
  });

  it("says why it isn't available", () => {
    expect(photoInfoChoice("image/png", info())).toMatchObject({ kind: "unavailable" });
    expect(photoInfoChoice("image/webp", info())).toMatchObject({ kind: "unavailable" });
    expect(photoInfoChoice("image/jpeg", null)).toMatchObject({
      kind: "unavailable",
      reason: "This photo has no camera information to keep.",
    });
    expect(photoInfoChoice("image/jpeg", undefined)).toMatchObject({ kind: "unavailable" });
  });

  it("only mentions location for a photo that has some", () => {
    const noGps = { ...info(), gps: [] };
    expect(photoInfoChoice("image/jpeg", noGps)).toMatchObject({
      kind: "available",
      hasLocation: false,
    });
  });

  it("writes nothing unless the info is kept", () => {
    expect(photoInfoExportOptions(false, true, info(), SIZE)).toBeNull();
    expect(photoInfoExportOptions(true, false, null, SIZE)).toBeNull();
    expect(photoInfoExportOptions(true, true, undefined, SIZE)).toBeNull();
  });

  it("writes location only when both switches are on and the photo has some", () => {
    expect(photoInfoExportOptions(true, false, info(), SIZE)).toEqual({
      ...SIZE,
      includeLocation: false,
    });
    expect(photoInfoExportOptions(true, true, info(), SIZE)).toEqual({
      ...SIZE,
      includeLocation: true,
    });
    expect(photoInfoExportOptions(true, true, { ...info(), gps: [] }, SIZE)).toEqual({
      ...SIZE,
      includeLocation: false,
    });
    // the location switch alone, without keeping the info, writes nothing at all
    expect(photoInfoExportOptions(false, true, info(), SIZE)).toBeNull();
  });
});
