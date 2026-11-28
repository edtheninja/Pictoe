/**
 * Just enough of the PNG container to find and add the EXIF chunk ("eXIf") without touching the
 * picture. A PNG is an 8-byte signature, then chunks: a 4-byte length, a 4-byte type, the data,
 * and a CRC of the type and data. Pure and total: anything that isn't a PNG we can walk is
 * returned unchanged or read as "nothing there", never an exception.
 */
import type { RangeReader } from "./rangeReader";

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** More than any real PNG has; stops a hostile file making the search run forever. */
const MAX_CHUNKS = 100_000;
/** The photo info we write is tiny; refuse to read an EXIF chunk bigger than a JPEG segment holds. */
export const MAX_EXIF_CHUNK_BYTES = 0xffff;

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0": some writers add it

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Drops the "Exif\0\0" some programs put before the TIFF data, which the PNG spec doesn't use. */
export function stripExifPrefix(data: Uint8Array): Uint8Array {
  return EXIF_PREFIX.every((b, i) => data[i] === b) ? data.subarray(EXIF_PREFIX.length) : data;
}

// --- CRC-32, as PNG defines it ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32be = (b: Uint8Array, at: number) =>
  (b[at]! * 0x1000000 + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!)) >>> 0;
const type4 = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

// --- Reading ---------------------------------------------------------------------------------

/** The TIFF data of the file's first eXIf chunk, or null. Reads chunk headers, not the picture. */
export async function findPngExif(reader: RangeReader): Promise<Uint8Array | null> {
  let pos = 8;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (pos + 12 > reader.size) return null;
    const head = await reader.read(pos, 8);
    if (head.length < 8) return null;
    const length = u32be(head, 0);
    const type = type4(head, 4);
    if (pos + 12 + length > reader.size) return null; // claims to run past the end: damaged
    if (type === "eXIf") {
      if (length > MAX_EXIF_CHUNK_BYTES) return null;
      const data = await reader.read(pos + 8, length);
      return data.length === length ? stripExifPrefix(data) : null;
    }
    if (type === "IEND") return null;
    pos += 12 + length;
  }
  return null;
}

// --- Writing ---------------------------------------------------------------------------------

type Chunk = { type: string; start: number; end: number };

function walk(png: Uint8Array): Chunk[] | null {
  if (!isPng(png)) return null;
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos < png.length && chunks.length < MAX_CHUNKS) {
    if (pos + 12 > png.length) return null;
    const length = u32be(png, pos);
    const end = pos + 12 + length;
    if (end > png.length) return null;
    const type = type4(png, pos + 4);
    chunks.push({ type, start: pos, end });
    pos = end;
    if (type === "IEND") break;
  }
  return chunks.at(-1)?.type === "IEND" ? chunks : null;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/**
 * The PNG with an eXIf chunk holding this TIFF data, placed before the picture data. An eXIf
 * chunk the file already had is dropped, so there is exactly one. The picture's own chunks are
 * copied byte for byte. Returns the same bytes if this isn't a PNG it can walk.
 */
export function withExifChunk(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  const chunks = walk(png);
  if (!chunks) return png;
  const firstData = chunks.findIndex((c) => c.type === "IDAT");
  if (firstData < 0) return png;

  const exif = buildChunk("eXIf", tiff);
  const pieces: Uint8Array[] = [png.subarray(0, 8)];
  chunks.forEach((c, i) => {
    if (i === firstData) pieces.push(exif);
    if (c.type !== "eXIf") pieces.push(png.subarray(c.start, c.end));
  });
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
