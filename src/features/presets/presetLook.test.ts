import { describe, expect, it } from "vitest";
import { presetEdit, presetFromEdit } from "./presetLook";
import { BUILTIN_PRESETS } from "./builtinPresets";
import { DEFAULT_ADJUSTMENTS, identityCurves, type CurvesState } from "@/types/editor";

const bent = (): CurvesState => ({
  rgb: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.7 },
    { x: 1, y: 1 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
});

describe("presetEdit", () => {
  it("replaces the adjustments: what the preset leaves out goes back to untouched", () => {
    const edit = presetEdit({ adjustments: { temperature: 20 } });
    expect(edit.adjustments).toEqual({ ...DEFAULT_ADJUSTMENTS, temperature: 20 });
  });

  it("leaves the curves alone when the preset has none (every built-in does this)", () => {
    expect(presetEdit({ adjustments: { exposure: 5 } })).not.toHaveProperty("curves");
    for (const p of BUILTIN_PRESETS) expect(presetEdit(p)).not.toHaveProperty("curves");
  });

  it("replaces the curves when the preset has them", () => {
    expect(presetEdit({ adjustments: {}, curves: bent() }).curves).toEqual(bent());
  });

  it("replaces the curves with straight ones when the preset says they are straight", () => {
    const edit = presetEdit({ adjustments: {}, curves: identityCurves() });
    expect(edit.curves).toEqual(identityCurves());
  });

  it("shares nothing with the saved preset", () => {
    const preset = { adjustments: { exposure: 5 }, curves: bent() };
    const edit = presetEdit(preset);
    edit.curves!.rgb[1]!.y = 0.1;
    edit.adjustments!.exposure = 99;
    expect(preset.curves.rgb[1]!.y).toBe(0.7);
    expect(preset.adjustments.exposure).toBe(5);
  });

  it("repairs curves that were stored damaged instead of passing them on", () => {
    const damaged = { rgb: [{ x: 0, y: 9 }, "x", { x: 1, y: -4 }], luma: 5 } as never;
    const edit = presetEdit({ adjustments: {}, curves: damaged });
    for (const point of [...edit.curves!.rgb, ...edit.curves!.luma]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("presetFromEdit", () => {
  it("records adjustments and curves, straight curves included", () => {
    const made = presetFromEdit("id1", "Mine", {
      adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 7 },
      curves: identityCurves(),
    });
    expect(made.id).toBe("id1");
    expect(made.name).toBe("Mine");
    expect(made.adjustments.exposure).toBe(7);
    expect(made.curves).toEqual(identityCurves());
  });

  it("shares nothing with the edit it was made from", () => {
    const edit = { adjustments: { ...DEFAULT_ADJUSTMENTS }, curves: bent() };
    const made = presetFromEdit("i", "n", edit);
    edit.curves.rgb[1]!.y = 0.2;
    edit.adjustments.exposure = 50;
    expect(made.curves.rgb[1]!.y).toBe(0.7);
    expect(made.adjustments.exposure).toBe(0);
  });

  it("a preset made from an edit puts that edit's look back", () => {
    const edit = { adjustments: { ...DEFAULT_ADJUSTMENTS, contrast: 12 }, curves: bent() };
    const back = presetEdit(presetFromEdit("i", "n", edit));
    expect(back).toEqual(edit);
  });
});
