/**
 * Just enough of the JPEG container to find and add metadata segments (EXIF, later colour
 * profiles) without touching the picture data.
 *
 * A JPEG is a run of marker segments (0xFF, a marker byte, a 2-byte length that includes itself,
 * then the payload) until the "start of scan" marker, after which come the compressed picture
 * bytes. Everything here works on the segments before that point and copies the rest unchanged.
 *
 * Pure and total: bytes in, bytes out, and anything that isn't a JPEG we understand comes back
 * unchanged rather than throwing. Not for decoding pictures.
 */

export type JpegSegment = {
  marker: number;
  /** Offset of the 0xFF that starts the segment. */
  start: number;
  /** Offset just past the segment's last byte. */
  end: number;
  /** The payload, without the marker and length. Empty for markers that have none. */
  payloadStart: number;
  payloadEnd: number;
};

export type JpegLayout = {
  segments: JpegSegment[];
  /** Where the start-of-scan marker begins (the picture data follows), or the end of the bytes. */
  scanStart: number;
  /** False when the bytes ended before the scan began (a truncated read, or a damaged file). */
  complete: boolean;
};

export const MARKER = {
  SOI: 0xd8,
  EOI: 0xd9,
  SOS: 0xda,
  APP0: 0xe0,
  APP1: 0xe1,
  APP2: 0xe2,
} as const;

/** The largest payload one segment can hold: a 16-bit length, which counts its own two bytes. */
export const MAX_SEGMENT_PAYLOAD = 0xffff - 2;

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const JFIF_HEADER = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === MARKER.SOI && bytes[2] === 0xff;
}

/** Reads the segments before the picture data. Null when this isn't a JPEG we can walk. */
export function readJpegLayout(bytes: Uint8Array): JpegLayout | null {
  if (!isJpeg(bytes)) return null;
  const segments: JpegSegment[] = [];
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return null; // not a marker where one must be: damaged
    while (pos + 1 < bytes.length && bytes[pos + 1] === 0xff) pos++; // fill bytes before a marker
    if (pos + 1 >= bytes.length) return { segments, scanStart: bytes.length, complete: false };
    const marker = bytes[pos + 1]!;
    if (marker === 0x00) return null; // a stuffed byte, not a marker
    // Markers that stand alone, with no length: temporary, and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({
        marker,
        start: pos,
        end: pos + 2,
        payloadStart: pos + 2,
        payloadEnd: pos + 2,
      });
      pos += 2;
      continue;
    }
    if (marker === MARKER.EOI) return { segments, scanStart: pos, complete: true };
    if (pos + 4 > bytes.length) return { segments, scanStart: bytes.length, complete: false };
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (length < 2) return null;
    const end = pos + 2 + length;
    if (marker === MARKER.SOS) {
      segments.push({
        marker,
        start: pos,
        end: Math.min(end, bytes.length),
        payloadStart: pos + 4,
        payloadEnd: Math.min(end, bytes.length),
      });
      return { segments, scanStart: pos, complete: true };
    }
    if (end > bytes.length) return { segments, scanStart: bytes.length, complete: false };
    segments.push({ marker, start: pos, end, payloadStart: pos + 4, payloadEnd: end });
    pos = end;
  }
  return { segments, scanStart: bytes.length, complete: false };
}

function startsWith(bytes: Uint8Array, at: number, header: readonly number[]): boolean {
  return header.every((b, i) => bytes[at + i] === b);
}

export const isExifSegment = (bytes: Uint8Array, s: JpegSegment) =>
  s.marker === MARKER.APP1 && startsWith(bytes, s.payloadStart, EXIF_HEADER);

const isJfifSegment = (bytes: Uint8Array, s: JpegSegment) =>
  s.marker === MARKER.APP0 && startsWith(bytes, s.payloadStart, JFIF_HEADER);

/** The TIFF-structured data inside the file's first EXIF segment (after "Exif\0\0"), if any. */
export function findExifPayload(bytes: Uint8Array, layout: JpegLayout): Uint8Array | null {
  const segment = layout.segments.find((s) => isExifSegment(bytes, s));
  return segment
    ? bytes.subarray(segment.payloadStart + EXIF_HEADER.length, segment.payloadEnd)
    : null;
}

/** A whole segment: marker, length, payload. Throws if the payload is too big for one segment. */
export function buildSegment(marker: number, payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_SEGMENT_PAYLOAD) throw new RangeError("JPEG segment payload too large");
  const out = new Uint8Array(payload.length + 4);
  out[0] = 0xff;
  out[1] = marker;
  const length = payload.length + 2;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  out.set(payload, 4);
  return out;
}

/** The bytes of an EXIF segment holding this TIFF data. */
export function buildExifSegment(tiff: Uint8Array): Uint8Array {
  const payload = new Uint8Array(EXIF_HEADER.length + tiff.length);
  payload.set(EXIF_HEADER, 0);
  payload.set(tiff, EXIF_HEADER.length);
  return buildSegment(MARKER.APP1, payload);
}

/**
 * Puts an EXIF segment into a JPEG: after the JFIF segment if there is one (the order other
 * programs write), otherwise right after the start marker. Any EXIF segment the file already had
 * is dropped, so there is exactly one, and the picture data is copied byte for byte.
 * Returns the bytes unchanged if they aren't a JPEG this can walk.
 */
export function withExifSegment(jpeg: Uint8Array, exifSegment: Uint8Array): Uint8Array {
  const layout = readJpegLayout(jpeg);
  if (!layout) return jpeg;
  const old = layout.segments.filter((s) => isExifSegment(jpeg, s));
  const jfif =
    layout.segments[0] && isJfifSegment(jpeg, layout.segments[0]) ? layout.segments[0] : null;
  const insertAt = jfif ? jfif.end : 2;

  const pieces: Uint8Array[] = [];
  let cursor = 0;
  const copyTo = (to: number) => {
    if (to > cursor) pieces.push(jpeg.subarray(cursor, to));
    cursor = Math.max(cursor, to);
  };
  const skip = (s: JpegSegment) => {
    copyTo(s.start);
    cursor = Math.max(cursor, s.end);
  };

  copyTo(insertAt);
  pieces.push(exifSegment);
  old.forEach(skip); // an existing one can never start before the insertion point
  copyTo(jpeg.length);

  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
