import type { Adjustments } from "@/types/editor";
import { BAND_TABLE_SIZE, buildBandTable } from "./colorBands";
import { buildTonalTable } from "./tonal";

/**
 * The colour stage: every per-pixel colour operation, applied together in one pass over the image.
 *
 * Each operation that reads pixels back from the canvas costs a full `getImageData` /
 * `putImageData` round trip plus a loop over every pixel. Running them one after another multiplies
 * that cost, so they share one pass instead: the pixel is read once, each active operation adjusts
 * it in turn, and it is written once.
 *
 * Today the stage holds the highlights / shadows / whites / blacks adjustments (tonal.ts) and the
 * per-colour-band saturation (colorBands.ts). Curves, full HSL and colour grading are meant to be
 * added here as further sections of the same loop. The order inside the loop is the order the
 * operations are applied: tonal first, then colour bands on the result.
 *
 * Pure maths on RGBA bytes: no canvas, no DOM, so it runs on the main thread or in a Worker.
 */

/** What to do this frame, worked out once from the adjustments. */
export type ColorStagePlan = {
  /** Luminance change per luminance byte, in byte units; null when no tonal slider is active. */
  tonalTable: Float32Array | null;
  /** Saturation change per hue, in percent; null when no colour band is active. */
  bandTable: Float32Array | null;
};

/** Returns null when nothing in the stage is active, so the caller can skip the pixel pass entirely. */
export function planColorStage(a: Adjustments): ColorStagePlan | null {
  const tonalTable = buildTonalTable(a);
  const bandTable = buildBandTable(a);
  if (!tonalTable && !bandTable) return null;
  return { tonalTable, bandTable };
}

/** Applies the plan to RGBA pixel data in place. Alpha is untouched. */
export function applyColorStage(data: Uint8ClampedArray, plan: ColorStagePlan): void {
  const { tonalTable, bandTable } = plan;

  for (let i = 0; i < data.length; i += 4) {
    // Highlights / shadows / whites / blacks: shift luminance by an amount that depends on the
    // pixel's own luminance. Adding the same value to all three channels moves luminance by exactly
    // that amount and keeps greys grey; the typed array rounds and clamps on assignment.
    if (tonalTable) {
      const luma = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
      const shift = tonalTable[luma]!;
      if (shift !== 0) {
        data[i] = data[i]! + shift;
        data[i + 1] = data[i + 1]! + shift;
        data[i + 2] = data[i + 2]! + shift;
      }
    }

    if (!bandTable) continue;

    // Per-colour-band saturation, on the pixel as the tonal step left it.
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

    const delta = bandTable[Math.round((hue / 360) * BAND_TABLE_SIZE) % BAND_TABLE_SIZE]!;
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
