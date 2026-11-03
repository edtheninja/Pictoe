import type { Adjustments } from "@/types/editor";

/**
 * Per-colour-band saturation (Red / Orange / Yellow / Green / Blue / Purple).
 *
 * Pure pixel maths on RGBA bytes: no canvas, no DOM, so it can run on the main thread today and
 * in a Worker later. Each pixel's hue gets a weight from every active band (cosine falloff out to
 * HUE_BAND_HALF_WIDTH degrees); the weights sum to a saturation change.
 *
 * This loop used to allocate two objects per pixel and run `cos` for every band; it was the
 * slowest stage in the pipeline. It now takes the per-hue weight from a table built once per call
 * and works on plain numbers. Output matches the old implementation to within one level on any
 * channel (the table steps hue in 0.25° increments); colorBands.test.ts keeps the old
 * implementation as the reference.
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
const LUT_SIZE = 1440;

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

/** Saturation change, in percent, for each hue (index / LUT_SIZE * 360 degrees). */
function buildDeltaTable(a: Adjustments, bands: readonly BandKey[]): Float32Array {
  const table = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const hue = (i / LUT_SIZE) * 360;
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

/** Applies the band saturation settings to RGBA pixel data in place. Alpha is untouched. */
export function applyColorBands(data: Uint8ClampedArray, a: Adjustments): void {
  const bands = activeBands(a);
  if (bands.length === 0) return;
  const table = buildDeltaTable(a, bands);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (max === min) continue; // grey: no hue to adjust

    const sum = (max + min) / 255;
    const range = max - min;
    const l = sum / 2;
    const s = l > 0.5 ? range / 255 / (2 - sum) : range / 255 / sum;
    if (s < 0.02) continue;

    let hue: number;
    if (max === r) hue = ((g - b) / range + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / range + 2) * 60;
    else hue = ((r - g) / range + 4) * 60;

    const delta = table[Math.round((hue / 360) * LUT_SIZE) % LUT_SIZE]!;
    if (delta === 0) continue;

    const scaled = s * (1 + delta / 100);
    const newS = scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;

    const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
    const p = 2 * l - q;
    const hk = hue / 360;
    data[i] = Math.round(channel(p, q, hk + 1 / 3) * 255);
    data[i + 1] = Math.round(channel(p, q, hk) * 255);
    data[i + 2] = Math.round(channel(p, q, hk - 1 / 3) * 255);
  }
}

function channel(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}
