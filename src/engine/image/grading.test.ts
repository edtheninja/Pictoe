import { describe, expect, it } from "vitest";
import {
  BALANCE_SHIFT,
  GRADE_LUM_SHIFT,
  TINT_STRENGTH,
  buildGradingTable,
  gradeDelta,
  gradeWeights,
  hasActiveGrading,
  hueOffset,
} from "./grading";
import { tonalWeights } from "./tonal";
import { DEFAULT_ADJUSTMENTS, type Adjustments } from "@/types/editor";

const adj = (patch: Partial<Adjustments> = {}): Adjustments => ({
  ...DEFAULT_ADJUSTMENTS,
  ...patch,
});
const luma = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const levels = Array.from({ length: 101 }, (_, i) => i / 100);

describe("hueOffset", () => {
  it("has no net luminance for any hue, so a tint can't brighten or darken", () => {
    for (let h = 0; h < 360; h += 7) expect(Math.abs(luma(hueOffset(h)))).toBeLessThan(1e-9);
  });

  it("pushes red, green and blue hues toward their own channel", () => {
    const [rr, rg, rb] = hueOffset(0);
    expect(rr).toBeGreaterThan(0.5);
    expect(rg).toBeLessThan(0);
    expect(rb).toBeLessThan(0);
    const [gr, gg, gb] = hueOffset(120);
    expect(gg).toBeGreaterThan(0.2);
    expect(gr).toBeLessThan(0);
    expect(gb).toBeLessThan(0);
    const [br, bg, bb] = hueOffset(240);
    expect(bb).toBeGreaterThan(0.5);
    expect(br).toBeLessThan(0);
    expect(bg).toBeLessThan(0);
  });

  it("stays within -1..1, wraps around the colour wheel and has no jumps", () => {
    for (let h = -400; h <= 800; h += 3) {
      for (const v of hueOffset(h)) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(hueOffset(360)).toEqual(hueOffset(0));
    expect(hueOffset(-120)).toEqual(hueOffset(240));
    for (let h = 0; h < 360; h++) {
      const [a, b] = [hueOffset(h), hueOffset(h + 1)];
      for (let k = 0; k < 3; k++) expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(0.03);
    }
  });
});

describe("gradeWeights", () => {
  it("always add up to exactly 1, each between 0 and 1, whatever the balance", () => {
    for (const balance of [-100, -40, 0, 40, 100]) {
      for (const l of levels) {
        const w = gradeWeights(l, balance);
        expect(w.shadows + w.midtones + w.highlights).toBeCloseTo(1, 10);
        for (const v of Object.values(w)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("put the shadows in the darks, the highlights in the brights and the mid-tones between", () => {
    expect(gradeWeights(0, 0).shadows).toBe(1);
    expect(gradeWeights(1, 0).highlights).toBe(1);
    expect(gradeWeights(0.5, 0).midtones).toBeGreaterThan(gradeWeights(0.02, 0).midtones);
    expect(gradeWeights(0.5, 0).midtones).toBeGreaterThan(gradeWeights(0.98, 0).midtones);
    for (let i = 1; i < levels.length; i++) {
      expect(gradeWeights(levels[i]!, 0).shadows).toBeLessThanOrEqual(
        gradeWeights(levels[i - 1]!, 0).shadows + 1e-12,
      );
      expect(gradeWeights(levels[i]!, 0).highlights).toBeGreaterThanOrEqual(
        gradeWeights(levels[i - 1]!, 0).highlights - 1e-12,
      );
    }
  });

  it("use the same weights as the tonal sliders when the balance is zero", () => {
    for (const l of levels) {
      const [grade, tonal] = [gradeWeights(l, 0), tonalWeights(l)];
      expect(grade.shadows).toBeCloseTo(tonal.shadows, 12);
      expect(grade.highlights).toBeCloseTo(tonal.highlights, 12);
    }
  });

  it("balance slides the split: positive favours the highlights, negative the shadows", () => {
    const [neutral, up, down] = [
      gradeWeights(0.5, 0),
      gradeWeights(0.5, 100),
      gradeWeights(0.5, -100),
    ];
    expect(up.highlights).toBeGreaterThan(neutral.highlights);
    expect(up.shadows).toBeLessThan(neutral.shadows);
    expect(down.shadows).toBeGreaterThan(neutral.shadows);
    expect(down.highlights).toBeLessThan(neutral.highlights);
    expect(BALANCE_SHIFT).toBeGreaterThan(0);
  });
});

describe("which settings count as grading", () => {
  it("is nothing at the defaults, and hue or balance alone does nothing", () => {
    expect(hasActiveGrading(adj())).toBe(false);
    expect(
      hasActiveGrading(adj({ gradeShadowsHue: 200, gradeHighlightsHue: 40, gradeBalance: 80 })),
    ).toBe(false);
    expect(buildGradingTable(adj({ gradeShadowsHue: 200, gradeBalance: 80 }))).toBeNull();
  });

  it("starts as soon as a range has some saturation or a luminance shift", () => {
    expect(hasActiveGrading(adj({ gradeShadowsSat: 5 }))).toBe(true);
    expect(hasActiveGrading(adj({ gradeMidtonesLum: -5 }))).toBe(true);
    expect(hasActiveGrading(adj({ gradeHighlightsSat: 0.4 }))).toBe(false);
  });
});

describe("gradeDelta", () => {
  it("a tint alone has no net effect on luminance, at any luminance", () => {
    const a = adj({
      gradeShadowsHue: 20,
      gradeShadowsSat: 100,
      gradeHighlightsHue: 210,
      gradeHighlightsSat: 80,
      gradeMidtonesHue: 300,
      gradeMidtonesSat: 50,
    });
    for (const l of levels) expect(Math.abs(luma(gradeDelta(l, a)))).toBeLessThan(1e-9);
  });

  it("a luminance shift alone moves red, green and blue equally", () => {
    const [r, g, b] = gradeDelta(0, adj({ gradeShadowsLum: 100 }));
    expect(r).toBeCloseTo(GRADE_LUM_SHIFT, 10);
    expect(g).toBeCloseTo(r, 10);
    expect(b).toBeCloseTo(r, 10);
    expect(gradeDelta(0, adj({ gradeShadowsLum: -100 }))[0]).toBeCloseTo(-GRADE_LUM_SHIFT, 10);
  });

  it("a range acts where its weight is, and an inactive range does nothing", () => {
    const shadows = adj({ gradeShadowsHue: 0, gradeShadowsSat: 100 });
    expect(Math.abs(gradeDelta(0, shadows)[0])).toBeGreaterThan(0.1);
    expect(gradeDelta(1, shadows)).toEqual([0, 0, 0]);
    const highlights = adj({ gradeHighlightsHue: 0, gradeHighlightsSat: 100 });
    expect(gradeDelta(0, highlights)).toEqual([0, 0, 0]);
    expect(Math.abs(gradeDelta(1, highlights)[0])).toBeGreaterThan(0.1);
    expect(gradeDelta(0.5, adj({ gradeShadowsHue: 100 }))).toEqual([0, 0, 0]);
  });

  it("a full-saturation tint is the documented size, and saturation scales it", () => {
    const full = gradeDelta(0, adj({ gradeShadowsHue: 0, gradeShadowsSat: 100 }));
    expect(full[0]).toBeCloseTo(TINT_STRENGTH * hueOffset(0)[0], 10);
    const half = gradeDelta(0, adj({ gradeShadowsHue: 0, gradeShadowsSat: 50 }));
    expect(half[0]).toBeCloseTo(full[0] / 2, 10);
  });

  it("adds the ranges together where they overlap", () => {
    const l = 0.4;
    const both = gradeDelta(
      l,
      adj({
        gradeShadowsSat: 60,
        gradeShadowsHue: 10,
        gradeMidtonesSat: 60,
        gradeMidtonesHue: 200,
      }),
    );
    const s = gradeDelta(l, adj({ gradeShadowsSat: 60, gradeShadowsHue: 10 }));
    const m = gradeDelta(l, adj({ gradeMidtonesSat: 60, gradeMidtonesHue: 200 }));
    for (let k = 0; k < 3; k++) expect(both[k]).toBeCloseTo(s[k]! + m[k]!, 10);
  });
});

describe("the grading table", () => {
  it("has three entries per luminance byte, in byte units, matching gradeDelta", () => {
    const a = adj({
      gradeShadowsSat: 70,
      gradeShadowsHue: 220,
      gradeHighlightsLum: 40,
      gradeBalance: -30,
    });
    const table = buildGradingTable(a)!;
    expect(table).toHaveLength(256 * 3);
    for (const i of [0, 17, 90, 128, 200, 255]) {
      const d = gradeDelta(i / 255, a);
      for (let k = 0; k < 3; k++) expect(table[i * 3 + k]).toBeCloseTo(d[k]! * 255, 3);
    }
  });
});
