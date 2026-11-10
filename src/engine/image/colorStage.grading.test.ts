import { describe, expect, it } from "vitest";
import { applyColorStage, planColorStage } from "./colorStage";
import { DEFAULT_ADJUSTMENTS, identityCurves, type Adjustments } from "@/types/editor";

const adj = (patch: Partial<Adjustments> = {}): Adjustments => ({
  ...DEFAULT_ADJUSTMENTS,
  ...patch,
});
const grey = (v: number): [number, number, number] => [v, v, v];
const luma = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

function run(pixels: [number, number, number][], a: Adjustments) {
  const data = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  const plan = planColorStage(a);
  if (plan) applyColorStage(data, plan);
  return pixels.map((_, i) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!]);
}
const diff = (before: number[], after: number[]) => [0, 1, 2].map((k) => after[k]! - before[k]!);

describe("colour grading in the stage", () => {
  const redShadows = { gradeShadowsHue: 0, gradeShadowsSat: 100 };
  const blueHighlights = { gradeHighlightsHue: 240, gradeHighlightsSat: 100 };

  it("tints the darks with the shadows colour and leaves the brights alone", () => {
    const [dark, bright] = run([grey(20), grey(240)], adj(redShadows));
    const [dr, dg, db] = diff(grey(20), dark!);
    expect(Math.abs(dr! - 40)).toBeLessThan(3); // a full tint at full weight: about 40 levels of red
    expect(dg!).toBeLessThan(-3);
    expect(db!).toBeLessThan(-3);
    expect(bright!.slice(0, 3)).toEqual([240, 240, 240]);
  });

  it("tints the brights with the highlights colour and leaves the darks alone", () => {
    const [dark, bright] = run([grey(20), grey(235)], adj(blueHighlights));
    expect(dark!.slice(0, 3)).toEqual([20, 20, 20]);
    expect(bright![2]! - 235).toBeGreaterThan(5);
    expect(bright![0]).toBeLessThan(235);
  });

  it("the mid-tone tint acts most in the middle", () => {
    const a = adj({ gradeMidtonesHue: 120, gradeMidtonesSat: 100 });
    const [dark, mid, bright] = run([grey(5), grey(128), grey(250)], a);
    const move = (px: number[], v: number) => Math.abs(px[1]! - v);
    expect(move(mid!, 128)).toBeGreaterThan(move(dark!, 5));
    expect(move(mid!, 128)).toBeGreaterThan(move(bright!, 250));
  });

  it("tints greys, which the colour mixer never touches", () => {
    const [out] = run([grey(100)], adj({ gradeMidtonesHue: 30, gradeMidtonesSat: 100 }));
    expect(out![0]).not.toBe(out![2]);
  });

  it("does not change a pixel's luminance when only the tint is used", () => {
    for (const px of [grey(120), [100, 130, 90], [60, 70, 80]] as [number, number, number][]) {
      const [out] = run(
        [px],
        adj({
          gradeShadowsHue: 30,
          gradeShadowsSat: 100,
          gradeMidtonesHue: 200,
          gradeMidtonesSat: 100,
        }),
      );
      expect(Math.abs(luma(out!) - luma(px))).toBeLessThanOrEqual(1.5);
    }
  });

  it("the luminance slider lifts or lowers a range without colouring it", () => {
    const [lifted] = run([grey(30)], adj({ gradeShadowsLum: 100 }));
    expect(lifted![0]! - 30).toBeGreaterThan(15);
    expect(lifted![1]).toBe(lifted![0]);
    expect(lifted![2]).toBe(lifted![0]);
    const [lowered] = run([grey(30)], adj({ gradeShadowsLum: -100 }));
    expect(lowered![0]).toBeLessThan(30);
  });

  it("balance slides which pixels count as highlights", () => {
    const tint = { gradeHighlightsHue: 240, gradeHighlightsSat: 100 };
    const blueGain = (balance: number) =>
      run([grey(128)], adj({ ...tint, gradeBalance: balance }))[0]![2]! - 128;
    expect(blueGain(100)).toBeGreaterThan(blueGain(0));
    expect(blueGain(0)).toBeGreaterThan(blueGain(-100));
  });

  it("clamps at the ends instead of wrapping, and never touches alpha", () => {
    const [white] = run(
      [grey(255)],
      adj({ gradeHighlightsHue: 0, gradeHighlightsSat: 100, gradeHighlightsLum: 100 }),
    );
    expect(white!.slice(0, 3).every((v) => v <= 255 && v >= 0)).toBe(true);
    expect(white![0]).toBe(255);
    const data = new Uint8ClampedArray([200, 100, 50, 77]);
    applyColorStage(data, planColorStage(adj(redShadows))!);
    expect(data[3]).toBe(77);
  });
});

describe("planning with grading", () => {
  it("needs no pixel work at the defaults, and plans only the grading when only grading is used", () => {
    expect(planColorStage(adj())).toBeNull();
    const plan = planColorStage(adj({ gradeShadowsSat: 30 }))!;
    expect(plan.grading).not.toBeNull();
    expect(plan.bands).toBeNull();
    expect(plan.tonalTable).toBeNull();
    expect(plan.curves).toBeNull();
  });
});

describe("order of operations", () => {
  function photo() {
    const d = new Uint8ClampedArray(160 * 100 * 4);
    let seed = 2718;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < d.length; i += 4) {
      d[i] = rnd() * 255;
      d[i + 1] = rnd() * 255;
      d[i + 2] = rnd() * 255;
      d[i + 3] = 255;
    }
    for (let k = 0; k < 60; k++) d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = k * 4;
    return d;
  }

  it("runs last: the same bytes as tonal, curves, mixer, then grading applied one after another", () => {
    const tonal = { shadows: 30, highlights: -20 };
    const mixer = { hueRed: 40, satGreen: 40, lumBlue: -40 };
    const grading = {
      gradeShadowsHue: 220,
      gradeShadowsSat: 60,
      gradeMidtonesHue: 40,
      gradeMidtonesSat: 30,
      gradeMidtonesLum: 10,
      gradeHighlightsHue: 50,
      gradeHighlightsSat: 70,
      gradeBalance: 20,
    };
    const curves = {
      rgb: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ],
      luma: identityCurves().luma,
    };
    const base = photo();

    const together = new Uint8ClampedArray(base);
    applyColorStage(together, planColorStage(adj({ ...tonal, ...mixer, ...grading }), curves)!);

    const step = new Uint8ClampedArray(base);
    applyColorStage(step, planColorStage(adj(tonal))!);
    applyColorStage(step, planColorStage(adj(), curves)!);
    applyColorStage(step, planColorStage(adj(mixer))!);
    applyColorStage(step, planColorStage(adj(grading))!);

    expect(together).toEqual(step);
  });

  it("still grades the greys the mixer skips", () => {
    const [out] = run(
      [grey(100)],
      adj({ satRed: 50, gradeMidtonesHue: 30, gradeMidtonesSat: 100 }),
    );
    expect(out![0]).not.toBe(out![2]);
  });

  it("the mixer's skipped pixels are otherwise untouched", () => {
    const [out] = run([grey(100)], adj({ satRed: 50 }));
    expect(out!.slice(0, 3)).toEqual([100, 100, 100]);
  });
});
