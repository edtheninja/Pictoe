import { healModeOf, type HealMode, type HealStroke } from "@/types/editor";

/**
 * Pure pixel logic for the clone stamp. No DOM: it works on RGBA arrays, so it can be tested
 * exactly. One "dab" paints a soft round patch at (cx, cy) copied from (cx + dx, cy + dy).
 * Everything is in source-image pixels.
 */
export type Dab = {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  r: number;
  softness: number;
  /** Carried from the stroke. "heal" dabs are painted by healDab (healBlend.ts); the rest by cloneDab. */
  mode?: HealMode;
};

/** A rectangle of pixels at a position in the image, with its RGBA data. */
export type Patch = { x: number; y: number; w: number; h: number; data: Uint8ClampedArray };
export type Rect = Omit<Patch, "data">;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Clone strokes are stored relative to the source image; this puts one in source pixels. */
export function dabFromStroke(s: HealStroke, srcW: number, srcH: number): Dab {
  return {
    cx: s.x * srcW,
    cy: s.y * srcH,
    dx: s.dx * srcW,
    dy: s.dy * srcH,
    r: s.radius * Math.min(srcW, srcH),
    softness: clamp(s.softness, 0, 100),
    mode: healModeOf(s),
  };
}

/**
 * A heal dab also reads a ring just outside its radius, on the target and on the source, to
 * measure the colour around each. The ring is this fraction of the radius wide, but never less
 * than HEAL_RING_MIN pixels, so a tiny brush still has something to measure.
 */
export const HEAL_RING_FRACTION = 0.4;
export const HEAL_RING_MIN = 3;

/** How far from its centre a dab reads: its radius, plus the ring when healing. */
export function dabReach(d: Dab): number {
  return d.mode === "heal" ? d.r + Math.max(HEAL_RING_MIN, d.r * HEAL_RING_FRACTION) : d.r;
}

function circleRect(cx: number, cy: number, r: number, w: number, h: number): Rect | null {
  // One pixel of margin so bilinear sampling always has its neighbours.
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const x1 = Math.min(w, Math.ceil(cx + r + 1));
  const y1 = Math.min(h, Math.ceil(cy + r + 1));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The two small areas a dab touches: where it paints and where it copies from, clipped to the
 * image. Kept separate (rather than their union) so a large offset never means reading a huge area.
 */
export function dabRects(d: Dab, w: number, h: number): { src: Rect; dst: Rect } | null {
  const reach = dabReach(d);
  const dst = circleRect(d.cx, d.cy, reach, w, h);
  const src = circleRect(d.cx + d.dx, d.cy + d.dy, reach, w, h);
  return dst && src ? { src, dst } : null;
}

/**
 * One bilinear sample of the source, where (sx, sy) is the top-left of the four pixels it blends.
 * Writes RGBA into `out` and returns true, or returns false (leaving `out` alone) when any of
 * the four pixels is outside the image or outside the patch that was read, so edges are skipped
 * rather than smeared in.
 */
export function sampleSource(
  src: Patch,
  imgW: number,
  imgH: number,
  sx: number,
  sy: number,
  out: ArrayLike<number> & { [i: number]: number },
): boolean {
  if (sx < 0 || sy < 0 || sx > imgW - 1 || sy > imgH - 1) return false;

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const x1 = Math.min(x0 + 1, imgW - 1);
  const y1 = Math.min(y0 + 1, imgH - 1);

  const lx0 = x0 - src.x;
  const lx1 = x1 - src.x;
  const ly0 = y0 - src.y;
  const ly1 = y1 - src.y;
  if (lx0 < 0 || ly0 < 0 || lx1 >= src.w || ly1 >= src.h) return false;

  const i00 = (ly0 * src.w + lx0) * 4;
  const i10 = (ly0 * src.w + lx1) * 4;
  const i01 = (ly1 * src.w + lx0) * 4;
  const i11 = (ly1 * src.w + lx1) * 4;

  for (let c = 0; c < 4; c++) {
    const top = src.data[i00 + c]! * (1 - fx) + src.data[i10 + c]! * fx;
    const bottom = src.data[i01 + c]! * (1 - fx) + src.data[i11 + c]! * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return true;
}

/** How much of a dab's colour lands at `dist` from its centre: 1 inside the hard core, fading to 0. */
export function dabAlpha(dist: number, r: number, softness: number): number {
  const inner = 1 - softness / 100;
  const t = dist / r;
  return t <= inner || inner >= 1 ? 1 : 1 - (t - inner) / (1 - inner);
}

/**
 * Paints one dab into `dst`, sampling from `src`. The two must be separate copies taken *before*
 * the dab: that snapshot is what stops overlapping source and target areas from smearing into
 * each other. Source points outside the image are skipped rather than smeared in.
 */
export function cloneDab(src: Patch, dst: Patch, d: Dab, imgW: number, imgH: number): void {
  const sampled = new Float64Array(4);

  for (let py = 0; py < dst.h; py++) {
    for (let px = 0; px < dst.w; px++) {
      const gx = dst.x + px + 0.5;
      const gy = dst.y + py + 0.5;
      const dist = Math.hypot(gx - d.cx, gy - d.cy);
      if (dist >= d.r) continue;

      const alpha = dabAlpha(dist, d.r, d.softness);

      // Where in the source this pixel reads from (as the top-left of a bilinear sample).
      if (!sampleSource(src, imgW, imgH, gx + d.dx - 0.5, gy + d.dy - 0.5, sampled)) continue;

      const out = (py * dst.w + px) * 4;
      for (let c = 0; c < 4; c++) {
        dst.data[out + c] = dst.data[out + c]! * (1 - alpha) + sampled[c]! * alpha;
      }
    }
  }
}
