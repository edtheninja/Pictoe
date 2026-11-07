import type { Adjustments } from "@/types/editor";

/**
 * Highlights, shadows, whites and blacks as true luminosity-weighted adjustments.
 *
 * Each slider moves only the pixels in its part of the tonal range, using a smooth weight that
 * depends on the pixel's own luminance:
 *
 *   shadows     strongest in the darks, fading out by the upper mid-tones
 *   blacks      the deepest darks only (adds to shadows at the bottom end)
 *   highlights  strongest in the brights, fading out by the lower mid-tones
 *   whites      the brightest brights only (adds to highlights at the top end)
 *
 * Mid-tones (around 50% luminance) are barely touched by any of the four. For every slider a
 * positive value brightens its region and a negative value darkens it.
 *
 * The result is a change in luminance, which the colour stage adds equally to red, green and blue,
 * so greys stay grey and the pixel's luminance moves by exactly the intended amount (until a
 * channel clips). Luminance is Rec. 709 luma of the gamma-encoded values, as in the rest of the
 * pipeline.
 *
 * This replaces flat blend-mode layers, which weighted the mid-tones most and so moved them when
 * you reached for the highlights.
 */

export const TONAL_KEYS = ["highlights", "shadows", "whites", "blacks"] as const;
export type TonalAdjustments = Pick<Adjustments, (typeof TONAL_KEYS)[number]>;

/**
 * Luminance change (0-1 scale) at full slider and full weight. Whites and blacks are smaller
 * because they stack on top of highlights and shadows in the same region.
 */
export const TONAL_STRENGTH = {
  shadows: 0.22,
  blacks: 0.1,
  highlights: 0.22,
  whites: 0.1,
} as const;

/** A slider counts as active once it is off zero by more than a tiny amount. */
const ACTIVE_THRESHOLD = 0.05;

function smooth(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** How strongly each slider acts at luminance `l` (0-1). All weights are between 0 and 1. */
export function tonalWeights(l: number) {
  return {
    shadows: 1 - smooth((l - 0.1) / 0.55),
    blacks: 1 - smooth(l / 0.3),
    highlights: smooth((l - 0.35) / 0.55),
    whites: smooth((l - 0.7) / 0.3),
  };
}

/** Total luminance change (0-1 scale) for a pixel of luminance `l`. */
export function tonalDelta(l: number, a: TonalAdjustments): number {
  const w = tonalWeights(l);
  return (
    (a.shadows / 100) * TONAL_STRENGTH.shadows * w.shadows +
    (a.blacks / 100) * TONAL_STRENGTH.blacks * w.blacks +
    (a.highlights / 100) * TONAL_STRENGTH.highlights * w.highlights +
    (a.whites / 100) * TONAL_STRENGTH.whites * w.whites
  );
}

export function hasActiveTonal(a: TonalAdjustments): boolean {
  return TONAL_KEYS.some((key) => Math.abs(a[key]) > ACTIVE_THRESHOLD);
}

/**
 * Luminance change in byte units (0-255 scale) for each luminance byte, or null when no tonal
 * slider is active and the work can be skipped.
 */
export function buildTonalTable(a: TonalAdjustments): Float32Array | null {
  if (!hasActiveTonal(a)) return null;
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = tonalDelta(i / 255, a) * 255;
  return table;
}
