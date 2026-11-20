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
 *      blemish, a wire) is not in it, except where it runs on beyond the dab (a scratch, a hair,
 *      the part of a long stroke not yet painted). Such pixels are filtered out: stray pixels
 *      inside a sector by clipping (CLIP_*), and whole sectors by a median across neighbouring
 *      sectors (MEDIAN_*), which tolerates a contaminating spike up to about 45 degrees wide.
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
 * Cost, measured in Node on a 3000 x 2000 image (15 Nov 2026, after the ring filtering below; the
 * figures are noisy): 1.6 ms at radius 30 px, 8 ms at 60, 21 ms at 120, 83 ms at 240, which is
 * roughly 4 times a clone dab (1.1, 1.3, 5 and 22 ms). It grows with the dab's area, plus a
 * fixed 16-term series per pixel. A drag adds many dabs, so they are painted incrementally, as
 * the clone stamp's are.
 */

/** Angular sectors around the dab. 32 gives a frequency limit of 16 per turn. */
export const RING_BINS = 32;

const HALF = RING_BINS / 2;
const CHANNELS = 3; // R, G, B; alpha is never offset

/**
 * Outlier rejection on the ring. Whatever crosses the ring (the rest of a scratch, a hair, the
 * edge of the blemish itself) gives pixels whose offset is far from their neighbours', and would
 * drag the whole sector's average with it. So each sector is averaged, pixels further from that
 * average than CLIP_SIGMA standard deviations (and further than CLIP_MIN colour levels, so a
 * very clean ring is not trimmed to nothing) are set aside, and the sector is averaged again
 * from the rest, CLIP_ROUNDS times. This works while the outliers are the minority of a sector.
 */
export const CLIP_SIGMA = 2;
export const CLIP_MIN = 6;
export const CLIP_ROUNDS = 3;

/**
 * Outlier rejection across the ring. When a blemish is long (a scratch, a wire, a hair), the part
 * of it not yet healed lies across the ring in one direction and fills a few whole sectors, which
 * clipping inside a sector cannot catch. Those sectors are a narrow spike in the offset going
 * round the circle, so each sector's offset is replaced by the median of itself and its
 * neighbours (MEDIAN_WINDOW sectors in all, round the circle). A median removes spikes narrower
 * than half the window but keeps real steps (a horizon edge across the ring) sharp.
 *
 * It only replaces a sector that is more than MEDIAN_TOLERANCE colour levels from that median.
 * A median of smooth variation (the offset changing gently round the ring, as when the source is
 * flat and the target a gradient) shaves a few percent off its peaks; leaving sectors within the
 * tolerance alone keeps that variation exact, while a scratch's offset is off by far more.
 * The window of 9 tolerates a spike up to 4 sectors wide (about 45 degrees of the ring).
 */
export const MEDIAN_WINDOW = 9;
export const MEDIAN_TOLERANCE = 6;

/** Per-pixel scratch for one ring measurement, reused between dabs and grown as needed. */
let scratchOffsets = new Float32Array(0); // n x CHANNELS
let scratchBins = new Uint8Array(0);
let scratchKept = new Uint8Array(0);

