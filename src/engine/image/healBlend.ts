import { dabAlpha, dabReach, sampleSource, type Dab, type Patch, cloneDab } from "./cloneStamp";

/**
 * The heal blend: copy the source's texture, but take the colour and brightness from around the
 * target, so the patch melts into its surroundings instead of showing as a lighter or darker
 * island. No DOM, so it can be tested exactly.
 *
 * How it works (this is "seamless cloning", done on a disc):
 *
 *   1. Ring. Look at a ring of pixels just outside the dab's radius. For each, take the
 *      difference "target colour minus source colour" (the source sampled at the same offset).
 *      That is how much the source would have to change to match the target there. Pixels are
 *      grouped into RING_BINS angular sectors and averaged, giving one colour offset per
 *      direction around the dab. The ring is outside the radius, so the thing being healed (a
 *      blemish, a wire) is not in it.
 *   2. Membrane. Inside the ring the offset is the smoothest surface that matches it: the
 *      harmonic function with those boundary values (the Laplace solution, which is also what
 *      Poisson image editing produces for an offset field). On a disc it has a closed form: split
 *      the ring offsets into angular frequencies, and the k-th one fades towards the centre as
 *      ρ^k, where ρ is the distance from the centre as a fraction of the ring's own mean radius
 *      (measured from the pixels used, not assumed, so a smooth gradient is reproduced exactly).
 *      Gentle, wide differences (a gradient across the sky, a cast) reach the middle; fine ones
 *      die away at once. The ring sits just outside the dab, so the offset is continuous across
 *      the dab's edge and there is no seam.
 *   3. Paint. Each pixel is the source sample plus that offset (per channel, clamped to 0-255),
 *      mixed into the target with the same soft edge as the clone stamp. Alpha is not offset.
 *
 * If there is nothing to measure (the ring falls off the image or off the source), the offset is
 * zero and the dab is exactly a clone.
 *
 * Cost, measured in Node on a 3000 x 2000 image (15 Nov 2026): about 3 times a clone dab, per
 * dab: 1.2 ms at radius 30 px, 4 ms at 60 px, 18 ms at 120 px, 73 ms at 240 px (a clone is 0.4,
 * 1.3, 5 and 33 ms). It grows with the dab's area, plus a fixed 16-term series per pixel. A drag
 * adds many dabs, so the render step needs to paint them incrementally, as the clone stamp does.
 */

/** Angular sectors around the dab. 32 gives a frequency limit of 16 per turn. */
export const RING_BINS = 32;

const HALF = RING_BINS / 2;
const CHANNELS = 3; // R, G, B; alpha is never offset

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** What the ring measured: offsets per sector and channel, and how far out the ring really is. */
export type Ring = {
  /** Average of (target − source) per angular sector and channel: sector j, channel c at j * 3 + c. */
  offsets: Float64Array;
  /** Mean distance of the pixels used from the dab's centre, in pixels. */
  radius: number;
};

/**
 * Measures the ring. Sectors with no usable pixels are filled from their nearest neighbours
 * around the circle. Returns null when no sector has any pixel at all, which means there is
 * nothing to match.
 *
 * `src` and `dst` must be separate pre-dab copies that cover the dab's reach (see dabReach).
 */
export function ringOffsets(
  src: Patch,
  dst: Patch,
  d: Dab,
  imgW: number,
  imgH: number,
): Ring | null {
  const reach = dabReach({ ...d, mode: "heal" });
  const sums = new Float64Array(RING_BINS * CHANNELS);
  const counts = new Uint32Array(RING_BINS);
  const sampled = new Float64Array(4);
  let distSum = 0;
  let used = 0;

  for (let py = 0; py < dst.h; py++) {
    for (let px = 0; px < dst.w; px++) {
      const gx = dst.x + px + 0.5;
      const gy = dst.y + py + 0.5;
      const dist = Math.hypot(gx - d.cx, gy - d.cy);
      if (dist < d.r || dist >= reach) continue;
      if (!sampleSource(src, imgW, imgH, gx + d.dx - 0.5, gy + d.dy - 0.5, sampled)) continue;

      const angle = Math.atan2(gy - d.cy, gx - d.cx); // -π … π
      const bin = Math.min(
        RING_BINS - 1,
        Math.floor(((angle + Math.PI) / (2 * Math.PI)) * RING_BINS),
      );
      const at = (py * dst.w + px) * 4;
      for (let c = 0; c < CHANNELS; c++) {
        sums[bin * CHANNELS + c]! += dst.data[at + c]! - sampled[c]!;
      }
      counts[bin]!++;
      distSum += dist;
      used++;
    }
  }

  const offsets = new Float64Array(RING_BINS * CHANNELS);
  const filled: number[] = [];
  for (let j = 0; j < RING_BINS; j++) {
    if (counts[j]! === 0) continue;
    filled.push(j);
    for (let c = 0; c < CHANNELS; c++) {
      offsets[j * CHANNELS + c] = sums[j * CHANNELS + c]! / counts[j]!;
    }
  }
  if (filled.length === 0) return null;

  // Fill empty sectors by interpolating between the nearest filled ones, going round the circle.
  if (filled.length < RING_BINS) {
    for (let j = 0; j < RING_BINS; j++) {
      if (counts[j]! > 0) continue;
      let before = 1;
      while (counts[(j - before + RING_BINS) % RING_BINS]! === 0) before++;
      let after = 1;
      while (counts[(j + after) % RING_BINS]! === 0) after++;
      const jb = (j - before + RING_BINS) % RING_BINS;
      const ja = (j + after) % RING_BINS;
      const wAfter = before / (before + after); // nearer neighbour counts for more
      for (let c = 0; c < CHANNELS; c++) {
        offsets[j * CHANNELS + c] =
          offsets[jb * CHANNELS + c]! * (1 - wAfter) + offsets[ja * CHANNELS + c]! * wAfter;
      }
    }
  }
  return { offsets, radius: distSum / used };
}

