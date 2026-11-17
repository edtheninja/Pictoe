import { dabReach, type Patch, type Rect } from "./cloneStamp";

/**
 * Picks where to copy from for a one-tap spot heal, so the user does not have to choose a
 * source. Pure: it reads a patch of pixels and returns an offset, with no DOM and no randomness,
 * so the same picture and spot always give the same answer.
 *
 * A good source for healing is one whose surroundings look like the target's surroundings (then
 * the heal blend has little to correct and the patch sits in naturally), and whose own contents
 * are clean: no blemish or hard edge inside it, and about as much texture as the target's
 * neighbourhood. Each candidate is scored on three things, in colour levels (0-255), lower is
 * better:
 *
 *   ring    How different its surrounding ring is from the target's ring: the RMS difference of
 *           the colour averaged in 8 angular sectors. This is direction-aware, so a target on
 *           the edge of a gradient or a horizon prefers a source with the same edge.
 *   texture How different the amount of texture inside the candidate is from the amount in the
 *           target's ring (standard deviation of luminance).
 *   clean   How far the candidate's own average is from its own ring's average. A patch that
 *           contains a spot of its own differs from its surroundings; a clean one does not.
 *
 * plus a tiny preference for nearer candidates, to break ties.
 *
 * Bounded by construction: a fixed fan of DIRECTIONS × DISTANCE_STEPS candidate positions, one
 * refinement round of 8 neighbours around the best, and a fixed number of sample points per
 * candidate (RING_SAMPLES + DISC_SAMPLES), whatever the brush size. So at most
 * MAX_EVALUATIONS candidates and about 11,000 pixel reads, about a millisecond (0.4 to 1.1 ms,
 * measured in Node on a 24 MP photo, at brush radii from 4 to 400 px). Reading the window of
 * pixels it needs is the larger cost, which is why the range is capped (MAX_SEARCH_DISTANCE).
 */

export type Spot = { cx: number; cy: number; r: number };

export type AutoSource = {
  /** Source centre minus target centre, in pixels (what a stroke's dx, dy become when divided by the image size). */
  dx: number;
  dy: number;
  /** The winning candidate's score (lower is better, in colour levels). */
  score: number;
  /** How many candidates were scored: never more than MAX_EVALUATIONS. */
  evaluated: number;
};

export const DIRECTIONS = 16;
export const DISTANCE_STEPS = 6;
export const REFINE_NEIGHBOURS = 8;
export const MAX_EVALUATIONS = DIRECTIONS * DISTANCE_STEPS + REFINE_NEIGHBOURS;

const SECTORS = 8;
const RING_SAMPLES = 48; // 6 per sector
const DISC_SAMPLES = 32;
/** A ring needs at least this share of its samples on the picture to be trusted. */
const MIN_RING_SHARE = 0.75;
const NEARNESS_WEIGHT = 0.05;
const GOLDEN_ANGLE = 2.399963229728653;

/** How far from its centre a heal of this spot reads: its radius plus the measuring ring. */
const reachOf = (spot: Spot) =>
  dabReach({ cx: spot.cx, cy: spot.cy, dx: 0, dy: 0, r: spot.r, softness: 0, mode: "heal" });

/**
 * The furthest a source is looked for, in pixels from the spot's centre, however big the brush.
 * The search itself is cheap whatever its range (about a millisecond), but it has to read every
 * pixel within that range first, and that read grows with the square of the range: without a cap
 * a 120 px brush on a 24 MP photo would read 13.7 megapixels (about 55 MB) for one tap.
 */
export const MAX_SEARCH_DISTANCE = 600;

/** Where to look, as a distance from the spot's centre: 10 reaches, but at least 60 px and at most MAX_SEARCH_DISTANCE. */
export function defaultMaxDistance(spot: Spot): number {
  return Math.min(MAX_SEARCH_DISTANCE, Math.max(60, 10 * reachOf(spot)));
}