function ensureScratch(pixels: number) {
  if (scratchBins.length >= pixels) return;
  const size = Math.max(pixels, 1024);
  scratchOffsets = new Float32Array(size * CHANNELS);
  scratchBins = new Uint8Array(size);
  scratchKept = new Uint8Array(size);
}

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
  const sampled = new Float64Array(4);
  ensureScratch(dst.w * dst.h);
  let n = 0;
  let distSum = 0;

  // Pass 1: every usable ring pixel's (target - source), and the sector it is in.
  for (let py = 0; py < dst.h; py++) {
    for (let px = 0; px < dst.w; px++) {
      const gx = dst.x + px + 0.5;
      const gy = dst.y + py + 0.5;
      const dist = Math.hypot(gx - d.cx, gy - d.cy);
      if (dist < d.r || dist >= reach) continue;
      if (!sampleSource(src, imgW, imgH, gx + d.dx - 0.5, gy + d.dy - 0.5, sampled)) continue;

      const angle = Math.atan2(gy - d.cy, gx - d.cx); // -π … π
      scratchBins[n] = Math.min(
        RING_BINS - 1,
        Math.floor(((angle + Math.PI) / (2 * Math.PI)) * RING_BINS),
      );
      const at = (py * dst.w + px) * 4;
      for (let c = 0; c < CHANNELS; c++)
        scratchOffsets[n * CHANNELS + c] = dst.data[at + c]! - sampled[c]!;
      scratchKept[n] = 1;
      distSum += dist;
      n++;
    }
  }
  if (n === 0) return null;

  // Passes 2..: average each sector over the pixels still kept, then drop the pixels that are
  // far from their sector's average, and repeat.
  const sums = new Float64Array(RING_BINS * CHANNELS);
  const squares = new Float64Array(RING_BINS * CHANNELS);
  const counts = new Uint32Array(RING_BINS);
  const mean = new Float64Array(RING_BINS * CHANNELS);
  const limit = new Float64Array(RING_BINS * CHANNELS);

  const average = () => {
    sums.fill(0);
    squares.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      if (!scratchKept[i]) continue;
      const bin = scratchBins[i]!;
      counts[bin]!++;
      for (let c = 0; c < CHANNELS; c++) {
        const v = scratchOffsets[i * CHANNELS + c]!;
        sums[bin * CHANNELS + c]! += v;
        squares[bin * CHANNELS + c]! += v * v;
      }
    }
    for (let j = 0; j < RING_BINS; j++) {
      for (let c = 0; c < CHANNELS; c++) {
        const k = j * CHANNELS + c;
        if (counts[j]! === 0) continue;
        mean[k] = sums[k]! / counts[j]!;
        const variance = Math.max(0, squares[k]! / counts[j]! - mean[k]! * mean[k]!);
        limit[k] = Math.max(CLIP_SIGMA * Math.sqrt(variance), CLIP_MIN);
      }
    }
  };

  average();
  for (let round = 0; round < CLIP_ROUNDS; round++) {
    for (let i = 0; i < n; i++) {
      const bin = scratchBins[i]!;
      let inside = 1;
      for (let c = 0; c < CHANNELS; c++) {
        const k = bin * CHANNELS + c;
        if (Math.abs(scratchOffsets[i * CHANNELS + c]! - mean[k]!) > limit[k]!) inside = 0;
      }
      scratchKept[i] = inside;
    }
    // A sector must keep something: if clipping emptied it, keep everything in it.
    const keptPerBin = new Uint32Array(RING_BINS);
    for (let i = 0; i < n; i++) if (scratchKept[i]) keptPerBin[scratchBins[i]!]!++;
    for (let i = 0; i < n; i++) if (keptPerBin[scratchBins[i]!]! === 0) scratchKept[i] = 1;
    average();
  }

  const offsets = new Float64Array(RING_BINS * CHANNELS);
  const filled: boolean[] = [];
  for (let j = 0; j < RING_BINS; j++) {
    filled[j] = counts[j]! > 0;
    if (!filled[j]) continue;
    for (let c = 0; c < CHANNELS; c++) offsets[j * CHANNELS + c] = mean[j * CHANNELS + c]!;
  }

  // Fill empty sectors by interpolating between the nearest filled ones, going round the circle.
  if (filled.some((f) => !f)) {
    for (let j = 0; j < RING_BINS; j++) {
      if (filled[j]) continue;
      let before = 1;
      while (!filled[(j - before + RING_BINS) % RING_BINS]) before++;
      let after = 1;
      while (!filled[(j + after) % RING_BINS]) after++;
      const jb = (j - before + RING_BINS) % RING_BINS;
      const ja = (j + after) % RING_BINS;
      const wAfter = before / (before + after); // nearer neighbour counts for more
      for (let c = 0; c < CHANNELS; c++) {
        offsets[j * CHANNELS + c] =
          offsets[jb * CHANNELS + c]! * (1 - wAfter) + offsets[ja * CHANNELS + c]! * wAfter;
      }
    }
  }
  return { offsets: medianRound(offsets), radius: distSum / n };
}

/** Each sector's offset replaced by the median of the MEDIAN_WINDOW sectors around it (circular), where it is an outlier. */
export function medianRound(offsets: Float64Array): Float64Array {
  const out = new Float64Array(offsets.length);
  const half = (MEDIAN_WINDOW - 1) / 2;
  const window = new Float64Array(MEDIAN_WINDOW);
  for (let j = 0; j < RING_BINS; j++) {
    for (let c = 0; c < CHANNELS; c++) {
      for (let k = -half; k <= half; k++) {
        window[k + half] = offsets[((j + k + RING_BINS) % RING_BINS) * CHANNELS + c]!;
      }
      window.sort();
      const own = offsets[j * CHANNELS + c]!;
      const median = window[half]!;
      out[j * CHANNELS + c] = Math.abs(own - median) > MEDIAN_TOLERANCE ? median : own;
    }
  }
  return out;
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
