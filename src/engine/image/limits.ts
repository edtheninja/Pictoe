/**
 * Guardrails for very large photos. A phone or camera photo is fine; a 100-megapixel scan is not,
 * and a crafted file can claim billions of pixels in a few bytes. So the size is read from the
 * file header and checked BEFORE the browser is asked to decode anything.
 */

/** Largest photo Pictoe will open: 100 megapixels (about 10,000 × 10,000). */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** The longest side any browser canvas can have (Chrome and Firefox; Safari is lower still). */
export const MAX_CANVAS_SIDE = 32_767;

const nf = new Intl.NumberFormat("en-US");

/** "12,000 × 9,000 (108 MP)" */
export function describeSize(width: number, height: number): string {
  const mp = Math.round((width * height) / 100_000) / 10;
  return `${nf.format(width)} × ${nf.format(height)} (${mp} MP)`;
}

export type SizeCheck = { ok: true } | { ok: false; message: string };

export function checkImageSize(width: number, height: number): SizeCheck {
  if (width * height > MAX_IMAGE_PIXELS) {
    return {
      ok: false,
      message: `This photo is ${describeSize(width, height)}, which is larger than Pictoe can open (up to ${MAX_IMAGE_PIXELS / 1_000_000} MP). Make it smaller and try again.`,
    };
  }
  if (Math.max(width, height) > MAX_CANVAS_SIDE) {
    return {
      ok: false,
      message: `This photo is ${describeSize(width, height)}. Its longest side is more than a browser can handle (up to ${nf.format(MAX_CANVAS_SIDE)} px). Make it smaller and try again.`,
    };
  }
  return { ok: true };
}

const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const be32 = (b: Uint8Array, i: number) => be16(b, i) * 65536 + be16(b, i + 2);
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const le24 = (b: Uint8Array, i: number) => le16(b, i) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

/**
 * Reads width and height straight from a JPEG, PNG or WebP header without decoding it.
 * Returns null when the bytes are not a recognisable image or are cut off before the size.
 */
export function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then the IHDR chunk holds width and height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return { width: be32(b, 16), height: be32(b, 20) };
  }

  // JPEG: walk the marker segments until the "start of frame", which holds the size.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      while (b[i + 1] === 0xff) i++; // padding
      const marker = b[i + 1] ?? 0;
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan: no size seen
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // markers with no payload
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        if (i + 8 >= b.length) return null;
        return { width: be16(b, i + 7), height: be16(b, i + 5) };
      }
      i += 2 + be16(b, i + 2);
    }
    return null;
  }

  // WebP: a RIFF container whose first chunk says how the size is stored. Each layout needs a
  // different number of bytes, so each checks for exactly what it reads.
  if (b.length >= 21 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const kind = ascii(b, 12, 4);
    if (kind === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    }
    if (kind === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X" && b.length >= 30) {
      return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    }
  }
  return null;
}