/** The part of the picture the search can read: everything within the search range of the spot. */
export function autoSourceWindow(
  spot: Spot,
  imgW: number,
  imgH: number,
  maxDistance = defaultMaxDistance(spot),
): Rect {
  const reach = reachOf(spot);
  const half = Math.ceil(maxDistance + reach) + 1;
  const x0 = Math.max(0, Math.floor(spot.cx - half));
  const y0 = Math.max(0, Math.floor(spot.cy - half));
  const x1 = Math.min(imgW, Math.ceil(spot.cx + half));
  const y1 = Math.min(imgH, Math.ceil(spot.cy + half));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

type Stats = {
  /** Mean colour per angular sector: SECTORS × 3. Ring only. */
  sectors: Float64Array;
  /** Mean colour over all samples. */
  mean: Float64Array;
  /** Standard deviation of luminance over the samples. */
  lumaStd: number;
};

/** One sample point as an offset from a centre, for a spot of radius r. Built once per search. */
type Pattern = { dx: Float64Array; dy: Float64Array; sector: Uint8Array };

function ringPattern(r: number, reach: number): Pattern {
  const dx = new Float64Array(RING_SAMPLES);
  const dy = new Float64Array(RING_SAMPLES);
  const sector = new Uint8Array(RING_SAMPLES);
  for (let j = 0; j < RING_SAMPLES; j++) {
    const angle = ((j + 0.5) / RING_SAMPLES) * 2 * Math.PI;
    // Spread radii through the ring so the samples do not all sit on one circle.
    const t = 0.2 + 0.6 * ((j * 0.6180339887) % 1);
    const radius = r + (reach - r) * t;
    dx[j] = Math.cos(angle) * radius;
    dy[j] = Math.sin(angle) * radius;
    sector[j] = Math.floor((j * SECTORS) / RING_SAMPLES);
  }
  return { dx, dy, sector };
}

function discPattern(r: number): Pattern {
  const dx = new Float64Array(DISC_SAMPLES);
  const dy = new Float64Array(DISC_SAMPLES);
  for (let i = 0; i < DISC_SAMPLES; i++) {
    const radius = r * 0.9 * Math.sqrt((i + 0.5) / DISC_SAMPLES);
    dx[i] = Math.cos(i * GOLDEN_ANGLE) * radius;
    dy[i] = Math.sin(i * GOLDEN_ANGLE) * radius;
  }
  return { dx, dy, sector: new Uint8Array(DISC_SAMPLES) };
}

/** Reads the pixel under (x, y), or false if it is off the picture or outside the patch read. */
function read(
  p: Patch,
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  out: Float64Array,
): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= imgW || iy >= imgH) return false;
  const lx = ix - p.x;
  const ly = iy - p.y;
  if (lx < 0 || ly < 0 || lx >= p.w || ly >= p.h) return false;
  const at = (ly * p.w + lx) * 4;
  out[0] = p.data[at]!;
  out[1] = p.data[at + 1]!;
  out[2] = p.data[at + 2]!;
  return true;
}

const luma = (c: Float64Array) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;

function measure(
  p: Patch,
  imgW: number,
  imgH: number,
  cx: number,
  cy: number,
  pattern: Pattern,
  withSectors: boolean,
): Stats | null {
  const n = pattern.dx.length;
  const sectors = new Float64Array(SECTORS * 3);
  const sectorCounts = new Uint16Array(SECTORS);
  const mean = new Float64Array(3);
  const px = new Float64Array(3);
  let used = 0;
  let lumaSum = 0;
  let lumaSq = 0;

  for (let i = 0; i < n; i++) {
    if (!read(p, imgW, imgH, cx + pattern.dx[i]!, cy + pattern.dy[i]!, px)) continue;
    used++;
    for (let c = 0; c < 3; c++) mean[c]! += px[c]!;
    const l = luma(px);
    lumaSum += l;
    lumaSq += l * l;
    if (withSectors) {
      const s = pattern.sector[i]!;
      for (let c = 0; c < 3; c++) sectors[s * 3 + c]! += px[c]!;
      sectorCounts[s]!++;
    }
  }
  if (used < n * MIN_RING_SHARE) return null;

  for (let c = 0; c < 3; c++) mean[c]! /= used;
  if (withSectors) {
    for (let s = 0; s < SECTORS; s++) {
      // A sector the picture cuts off takes the overall mean, so it adds no false difference.
      if (sectorCounts[s]! === 0) for (let c = 0; c < 3; c++) sectors[s * 3 + c] = mean[c]!;
      else for (let c = 0; c < 3; c++) sectors[s * 3 + c]! /= sectorCounts[s]!;
    }
  }
  const lumaMean = lumaSum / used;
  return { sectors, mean, lumaStd: Math.sqrt(Math.max(0, lumaSq / used - lumaMean * lumaMean)) };
}

