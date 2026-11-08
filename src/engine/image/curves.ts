import { identityCurve, type CurvePoint, type CurvesState } from "@/types/editor";

/**
 * Tone curves: the maths, the lookup tables the colour stage uses, and the point-editing rules the
 * curve editor follows. No canvas and no DOM.
 *
 * A curve is a list of control points sorted by x, running from x = 0 to x = 1. Between points it
 * is a monotone cubic Hermite spline (Fritsch-Carlson): smooth, passes through every point, and
 * never overshoots between two neighbouring points, so a curve can't ring or clip on its own.
 */

/** Most control points one curve may have. */
export const MAX_CURVE_POINTS = 16;
/** Closest two neighbouring points may sit, as a fraction of the input range. */
export const MIN_POINT_GAP = 0.02;

const EPSILON = 1e-6;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** True when the curve changes nothing (every point on the straight line y = x). */
export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  return points.every((p) => Math.abs(p.x - p.y) < EPSILON);
}

/**
 * Value of the curve at input `x`. Points must already be valid (see normalizeCurve).
 */
export function evalCurve(points: readonly CurvePoint[], x: number): number {
  const n = points.length;
  if (n < 2) return clamp01(x);
  const first = points[0]!;
  const last = points[n - 1]!;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  const slopes = tangents(points);
  let i = 0;
  while (i < n - 2 && x > points[i + 1]!.x) i++;
  const p0 = points[i]!;
  const p1 = points[i + 1]!;
  const h = p1.x - p0.x;
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const y =
    (2 * t3 - 3 * t2 + 1) * p0.y +
    (t3 - 2 * t2 + t) * h * slopes[i]! +
    (-2 * t3 + 3 * t2) * p1.y +
    (t3 - t2) * h * slopes[i + 1]!;
  return clamp01(y);
}

/** Fritsch-Carlson tangents: zero at turning points, limited so no segment overshoots. */
function tangents(points: readonly CurvePoint[]): number[] {
  const n = points.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    delta.push((points[i + 1]!.y - points[i]!.y) / (points[i + 1]!.x - points[i]!.x));
  }
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / delta[i]!;
    const b = m[i + 1]! / delta[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i]!;
      m[i + 1] = tau * b * delta[i]!;
    }
  }
  return m;
}

/** The curve sampled at 256 input levels, as outputs between 0 and 1. */
export function sampleCurve(points: readonly CurvePoint[]): Float32Array {
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) out[i] = evalCurve(points, i / 255);
  return out;
}

/** What the colour stage needs per frame: null for a curve that changes nothing. */
export type CurvesPlan = {
  /** Output byte for each input byte, applied to red, green and blue separately. */
  rgbLut: Uint8ClampedArray | null;
  /** Luminance change in byte units for each luminance byte, added to all three channels. */
  lumaTable: Float32Array | null;
};

export function buildCurvesPlan(curves: CurvesState): CurvesPlan | null {
  let rgbLut: Uint8ClampedArray | null = null;
  let lumaTable: Float32Array | null = null;

  if (!isIdentityCurve(curves.rgb)) {
    const samples = sampleCurve(curves.rgb);
    rgbLut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) rgbLut[i] = Math.round(samples[i]! * 255);
  }
  if (!isIdentityCurve(curves.luma)) {
    const samples = sampleCurve(curves.luma);
    lumaTable = new Float32Array(256);
    for (let i = 0; i < 256; i++) lumaTable[i] = (samples[i]! - i / 255) * 255;
  }
  return rgbLut || lumaTable ? { rgbLut, lumaTable } : null;
}

// ---------------------------------------------------------------------------------------------
// Validation: turn anything into a curve the engine can use
// ---------------------------------------------------------------------------------------------

/**
 * Repairs a list of points: drops invalid ones, clamps to 0..1, sorts by x, pins the first point
 * to x = 0 and the last to x = 1, enforces the minimum gap and the point limit. Anything that
 * can't form a curve becomes the identity line. Idempotent.
 */
export function normalizeCurve(raw: unknown): CurvePoint[] {
  if (!Array.isArray(raw)) return identityCurve();
  const valid: CurvePoint[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { x, y } = item as Record<string, unknown>;
    if (isFiniteNumber(x) && isFiniteNumber(y)) valid.push({ x: clamp01(x), y: clamp01(y) });
  }
  if (valid.length < 2) return identityCurve();
  valid.sort((a, b) => a.x - b.x);

  // Endpoints are the points at the two ends, pinned to x = 0 and x = 1.
  const first = { x: 0, y: valid[0]!.y };
  const last = { x: 1, y: valid[valid.length - 1]!.y };
  const interior: CurvePoint[] = [];
  let previousX = 0;
  for (const p of valid.slice(1, -1)) {
    if (p.x - previousX < MIN_POINT_GAP || 1 - p.x < MIN_POINT_GAP) continue;
    if (interior.length >= MAX_CURVE_POINTS - 2) break;
    interior.push({ x: p.x, y: p.y });
    previousX = p.x;
  }
  return [first, ...interior, last];
}

