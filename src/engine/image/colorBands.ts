import { BAND_NAMES, bandKey, type Adjustments, type BandName } from "@/types/editor";

/**
 * The colour mixer: hue, saturation and luminance for each of six colour bands
 * (Red / Orange / Yellow / Green / Blue / Purple).
 *
 * Each band covers the hues around its centre. A pixel's hue gets a weight from every band, with a
 * cosine falloff out to HUE_BAND_HALF_WIDTH degrees, and the weights, scaled by the band's sliders,
 * add up to three changes for that hue:
 *
 *   saturation   percent change of the pixel's saturation
 *   hue          degrees the pixel's hue turns (positive turns towards the next band: red to
 *                orange to yellow ...), at most HUE_SHIFT_DEGREES at a full slider
 *   luminance    change of the pixel's HSL lightness: positive moves it toward white by up to
 *                LUM_STRENGTH of the remaining distance, negative moves it toward black by up to
 *                LUM_STRENGTH of its current value
 *
 * The three changes are built into per-hue tables once per render (buildBandTables); the per-pixel
 * work lives in colorStage.ts, which applies it together with the rest of the colour maths in a
 * single pass over the image.
 */

export const BAND_CENTERS: Record<BandName, number> = {
  Red: 0,
  Orange: 30,
  Yellow: 60,
  Green: 120,
  Blue: 210,
  Purple: 280,
};

export const HUE_BAND_HALF_WIDTH = 45;
/** Hue turn at a full slider and full band weight, in degrees. */
export const HUE_SHIFT_DEGREES = 30;
/** Fraction of the available range a full luminance slider moves a pixel. */
export const LUM_STRENGTH = 0.5;

/** A slider counts as active once it is moved off zero by more than half a step. */
const ACTIVE_THRESHOLD = 0.5;

/** Hue table resolution: 4 entries per degree. */
export const BAND_TABLE_SIZE = 1440;

const ALL_KEYS = BAND_NAMES.flatMap((band) => [
  bandKey("hue", band),
  bandKey("sat", band),
  bandKey("lum", band),
]);

export function hasActiveBands(a: Adjustments): boolean {
  return ALL_KEYS.some((key) => Math.abs(a[key]) > ACTIVE_THRESHOLD);
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** What the colour mixer does to each hue (index / BAND_TABLE_SIZE * 360 degrees). */
export type BandTables = {
  /** Saturation change in percent. */
  sat: Float32Array;
  /** Hue turn in degrees. */
  hue: Float32Array;
  /** Luminance change, between -1 and 1 (see LUM_STRENGTH). */
  lum: Float32Array;
  /** 1 where any of the three changes is non-zero; pixels at other hues can be skipped outright. */
  touched: Uint8Array;
};

/** Returns null when no mixer slider is active, so the pass can be skipped. */
export function buildBandTables(a: Adjustments): BandTables | null {
  const active = BAND_NAMES.filter(
    (band) =>
      Math.abs(a[bandKey("hue", band)]) > ACTIVE_THRESHOLD ||
      Math.abs(a[bandKey("sat", band)]) > ACTIVE_THRESHOLD ||
      Math.abs(a[bandKey("lum", band)]) > ACTIVE_THRESHOLD,
  );
  if (active.length === 0) return null;

  const sat = new Float32Array(BAND_TABLE_SIZE);
  const hue = new Float32Array(BAND_TABLE_SIZE);
  const lum = new Float32Array(BAND_TABLE_SIZE);
  const touched = new Uint8Array(BAND_TABLE_SIZE);

  for (let i = 0; i < BAND_TABLE_SIZE; i++) {
    const h = (i / BAND_TABLE_SIZE) * 360;
    let s = 0;
    let t = 0;
    let l = 0;
    for (const band of active) {
      const dist = hueDistance(h, BAND_CENTERS[band]);
      if (dist >= HUE_BAND_HALF_WIDTH) continue;
      const weight = Math.cos((dist / HUE_BAND_HALF_WIDTH) * (Math.PI / 2));
      s += weight * a[bandKey("sat", band)];
      t += weight * (a[bandKey("hue", band)] / 100) * HUE_SHIFT_DEGREES;
      l += weight * (a[bandKey("lum", band)] / 100);
    }
    sat[i] = s;
    hue[i] = t;
    lum[i] = l < -1 ? -1 : l > 1 ? 1 : l;
    touched[i] = s !== 0 || t !== 0 || l !== 0 ? 1 : 0;
  }
  return { sat, hue, lum, touched };
}
