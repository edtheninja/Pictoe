import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_LOCAL_ADJUSTMENTS,
  LOCAL_ADJUSTMENT_DEFS,
} from "@/types/editor";
import { buildLocalFilterParams, localStageAdjustments } from "./localAdjustments";
import { applyColorStage, planColorStage } from "./colorStage";

const neutral = DEFAULT_LOCAL_ADJUSTMENTS;

/** Runs the local colour stage over one grey pixel and returns its new grey level. */
function stageGrey(level: number, a: { highlights?: number; shadows?: number }): number {
  const plan = planColorStage(localStageAdjustments({ highlights: 0, shadows: 0, ...a }));
  const data = new Uint8ClampedArray([level, level, level, 255]);
  if (plan) applyColorStage(data, plan);
  return data[0]!;
}

describe("local slider definitions", () => {
  it("define every local slider exactly once, and nothing else", () => {
    const keys = LOCAL_ADJUSTMENT_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(DEFAULT_LOCAL_ADJUSTMENTS).sort());
  });

  it("keep every default inside its slider's range, and the original four on top", () => {
    for (const d of LOCAL_ADJUSTMENT_DEFS) {
      expect(DEFAULT_LOCAL_ADJUSTMENTS[d.key]).toBeGreaterThanOrEqual(d.min);
      expect(DEFAULT_LOCAL_ADJUSTMENTS[d.key]).toBeLessThanOrEqual(d.max);
    }
    expect(LOCAL_ADJUSTMENT_DEFS.filter((d) => d.level === "basic").map((d) => d.key)).toEqual([
      "exposure",
      "contrast",
      "saturation",
      "temperature",
    ]);
  });

  it("use the same ranges as the global slider of the same name", async () => {
    const { ADJUSTMENT_DEFS } = await import("@/types/editor");
    for (const d of LOCAL_ADJUSTMENT_DEFS) {
      const global = ADJUSTMENT_DEFS.find((g) => g.key === d.key)!;
      expect([d.min, d.max]).toEqual([global.min, global.max]);
    }
  });
});

describe("buildLocalFilterParams", () => {
  it("is neutral with every slider at zero", () => {
    expect(buildLocalFilterParams(neutral)).toEqual({
      brightness: 1,
      contrast: 1,
      saturate: 1,
      blurPx: 0,
    });
  });

  it("adds clarity as a contrast boost of 0.25 at the full slider, like the global slider", () => {
    expect(buildLocalFilterParams({ ...neutral, clarity: 100 }).contrast).toBeCloseTo(1.25, 9);
    expect(buildLocalFilterParams({ ...neutral, clarity: -100 }).contrast).toBeCloseTo(0.75, 9);
  });

  it("adds contrast and clarity together, and keeps the original scales", () => {
    const p = buildLocalFilterParams({ ...neutral, contrast: 50, clarity: 40, exposure: 100 });
    expect(p.contrast).toBeCloseTo(1 + 0.3 + 0.1, 9);
    expect(p.brightness).toBeCloseTo(1.55, 9);
  });

  it("does not let clarity touch exposure or saturation", () => {
    const p = buildLocalFilterParams({ ...neutral, clarity: 80 });
    expect(p.brightness).toBe(1);
    expect(p.saturate).toBe(1);
  });
});

describe("localStageAdjustments", () => {
  it("is every global adjustment at its default except highlights and shadows", () => {
    expect(localStageAdjustments({ highlights: 30, shadows: -20 })).toEqual({
      ...DEFAULT_ADJUSTMENTS,
      highlights: 30,
      shadows: -20,
    });
  });

  it("gives the colour stage nothing to do when both are zero", () => {
    expect(planColorStage(localStageAdjustments({ highlights: 0, shadows: 0 }))).toBeNull();
  });
});

describe("local highlights and shadows (the colour stage on the area)", () => {
  it("negative highlights darken bright pixels a lot and mid-grey hardly at all", () => {
    expect(stageGrey(230, { highlights: -100 })).toBeLessThan(200);
    expect(Math.abs(stageGrey(128, { highlights: -100 }) - 128)).toBeLessThan(
      Math.abs(stageGrey(230, { highlights: -100 }) - 230) / 2,
    );
  });

  it("positive shadows lift dark pixels and leave bright ones alone", () => {
    expect(stageGrey(30, { shadows: 100 })).toBeGreaterThan(60);
    expect(stageGrey(240, { shadows: 100 })).toBe(240);
  });

  it("positive highlights brighten the brights and leave the darks alone", () => {
    expect(stageGrey(190, { highlights: 100 })).toBeGreaterThan(215);
    expect(stageGrey(20, { highlights: 100 })).toBe(20);
  });

  it("act on a pixel exactly as the global sliders do", () => {
    const global = planColorStage({ ...DEFAULT_ADJUSTMENTS, highlights: -60, shadows: 40 })!;
    const local = planColorStage(localStageAdjustments({ highlights: -60, shadows: 40 }))!;
    const a = new Uint8ClampedArray([200, 120, 40, 255, 20, 30, 90, 255]);
    const b = new Uint8ClampedArray(a);
    applyColorStage(a, global);
    applyColorStage(b, local);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
