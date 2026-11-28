/**
 * Just enough of the WebP container (RIFF) to find and add the EXIF chunk without touching the
 * picture. A WebP is "RIFF", a size, "WEBP", then chunks: a 4-character type, a 4-byte little-endian
 * size, the data, padded to an even length. Pure and total, like pngChunks.ts.
 *
 * A WebP can only carry metadata in the "extended" layout, which starts with a VP8X chunk that
 * records the canvas size and which features are present. A plain one-image WebP (what browsers
 * usually make) has no VP8X, so adding EXIF means creating it, and that needs the picture's size
 * to be right: it is checked against the picture's own header, and if they disagree nothing is
 * written. Animated files are left alone.
 */
import type { RangeReader } from "./rangeReader";
import { MAX_EXIF_CHUNK_BYTES, stripExifPrefix } from "./pngChunks";

const MAX_CHUNKS = 100_000;
const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;

const ascii = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u32le = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "WEBP";
}

// --- Reading ---------------------------------------------------------------------------------

/** The TIFF data of the file's first EXIF chunk, or null. Reads chunk headers, not the picture. */
export async function findWebpExif(reader: RangeReader): Promise<Uint8Array | null> {
  let pos = 12;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (pos + 8 > reader.size) return null;
    const head = await reader.read(pos, 8);
    if (head.length < 8) return null;
    const type = ascii(head, 0);
    const length = u32le(head, 4);
    if (pos + 8 + length > reader.size) return null; // runs past the end: damaged
    if (type === "EXIF") {
      if (length > MAX_EXIF_CHUNK_BYTES) return null;
      const data = await reader.read(pos + 8, length);
      return data.length === length ? stripExifPrefix(data) : null;
    }
    pos += 8 + length + (length & 1);
  }
  return null;
}

// --- Writing ---------------------------------------------------------------------------------

type Chunk = { type: string; dataStart: number; dataEnd: number; end: number };

function walk(webp: Uint8Array): Chunk[] | null {
  if (!isWebp(webp)) return null;
  const riffEnd = u32le(webp, 4) + 8;
  if (riffEnd > webp.length || riffEnd < 12) return null;
  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos < riffEnd && chunks.length < MAX_CHUNKS) {
    if (pos + 8 > riffEnd) return null;
    const length = u32le(webp, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + (length & 1);
    if (dataEnd > riffEnd || end > riffEnd + (length & 1)) return null;
    chunks.push({ type: ascii(webp, pos), dataStart, dataEnd, end: Math.min(end, riffEnd) });
    pos = end;
  }
  return chunks;
}

/** Width, height and whether it uses alpha, from a plain image chunk's own header. Null if unreadable. */
function imageHeader(
  webp: Uint8Array,
  chunk: Chunk,
): { width: number; height: number; alpha: boolean } | null {
  const d = chunk.dataStart;
  if (chunk.type === "VP8 ") {
    if (chunk.dataEnd - d < 10) return null;
    if (webp[d + 3] !== 0x9d || webp[d + 4] !== 0x01 || webp[d + 5] !== 0x2a) return null;
    return {
      width: (webp[d + 6]! | (webp[d + 7]! << 8)) & 0x3fff,
      height: (webp[d + 8]! | (webp[d + 9]! << 8)) & 0x3fff,
      alpha: false, // lossy alpha lives in a separate ALPH chunk, which needs the extended layout
    };
  }
  if (chunk.type === "VP8L") {
    if (chunk.dataEnd - d < 5 || webp[d] !== 0x2f) return null;
    const bits = u32le(webp, d + 1);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    };
  }
  return null;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const padded = data.length + (data.length & 1);
  const out = new Uint8Array(8 + padded);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function vp8x(flags: number, width: number, height: number): Uint8Array {
  const data = new Uint8Array(10);
  data[0] = flags;
  const w = width - 1;
  const h = height - 1;
  data[4] = w & 0xff;
  data[5] = (w >> 8) & 0xff;
  data[6] = (w >> 16) & 0xff;
  data[7] = h & 0xff;
  data[8] = (h >> 8) & 0xff;
  data[9] = (h >> 16) & 0xff;
  return buildChunk("VP8X", data);
}

/**
 * The WebP with an EXIF chunk holding this TIFF data, and the extended header that requires.
 * `size` is the picture's size and must match the file, or nothing is changed. An EXIF chunk the
 * file already had is dropped. The picture's own chunks are copied byte for byte. Returns the same
 * bytes if this isn't a plain or extended still WebP it can walk.
 */
export function withExifWebpChunk(
  webp: Uint8Array,
  tiff: Uint8Array,
  size: { width: number; height: number },
): Uint8Array {
  const chunks = walk(webp);
  if (!chunks || chunks.length === 0) return webp;
  if (chunks.some((c) => c.type === "ANIM" || c.type === "ANMF")) return webp;

  // Rebuilt from type and data, so every chunk comes out padded to an even length.
  const piece = (c: Chunk) => buildChunk(c.type, webp.subarray(c.dataStart, c.dataEnd));
  let head: Uint8Array;
  let rest: Chunk[];

  if (chunks[0]!.type === "VP8X") {
    const first = chunks[0]!;
    if (first.dataEnd - first.dataStart < 10) return webp;
    const width = u24le(webp, first.dataStart + 4) + 1;
    const height = u24le(webp, first.dataStart + 7) + 1;
    if (width !== size.width || height !== size.height) return webp;
    const data = webp.slice(first.dataStart, first.dataEnd);
    data[0] = data[0]! | FLAG_EXIF;
    head = buildChunk("VP8X", data);
    rest = chunks.slice(1);
  } else {
    if (chunks.length !== 1) return webp;
    const header = imageHeader(webp, chunks[0]!);
    if (!header || header.width !== size.width || header.height !== size.height) return webp;
    head = vp8x(FLAG_EXIF | (header.alpha ? FLAG_ALPHA : 0), header.width, header.height);
    rest = chunks;
  }

  const kept = rest.filter((c) => c.type !== "EXIF");
  const exif = buildChunk("EXIF", tiff);
  const xmp = kept.findIndex((c) => c.type === "XMP ");
  const pieces: Uint8Array[] = [head];
  kept.forEach((c, i) => {
    if (i === xmp) pieces.push(exif);
    pieces.push(piece(c));
  });
  if (xmp < 0) pieces.push(exif);

  const body = pieces.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(webp.subarray(0, 4), 0); // "RIFF"
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set(webp.subarray(8, 12), 8); // "WEBP"
  let at = 12;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
