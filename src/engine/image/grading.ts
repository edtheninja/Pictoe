import { GRADE_RANGES, gradeKey, type Adjustments, type GradeRange } from "@/types/editor";
import { tonalWeights } from "./tonal";

/**
 * Colour grading: a tint and a luminance shift for each of three tonal ranges (shadows, mid-tones,
 * highlights), the way a colourist adds a cool tint to the darks and a warm one to the brights.
 *
 * How much of each range a pixel belongs to depends only on its luminance. The weights are the same
 * smooth ones the tonal sliders use (tonal.ts): shadows and highlights fall and rise with
 * luminance, and the mid-tones are whatever is left, so the three always add up to exactly 1. The
 * balance slider slides the whole split toward the shadows (negative) or the highlights (positive).
 *
 * A range's tint is its hue at its saturation, applied as a change to red, green and blue that has
 * no net effect on luminance (the pure colour minus its own luma), so tinting colours a pixel
 * without brightening or darkening it. The range's luminance slider then moves luminance by the same
 * amount on all three channels. Everything depends only on the pixel's luminance, so the whole
 * grade is one lookup per pixel.
 *
 * Unlike the colour mixer, grading also tints greys: that is the point of it.
 */

/** Size of a full-saturation, full-weight tint, as a fraction of the 0-1 channel range. */
export const TINT_STRENGTH = 0.2;
/** Luminance change of a full luminance slider at full weight, as a fraction of the range. */
export const GRADE_LUM_SHIFT = 0.15;
/** How far a full balance slider slides the shadow/highlight split, in luminance (0-1) units. */
export const BALANCE_SHIFT = 0.25;

/** A slider counts as active once it is off zero by more than half a step. */
const ACTIVE_THRESHOLD = 0.5;

const LOWER: Record<GradeRange, "shadows" | "midtones" | "highlights"> = {
  Shadows: "shadows",
  Midtones: "midtones",
  Highlights: "highlights",
};

/** How strongly each range applies at luminance `l` (0-1). The three always add up to 1. */
export function gradeWeights(l: number, balance: number) {
  const shifted = Math.min(1, Math.max(0, l + (balance / 100) * BALANCE_SHIFT));
  const w = tonalWeights(shifted);
  return {
    shadows: w.shadows,
    highlights: w.highlights,
    midtones: Math.max(0, 1 - w.shadows - w.highlights),
  };
}

/**
 * The pure colour of a hue (0-360), minus its own luma on every channel, so that the offset has
 * zero luminance: [r, g, b] each between -1 and 1.
 */
export function hueOffset(hue: number): [number, number, number] {
  const h = ((((hue % 360) + 360) % 360) / 60) % 6;
  const x = 1 - Math.abs((h % 2) - 1);
  let rgb: [number, number, number];
  if (h < 1) rgb = [1, x, 0];
  else if (h < 2) rgb = [x, 1, 0];
  else if (h < 3) rgb = [0, 1, x];
  else if (h < 4) rgb = [0, x, 1];
  else if (h < 5) rgb = [x, 0, 1];
  else rgb = [1, 0, x];
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [rgb[0] - luma, rgb[1] - luma, rgb[2] - luma];
}

function rangeActive(a: Adjustments, range: GradeRange): boolean {
  return (
    Math.abs(a[gradeKey(range, "sat")]) > ACTIVE_THRESHOLD ||
    Math.abs(a[gradeKey(range, "lum")]) > ACTIVE_THRESHOLD
  );
}

export function hasActiveGrading(a: Adjustments): boolean {
  return GRADE_RANGES.some((range) => rangeActive(a, range));
}

/** Change to red, green and blue (0-1 scale) for a pixel of luminance `l`. */
export function gradeDelta(l: number, a: Adjustments): [number, number, number] {
  const w = gradeWeights(l, a.gradeBalance);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const range of GRADE_RANGES) {
    if (!rangeActive(a, range)) continue;
    const strength = (a[gradeKey(range, "sat")] / 100) * TINT_STRENGTH;
    const lum = (a[gradeKey(range, "lum")] / 100) * GRADE_LUM_SHIFT;
    const [dr, dg, db] = hueOffset(a[gradeKey(range, "hue")]);
    const weight = w[LOWER[range]];
    r += weight * (strength * dr + lum);
    g += weight * (strength * dg + lum);
    b += weight * (strength * db + lum);
  }
  return [r, g, b];
}

/**
 * Change to red, green and blue in byte units for each luminance byte, three numbers per entry
 * (index * 3 + channel), or null when no range is active and the work can be skipped.
 */
export function buildGradingTable(a: Adjustments): Float32Array | null {
  if (!hasActiveGrading(a)) return null;
  const table = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = gradeDelta(i / 255, a);
    table[i * 3] = r * 255;
    table[i * 3 + 1] = g * 255;
    table[i * 3 + 2] = b * 255;
  }
  return table;
}