export function normalizeCurves(raw: unknown): CurvesState {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { rgb: normalizeCurve(source["rgb"]), luma: normalizeCurve(source["luma"]) };
}

// ---------------------------------------------------------------------------------------------
// Point editing: the rules the curve editor follows (pure, so they can be tested)
// ---------------------------------------------------------------------------------------------

/**
 * Moves point `index`. The end points keep x = 0 and x = 1 and only move up and down; an interior
 * point stays between its neighbours, at least MIN_POINT_GAP from each.
 */
export function movePoint(
  points: readonly CurvePoint[],
  index: number,
  x: number,
  y: number,
): CurvePoint[] {
  const last = points.length - 1;
  if (index < 0 || index > last) return points.map((p) => ({ ...p }));
  const next = points.map((p) => ({ ...p }));
  const target = next[index]!;
  target.y = clamp01(y);
  if (index > 0 && index < last) {
    const low = points[index - 1]!.x + MIN_POINT_GAP;
    const high = points[index + 1]!.x - MIN_POINT_GAP;
    target.x = Math.min(high, Math.max(low, clamp01(x)));
  }
  return next;
}

/**
 * Adds a point at (x, y). Returns the new list and the new point's index, or null when the curve is
 * full or the spot is within MIN_POINT_GAP of an existing point.
 */
export function insertPoint(
  points: readonly CurvePoint[],
  x: number,
  y: number,
): { points: CurvePoint[]; index: number } | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  const px = clamp01(x);
  if (px < MIN_POINT_GAP || px > 1 - MIN_POINT_GAP) return null;
  if (points.some((p) => Math.abs(p.x - px) < MIN_POINT_GAP)) return null;
  let index = points.findIndex((p) => p.x > px);
  if (index === -1) index = points.length;
  const next = points.map((p) => ({ ...p }));
  next.splice(index, 0, { x: px, y: clamp01(y) });
  return { points: next, index };
}

/** Removes an interior point. The two end points can't be removed. */
export function removePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1) return points.map((p) => ({ ...p }));
  return points.filter((_, i) => i !== index).map((p) => ({ ...p }));
}

/** Arrow-key step, and the larger step used while Shift is held. */
export const KEY_STEP = 0.01;
export const KEY_STEP_BIG = 0.05;

export type CurveKeyAction =
  /** A gesture: it should be recorded begin -> change -> end so a held key is one undo step. */
  | { kind: "move"; points: CurvePoint[] }
  /** A one-step change: the point was deleted; focus moves to `focusIndex`. */
  | { kind: "remove"; points: CurvePoint[]; focusIndex: number }
  | null;

/**
 * What a key press does to the focused point `index`: arrows move it (Shift for bigger steps),
 * Delete or Backspace removes an interior point. Anything else, and Delete on an end point, does
 * nothing (null).
 */
export function curveKeyAction(
  points: readonly CurvePoint[],
  index: number,
  key: string,
  shift: boolean,
): CurveKeyAction {
  const point = points[index];
  if (!point) return null;
  const step = shift ? KEY_STEP_BIG : KEY_STEP;
  switch (key) {
    case "ArrowUp":
      return { kind: "move", points: movePoint(points, index, point.x, point.y + step) };
    case "ArrowDown":
      return { kind: "move", points: movePoint(points, index, point.x, point.y - step) };
    case "ArrowLeft":
      return { kind: "move", points: movePoint(points, index, point.x - step, point.y) };
    case "ArrowRight":
      return { kind: "move", points: movePoint(points, index, point.x + step, point.y) };
    case "Delete":
    case "Backspace":
      if (index <= 0 || index >= points.length - 1) return null;
      return { kind: "remove", points: removePoint(points, index), focusIndex: index - 1 };
    default:
      return null;
  }
}

/**
 * Where "Add point" puts a new point when no position was chosen: halfway across the widest gap,
 * on the curve. Null when the curve is full or no gap is wide enough.
 */
export function suggestInsertion(points: readonly CurvePoint[]): { x: number; y: number } | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  let best = -1;
  let widest = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const gap = points[i + 1]!.x - points[i]!.x;
    if (gap > widest) {
      widest = gap;
      best = i;
    }
  }
  if (best < 0 || widest < MIN_POINT_GAP * 2) return null;
  const x = points[best]!.x + widest / 2;
  return { x, y: evalCurve(points, x) };
}
