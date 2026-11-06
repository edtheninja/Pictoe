import type { Adjustments } from "@/types/editor";
import { BAND_TABLE_SIZE, buildBandTable } from "./colorBands";

/**
 * The colour stage: every per-pixel colour operation, applied together in one pass over the image.
 *
 * Each operation that reads pixels back from the canvas costs a full `getImageData` /
 * `putImageData` round trip plus a loop over every pixel. Running them one after another multiplies
 * that cost, so they share one pass instead: the pixel is read once, each active operation adjusts
 * it in turn, and it is written once.
 *
 * Today the stage holds the per-colour-band saturation. Tonal accuracy, curves, full HSL and colour
 * grading are meant to be added here as further sections of the same loop.
 *
 * Pure maths on RGBA bytes: no canvas, no DOM, so it runs on the main thread or in a Worker.
 */

/** What to do this frame, worked out once from the adjustments. */
export type ColorStagePlan = {
  /** Saturation change per hue, in percent; null when no colour band is active. */
  bandTable: Float32Array | null;
};

/** Returns null when nothing in the stage is active, so the caller can skip the pixel pass entirely. */
export function planColorStage(a: Adjustments): ColorStagePlan | null {
  const bandTable = buildBandTable(a);
  if (!bandTable) return null;
  return { bandTable };
}

/** Applies the plan to RGBA pixel data in place. Alpha is untouched. */
export function applyColorStage(data: Uint8ClampedArray, plan: ColorStagePlan): void {
  const bandTable = plan.bandTable;

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

    // Per-colour-band saturation.
    let newS = s;
    if (bandTable) {
      const delta = bandTable[Math.round((hue / 360) * BAND_TABLE_SIZE) % BAND_TABLE_SIZE]!;
      if (delta === 0) continue;
      const scaled = s * (1 + delta / 100);
      newS = scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
    }

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