/** A ring's offsets split into angular frequencies: coefficient k, channel c, real and imaginary. */
export type Membrane = { re: Float64Array; im: Float64Array };

/**
 * The membrane for a set of ring offsets: the discrete Fourier coefficients c_k (k = 0 … 16) of
 * each channel's offsets around the ring, with sector j taken at angle θ_j = -π + (j + ½)·2π/N.
 */
export function membraneFor(offsets: Float64Array): Membrane {
  const re = new Float64Array((HALF + 1) * CHANNELS);
  const im = new Float64Array((HALF + 1) * CHANNELS);
  for (let k = 0; k <= HALF; k++) {
    for (let j = 0; j < RING_BINS; j++) {
      const theta = -Math.PI + ((j + 0.5) * 2 * Math.PI) / RING_BINS;
      const cos = Math.cos(k * theta);
      const sin = Math.sin(k * theta);
      for (let c = 0; c < CHANNELS; c++) {
        const v = offsets[j * CHANNELS + c]! / RING_BINS;
        re[k * CHANNELS + c]! += v * cos; // c_k = (1/N) Σ B_j e^(-i k θ_j)
        im[k * CHANNELS + c]! -= v * sin;
      }
    }
  }
  return { re, im };
}

/**
 * The offset for each channel at a point inside the ring, as (zx, zy) = (x − cx, y − cy) / R with
 * R the ring's mean radius, so the point is the complex number z = ρ·e^(iθ). The sum is c_0 + 2·Re Σ c_k z^k, with the
 * highest frequency counted once.
 */
export function membraneAt(m: Membrane, zx: number, zy: number, out: Float64Array): void {
  for (let c = 0; c < CHANNELS; c++) out[c] = m.re[c]!;

  let pr = 1;
  let pi = 0;
  for (let k = 1; k <= HALF; k++) {
    const nr = pr * zx - pi * zy; // z^k = z^(k-1) · z
    const ni = pr * zy + pi * zx;
    pr = nr;
    pi = ni;
    const weight = k === HALF ? 1 : 2;
    for (let c = 0; c < CHANNELS; c++) {
      out[c]! += weight * (m.re[k * CHANNELS + c]! * pr - m.im[k * CHANNELS + c]! * pi);
    }
  }
}

/**
 * Paints one heal dab into `dst`, sampling texture from `src`. Same contract as cloneDab: the
 * two are separate copies taken before the dab, and `dst` is changed in place. Both must cover
 * the dab's reach, which dabRects returns for a dab whose mode is "heal".
 */
export function healDab(src: Patch, dst: Patch, d: Dab, imgW: number, imgH: number): void {
  const ring = ringOffsets(src, dst, d, imgW, imgH);
  // Nothing around to match: a plain clone is the honest fallback.
  if (!ring) return cloneDab(src, dst, d, imgW, imgH);

  const membrane = membraneFor(ring.offsets);
  const sampled = new Float64Array(4);
  const shift = new Float64Array(CHANNELS);

  for (let py = 0; py < dst.h; py++) {
    for (let px = 0; px < dst.w; px++) {
      const gx = dst.x + px + 0.5;
      const gy = dst.y + py + 0.5;
      const dist = Math.hypot(gx - d.cx, gy - d.cy);
      if (dist >= d.r) continue;
      if (!sampleSource(src, imgW, imgH, gx + d.dx - 0.5, gy + d.dy - 0.5, sampled)) continue;

      membraneAt(membrane, (gx - d.cx) / ring.radius, (gy - d.cy) / ring.radius, shift);

      const alpha = dabAlpha(dist, d.r, d.softness);
      const out = (py * dst.w + px) * 4;
      for (let c = 0; c < CHANNELS; c++) {
        const healed = clamp255(sampled[c]! + shift[c]!);
        dst.data[out + c] = dst.data[out + c]! * (1 - alpha) + healed * alpha;
      }
      dst.data[out + 3] = dst.data[out + 3]! * (1 - alpha) + sampled[3]! * alpha;
    }
  }
}

/** Paints one dab of either kind: heal when the dab says so, otherwise clone. */
export function paintDab(src: Patch, dst: Patch, d: Dab, imgW: number, imgH: number): void {
  if (d.mode === "heal") healDab(src, dst, d, imgW, imgH);
  else cloneDab(src, dst, d, imgW, imgH);
}