/**
 * Finds the best place to copy from for a spot, or null when there is nowhere to look: the
 * target's own surroundings cannot be measured (spot too near the picture's edge), or no
 * candidate fits on the picture without touching the spot.
 *
 * `patch` must cover autoSourceWindow(spot, ...) (more is fine); `imgW`, `imgH` are the whole
 * picture's size. Pixels outside the patch count as off the picture.
 */
export function findAutoSource(
  patch: Patch,
  imgW: number,
  imgH: number,
  spot: Spot,
  maxDistance = defaultMaxDistance(spot),
): AutoSource | null {
  const reach = reachOf(spot);
  const ring = ringPattern(spot.r, reach);
  const disc = discPattern(spot.r);

  const target = measure(patch, imgW, imgH, spot.cx, spot.cy, ring, true);
  if (!target) return null;

  // A candidate's disc and ring must not touch the spot itself.
  const minDistance = spot.r + reach;
  const maxD = Math.max(maxDistance, minDistance * 1.01);

  let evaluated = 0;
  const score = (dx: number, dy: number): number => {
    const d = Math.hypot(dx, dy);
    if (d < minDistance) return Infinity;
    const cx = spot.cx + dx;
    const cy = spot.cy + dy;
    // The candidate and its ring must lie wholly on the picture.
    if (cx - reach < 0 || cy - reach < 0 || cx + reach > imgW || cy + reach > imgH) return Infinity;
    evaluated++;

    const around = measure(patch, imgW, imgH, cx, cy, ring, true);
    const inside = measure(patch, imgW, imgH, cx, cy, disc, false);
    if (!around || !inside) return Infinity;

    let sq = 0;
    for (let i = 0; i < SECTORS * 3; i++) sq += (target.sectors[i]! - around.sectors[i]!) ** 2;
    const ringScore = Math.sqrt(sq / (SECTORS * 3));

    const textureScore = Math.abs(inside.lumaStd - target.lumaStd);

    let cleanSq = 0;
    for (let c = 0; c < 3; c++) cleanSq += (inside.mean[c]! - around.mean[c]!) ** 2;
    const cleanScore = Math.sqrt(cleanSq / 3);

    return ringScore + textureScore + cleanScore + NEARNESS_WEIGHT * (d / maxD);
  };

  let best = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  const growth = Math.pow(maxD / minDistance, 1 / (DISTANCE_STEPS - 1));
  for (let k = 0; k < DISTANCE_STEPS; k++) {
    const d = minDistance * Math.pow(growth, k);
    for (let a = 0; a < DIRECTIONS; a++) {
      const angle = (a / DIRECTIONS) * 2 * Math.PI;
      const dx = Math.cos(angle) * d;
      const dy = Math.sin(angle) * d;
      const s = score(dx, dy);
      if (s < best) {
        best = s;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  if (!Number.isFinite(best)) return null;

  // One refinement round: the eight neighbours of the winner, a little way off.
  const step = Math.max(1, 0.15 * Math.hypot(bestDx, bestDy));
  const centreDx = bestDx;
  const centreDy = bestDy;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      if (i === 0 && j === 0) continue;
      const dx = centreDx + i * step;
      const dy = centreDy + j * step;
      const s = score(dx, dy);
      if (s < best) {
        best = s;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  return { dx: bestDx, dy: bestDy, score: best, evaluated };
}
