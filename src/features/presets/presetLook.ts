/**
 * What applying a preset does to an edit, and how a preset is made from one.
 *
 * A preset is a look: adjustments, and optionally tone curves (the same two things Copy edits
 * carries). Applying replaces the adjustments, so every value the preset doesn't mention goes back
 * to untouched. Curves are replaced only when the preset defines them; one that doesn't (the
 * built-in presets, and any saved before curves were part of a preset) leaves them as they are,
 * which is how presets always behaved.
 *
 * Pure: no React and no DOM.
 */
import {
  DEFAULT_ADJUSTMENTS,
  type CurvesState,
  type EditState,
  type PresetAdjustments,
} from "@/types/editor";
import { normalizeCurves } from "@/engine/image/curves";

type PresetLike = { adjustments: PresetAdjustments; curves?: CurvesState };

/** The part of an edit that applying the preset replaces. Pass it to applyEdit. */
export function presetEdit(preset: PresetLike): Partial<Pick<EditState, "adjustments" | "curves">> {
  const edit: Partial<Pick<EditState, "adjustments" | "curves">> = {
    adjustments: { ...DEFAULT_ADJUSTMENTS, ...preset.adjustments },
  };
  // normalizeCurves also copies, so the edit shares nothing with the saved preset.
  if (preset.curves !== undefined) edit.curves = normalizeCurves(preset.curves);
  return edit;
}

/** A preset holding this edit's look. Always records the curves, even straight ones, so applying
 *  it later puts the curves back the way they were when it was saved. */
export function presetFromEdit(
  id: string,
  name: string,
  edit: Pick<EditState, "adjustments" | "curves">,
): { id: string; name: string; adjustments: PresetAdjustments; curves: CurvesState } {
  return {
    id,
    name,
    adjustments: { ...edit.adjustments },
    curves: normalizeCurves(edit.curves),
  };
}
