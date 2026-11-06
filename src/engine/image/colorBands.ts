import type { Adjustments } from "@/types/editor";

/**
 * Per-colour-band saturation (Red / Orange / Yellow / Green / Blue / Purple): which hues each band
 * covers and how strongly each hue is moved. Each pixel's hue gets a weight from every active band
 * (cosine falloff out to HUE_BAND_HALF_WIDTH degrees); the weights sum to a saturation change.
 *
 * The weights are built into a per-hue table once per render (buildBandTable); the per-pixel work
 * itself lives in colorStage.ts, which applies it together with the rest of the colour maths in a
 * single pass over the image.
 */

export const BAND_KEYS = [
  "satRed",
  "satOrange",
  "satYellow",
  "satGreen",
  "satBlue",
  "satPurple",
] as const;

export type BandKey = (typeof BAND_KEYS)[number];

export const HUE_BAND_CENTERS: Record<BandKey, number> = {
  satRed: 0,
  satOrange: 30,
  satYellow: 60,
  satGreen: 120,
  satBlue: 210,
  satPurple: 280,
};

export const HUE_BAND_HALF_WIDTH = 45;

/** A band counts as active once it is moved off zero by more than half a slider step. */
const ACTIVE_THRESHOLD = 0.5;

/** Hue table resolution: 4 entries per degree. */
export const BAND_TABLE_SIZE = 1440;

export function activeBands(a: Adjustments): BandKey[] {
  return BAND_KEYS.filter((key) => Math.abs(a[key]) > ACTIVE_THRESHOLD);
}

export function hasActiveBands(a: Adjustments): boolean {
  return BAND_KEYS.some((key) => Math.abs(a[key]) > ACTIVE_THRESHOLD);
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Saturation change, in percent, for each hue (index / BAND_TABLE_SIZE * 360 degrees), or null when
 * no band is active and the pass can be skipped.
 */
export function buildBandTable(a: Adjustments): Float32Array | null {
  const bands = activeBands(a);
  if (bands.length === 0) return null;
  const table = new Float32Array(BAND_TABLE_SIZE);
  for (let i = 0; i < BAND_TABLE_SIZE; i++) {
    const hue = (i / BAND_TABLE_SIZE) * 360;
    let delta = 0;
    for (const key of bands) {
      const dist = hueDistance(hue, HUE_BAND_CENTERS[key]);
      if (dist >= HUE_BAND_HALF_WIDTH) continue;
      delta += Math.cos((dist / HUE_BAND_HALF_WIDTH) * (Math.PI / 2)) * a[key];
    }
    table[i] = delta;
  }
  return table;
}
