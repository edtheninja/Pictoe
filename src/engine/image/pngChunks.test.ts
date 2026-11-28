import { describe, expect, it } from "vitest";
import {
  MAX_EXIF_CHUNK_BYTES,
  PNG_SIGNATURE,
  crc32,
  findPngExif,
  isPng,
  stripExifPrefix,
  withExifChunk,
} from "./pngChunks";
import { bytesReader } from "./rangeReader";
import { cameraPng, canvasAlphaPng, canvasPng } from "./photoInfo.fixtures";

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

type Chunk = { type: string; data: Uint8Array; crc: number; raw: Uint8Array };
function chunksOf(png: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  let pos = 8;
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (pos < png.length) {
    const n = v.getUint32(pos, false);
    out.push({
      type: String.fromCharCode(...png.subarray(pos + 4, pos + 8)),
      data: png.subarray(pos + 8, pos + 8 + n),
      crc: v.getUint32(pos + 8 + n, false),
      raw: png.subarray(pos, pos + 12 + n),
    });
    pos += 12 + n;
  }
  return out;
}
const TIFF = Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });
  it("matches the CRC every PNG has on its end marker", () => {
    expect(crc32(ascii("IEND"))).toBe(0xae426082);
  });
  it("is zero-input safe", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("isPng / stripExifPrefix", () => {
  it("recognises the signature", () => {
    expect(isPng(Uint8Array.from(PNG_SIGNATURE))).toBe(true);
    expect(isPng(cameraPng())).toBe(true);
    expect(isPng(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0))).toBe(false);
    expect(isPng(new Uint8Array(4))).toBe(false);
  });
  it("drops the Exif header some writers add, and only that", () => {
    expect(Array.from(stripExifPrefix(Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0, 7, 8)))).toEqual([
      7, 8,
    ]);
    expect(Array.from(stripExifPrefix(Uint8Array.of(0x49, 0x49, 0x2a, 0)))).toEqual([
      0x49, 0x49, 0x2a, 0,
    ]);
  });
});

describe("findPngExif", () => {
  it("finds the camera data of a real PNG, as TIFF", async () => {
    const tiff = (await findPngExif(bytesReader(cameraPng())))!;
    expect(["II", "MM"]).toContain(String.fromCharCode(tiff[0]!, tiff[1]!));
  });
  it("finds nothing in a PNG without any", async () => {
    expect(await findPngExif(bytesReader(canvasPng()))).toBeNull();
  });
  it("finds nothing in a damaged or truncated file", async () => {
    const png = cameraPng();
    expect(await findPngExif(bytesReader(png.subarray(0, 20)))).toBeNull();
    expect(await findPngExif(bytesReader(png.subarray(0, 8)))).toBeNull();
    const lying = png.slice();
    new DataView(lying.buffer).setUint32(33, 0xfffffff0, false); // first chunk claims to run far past the end
    expect(await findPngExif(bytesReader(lying))).toBeNull();
  });
  it("refuses an EXIF chunk bigger than any photo info needs", async () => {
    const big = new Uint8Array(MAX_EXIF_CHUNK_BYTES + 1);
    const png = withExifChunk(canvasPng(), big);
    expect(await findPngExif(bytesReader(png))).toBeNull();
  });
  it("reads chunk headers only: it never loads the picture data", async () => {
    // A PNG whose picture data is 3 MB, with the EXIF chunk after it.
    const header = canvasPng().subarray(0, 8 + 25); // signature + IHDR
    const idat = concat(
      Uint8Array.of(0, 0x2d, 0xc6, 0xc0), // 3,000,000 bytes
      ascii("IDAT"),
      new Uint8Array(3_000_000),
      new Uint8Array(4),
    );
    const exifChunk = concat(
      Uint8Array.of(0, 0, 0, TIFF.length),
      ascii("eXIf"),
      TIFF,
      new Uint8Array(4),
    );
    const iend = concat(Uint8Array.of(0, 0, 0, 0), ascii("IEND"), new Uint8Array(4));
    const big = concat(header, idat, exifChunk, iend); // the EXIF chunk comes after the picture data
    let bytesRead = 0;
    const inner = bytesReader(big);
    const counting = {
      size: inner.size,
      read: async (o: number, l: number) => {
        const r = await inner.read(o, l);
        bytesRead += r.length;
        return r;
      },
    };
    expect(await findPngExif(counting)).not.toBeNull();
    expect(bytesRead).toBeLessThan(200); // a few headers and the small chunk, not 3 MB
  });
});

describe("withExifChunk", () => {
  it("puts one eXIf chunk before the picture data, with a valid CRC", () => {
    const out = withExifChunk(canvasPng(), TIFF);
    const chunks = chunksOf(out);
    const types = chunks.map((c) => c.type);
    expect(types.filter((t) => t === "eXIf")).toHaveLength(1);
    expect(types.indexOf("eXIf")).toBeLessThan(types.indexOf("IDAT"));
    expect(types[0]).toBe("IHDR");
    expect(types.at(-1)).toBe("IEND");
    const exif = chunks.find((c) => c.type === "eXIf")!;
    expect(Array.from(exif.data)).toEqual(Array.from(TIFF));
    expect(exif.crc).toBe(crc32(exif.raw.subarray(4, 8 + exif.data.length)));
  });

  it("leaves every other chunk byte for byte as it was", () => {
    for (const png of [canvasPng(), canvasAlphaPng()]) {
      const before = chunksOf(png).map((c) => Array.from(c.raw));
      const after = chunksOf(withExifChunk(png, TIFF))
        .filter((c) => c.type !== "eXIf")
        .map((c) => Array.from(c.raw));
      expect(after).toEqual(before);
    }
  });

  it("replaces an eXIf chunk the file already had, so there is exactly one", () => {
    const out = withExifChunk(cameraPng(), TIFF);
    const exifs = chunksOf(out).filter((c) => c.type === "eXIf");
    expect(exifs).toHaveLength(1);
    expect(Array.from(exifs[0]!.data)).toEqual(Array.from(TIFF));
  });

  it("is idempotent", () => {
    const once = withExifChunk(canvasPng(), TIFF);
    expect(Array.from(withExifChunk(once, TIFF))).toEqual(Array.from(once));
  });

  it("hands back the very same bytes when it can't walk the file", () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 2, 0, 0);
    expect(withExifChunk(jpeg, TIFF)).toBe(jpeg);
    const truncated = canvasPng().subarray(0, 40);
    expect(withExifChunk(truncated, TIFF)).toBe(truncated);
    const noData = concat(
      canvasPng().subarray(0, 33),
      Uint8Array.of(0, 0, 0, 0),
      ascii("IEND"),
      new Uint8Array(4),
    );
    expect(withExifChunk(noData, TIFF)).toBe(noData); // no IDAT to put it before
    const noEnd = canvasPng().subarray(0, canvasPng().length - 12); // IEND cut off
    expect(withExifChunk(noEnd, TIFF)).toBe(noEnd);
  });
});
