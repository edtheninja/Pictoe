import { DEFAULT_ADJUSTMENTS, type Adjustments, type LocalAdjustments } from "@/types/editor";
import { NO_FILTER, type FilterParams } from "./canvasFilter";

/**
 * How a local area's sliders turn into render work. Pure maths, no canvas, so it is testable
 * and shared by the main-thread and Worker renderers.
 *
 * A local area is the already-rendered image put through its own chain on a scratch canvas, then
 * cut down to the mask:
 *
 *   1. canvas filter: exposure, contrast (plus clarity), saturation
 *   2. colour casts: temperature, tint
 *   3. colour stage: highlights, shadows (the same luminosity-weighted maths as the global sliders)
 *   4. unsharp mask: sharpness
 *
 * Each step is skipped when its sliders are at zero.
 */

/**
 * The three CSS filters for a local area. The scales match the global sliders of the same name
 * (exposure 0.55, contrast 0.6, and clarity as a 0.25 contrast boost, as in buildFilterParams),
 * so a slider means the same thing locally and globally.
 */
export function buildLocalFilterParams(
  a: Pick<LocalAdjustments, "exposure" | "contrast" | "saturation" | "clarity">,
): FilterParams {
  const brightness = 1 + (a.exposure / 100) * 0.55;
  const contrast = 1 + (a.contrast / 100) * 0.6 + (a.clarity / 100) * 0.25;
  return {
    ...NO_FILTER,
    brightness: clamp(brightness, 0.05, 4),
    contrast: clamp(contrast, 0.05, 4),
    saturate: Math.max(0, 1 + a.saturation / 100),
  };
}

/**
 * The global adjustments the colour stage should run for a local area: everything neutral except
 * highlights and shadows. Pass it to planColorStage, which returns null (skip the pixel pass)
 * when both are at zero.
 */
export function localStageAdjustments(
  a: Pick<LocalAdjustments, "highlights" | "shadows">,
): Adjustments {
  return { ...DEFAULT_ADJUSTMENTS, highlights: a.highlights, shadows: a.shadows };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
