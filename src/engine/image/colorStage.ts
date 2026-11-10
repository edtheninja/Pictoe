import type { Adjustments, CurvesState } from "@/types/editor";
import { BAND_TABLE_SIZE, LUM_STRENGTH, buildBandTables, type BandTables } from "./colorBands";
import { buildCurvesPlan, type CurvesPlan } from "./curves";
import { buildGradingTable } from "./grading";
import { buildTonalTable } from "./tonal";

/**
 * The colour stage: every per-pixel colour operation, applied together in one pass over the image.
 *
 * Each operation that reads pixels back from the canvas costs a full `getImageData` /
 * `putImageData` round trip plus a loop over every pixel. Running them one after another multiplies
 * that cost, so they share one pass instead: the pixel is read once, each active operation adjusts
 * it in turn, and it is written once.
 *
 * Today the stage holds the highlights / shadows / whites / blacks adjustments (tonal.ts), the tone
 * curves (curves.ts), the colour mixer (colorBands.ts) and colour grading (grading.ts). The order
 * inside the loop is the order the operations are applied: tonal, the RGB curve, the luminance
 * curve, the colour mixer, then colour grading, each on the result of the one before.
 *
 * Pure maths on RGBA bytes: no canvas, no DOM, so it runs on the main thread or in a Worker.
 */

/** What to do this frame, worked out once from the adjustments. */
export type ColorStagePlan = {
  /** Luminance change per luminance byte, in byte units; null when no tonal slider is active. */
  tonalTable: Float32Array | null;
  /** Tone curve lookup tables; null when both curves are the straight line. */
  curves: CurvesPlan | null;
  /** Colour mixer changes per hue; null when no mixer slider is active. */
  bands: BandTables | null;
  /** Colour grading change to red, green and blue per luminance byte; null when no range is active. */
  grading: Float32Array | null;
};

/** Returns null when nothing in the stage is active, so the caller can skip the pixel pass entirely. */
export function planColorStage(a: Adjustments, curves?: CurvesState): ColorStagePlan | null {
  const tonalTable = buildTonalTable(a);
  const curvesPlan = curves ? buildCurvesPlan(curves) : null;
  const bands = buildBandTables(a);
  const grading = buildGradingTable(a);
  if (!tonalTable && !curvesPlan && !bands && !grading) return null;
  return { tonalTable, curves: curvesPlan, bands, grading };
}

/** Applies the plan to RGBA pixel data in place. Alpha is untouched. */
export function applyColorStage(data: Uint8ClampedArray, plan: ColorStagePlan): void {
  const { tonalTable, bands, grading } = plan;
  const rgbLut = plan.curves?.rgbLut ?? null;
  const lumaTable = plan.curves?.lumaTable ?? null;

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

    // RGB curve: every channel goes through the same curve on its own, so a curve that isn't a
    // straight line can also change colour (an S-curve adds contrast and saturation).
    if (rgbLut) {
      data[i] = rgbLut[data[i]!]!;
      data[i + 1] = rgbLut[data[i + 1]!]!;
      data[i + 2] = rgbLut[data[i + 2]!]!;
    }

    // Luminance curve: moves luminance only, by the same shift on all three channels, so the
    // difference between the channels (the colour) is kept.
    if (lumaTable) {
      const luma = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
      const shift = lumaTable[luma]!;
      if (shift !== 0) {
        data[i] = data[i]! + shift;
        data[i + 1] = data[i + 1]! + shift;
        data[i + 2] = data[i + 2]! + shift;
      }
    }

    if (bands)
      mixer: {
        // Colour mixer, on the pixel as the steps above left it. Work out the hue first (it only needs
        // the largest and smallest channel) so a pixel whose hue no band touches is skipped before any
        // of the heavier lightness and saturation maths.
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;

        const max = r > g ? (r > b ? r : b) : g > b ? g : b;
        const min = r < g ? (r < b ? r : b) : g < b ? g : b;
        if (max === min) break mixer; // grey: no hue to adjust
        const range = max - min;

        let hue: number;
        if (max === r) hue = ((g - b) / range + (g < b ? 6 : 0)) * 60;
        else if (max === g) hue = ((b - r) / range + 2) * 60;
        else hue = ((r - g) / range + 4) * 60;

        const at = Math.round((hue / 360) * BAND_TABLE_SIZE) % BAND_TABLE_SIZE;
        if (bands.touched[at] === 0) break mixer;

        const sum = (max + min) / 255;
        let l = sum / 2;
        const s = l > 0.5 ? range / 255 / (2 - sum) : range / 255 / sum;
        if (s < 0.02) break mixer;

        const satDelta = bands.sat[at]!;
        const hueDelta = bands.hue[at]!;
        const lumDelta = bands.lum[at]!;

        let newS = s;
        if (satDelta !== 0) {
          const scaled = s * (1 + satDelta / 100);
          newS = scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
        }
        let newHue = hue;
        if (hueDelta !== 0) {
          newHue = (hue + hueDelta) % 360;
          if (newHue < 0) newHue += 360;
        }
        if (lumDelta > 0) l += (1 - l) * lumDelta * LUM_STRENGTH;
        else if (lumDelta < 0) l += l * lumDelta * LUM_STRENGTH;

        const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
        const p = 2 * l - q;
        const hk = newHue / 360;
        data[i] = Math.round(channel(p, q, hk + 1 / 3) * 255);
        data[i + 1] = Math.round(channel(p, q, hk) * 255);
        data[i + 2] = Math.round(channel(p, q, hk - 1 / 3) * 255);
      }

    // Colour grading, last: tints and shifts the pixel by amounts that depend only on its
    // luminance. Greys are tinted too, so this runs for every pixel, including the ones the mixer
    // skipped.
    if (grading) {
      const at = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) * 3;
      data[i] = data[i]! + grading[at]!;
      data[i + 1] = data[i + 1]! + grading[at + 1]!;
      data[i + 2] = data[i + 2]! + grading[at + 2]!;
    }
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
