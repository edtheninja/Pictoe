import { describe, expect, it } from "vitest";
import { applyColorStage, planColorStage } from "./colorStage";
import {
  DEFAULT_ADJUSTMENTS,
  identityCurve,
  identityCurves,
  type Adjustments,
  type CurvePoint,
  type CurvesState,
} from "@/types/editor";

const adj = (patch: Partial<Adjustments> = {}): Adjustments => ({
  ...DEFAULT_ADJUSTMENTS,
  ...patch,
});
const pts = (...xy: [number, number][]): CurvePoint[] => xy.map(([x, y]) => ({ x, y }));
const S = pts([0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]);
const curves = (patch: Partial<CurvesState>): CurvesState => ({ ...identityCurves(), ...patch });

function run(pixels: [number, number, number][], a: Adjustments, c?: CurvesState) {
  const data = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  const plan = planColorStage(a, c);
  if (plan) applyColorStage(data, plan);
  return pixels.map((_, i) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!]);
}
const grey = (v: number): [number, number, number] => [v, v, v];
const spread = ([r, g, b]: number[]) => Math.max(r!, g!, b!) - Math.min(r!, g!, b!);

describe("planning with curves", () => {
  it("does no pixel work for straight curves", () => {
    expect(planColorStage(adj(), identityCurves())).toBeNull();
    expect(planColorStage(adj(), undefined)).toBeNull();
  });

  it("plans only the curve that is bent", () => {
    const rgbOnly = planColorStage(adj(), curves({ rgb: S }))!;
    expect(rgbOnly.curves!.rgbLut).not.toBeNull();
    expect(rgbOnly.curves!.lumaTable).toBeNull();
    const lumaOnly = planColorStage(adj(), curves({ luma: S }))!;
    expect(lumaOnly.curves!.rgbLut).toBeNull();
    expect(lumaOnly.curves!.lumaTable).not.toBeNull();
  });
});

describe("RGB curve", () => {
  it("sends every channel through the curve on its own", () => {
    const lift = pts([0, 0], [0.5, 0.7], [1, 1]);
    const [out] = run([[60, 120, 200]], adj(), curves({ rgb: lift }));
    const plan = planColorStage(adj(), curves({ rgb: lift }))!;
    expect(out!.slice(0, 3)).toEqual([
      plan.curves!.rgbLut![60],
      plan.curves!.rgbLut![120],
      plan.curves!.rgbLut![200],
    ]);
    expect(out![0]).toBeGreaterThan(60);
    expect(out![3]).toBe(255);
  });

  it("an S-curve adds contrast: darks darker, brights brighter, mid unchanged", () => {
    const [dark, mid, bright] = run([grey(64), grey(128), grey(192)], adj(), curves({ rgb: S }));
    expect(dark![0]).toBeLessThan(64);
    expect(Math.abs(mid![0]! - 128)).toBeLessThanOrEqual(1);
    expect(bright![0]).toBeGreaterThan(192);
  });

  it("an S-curve also raises saturation (it changes the colour, unlike the luminance curve)", () => {
    const px: [number, number, number] = [100, 150, 200];
    expect(spread(run([px], adj(), curves({ rgb: S }))[0]!)).toBeGreaterThan(spread(px));
  });

  it("lifts the black point when the first point is raised", () => {
    const [black] = run([grey(0)], adj(), curves({ rgb: pts([0, 0.1], [1, 1]) }));
    expect(black![0]).toBeCloseTo(26, 0);
  });

  it("keeps greys grey", () => {
    for (let v = 0; v <= 255; v += 5) {
      const [r, g, b] = run([grey(v)], adj(), curves({ rgb: S }))[0]!;
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });
});

describe("luminance curve", () => {
  it("moves luminance by the curve's amount and keeps the difference between the channels", () => {
    const lift = pts([0, 0], [0.25, 0.4], [1, 1]);
    const [r, g, b] = run([[30, 60, 90]], adj(), curves({ luma: lift }))[0]!;
    expect(r!).toBeGreaterThan(30 + 10); // it really lifted
    expect(Math.abs(g! - r! - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(b! - g! - 30)).toBeLessThanOrEqual(1);
  });

  it("a lifted black point raises the darks far more than the brights", () => {
    const lifted = curves({ luma: pts([0, 0.2], [1, 1]) });
    const [dark, bright] = run([grey(10), grey(250)], adj(), lifted);
    expect(dark![0]! - 10).toBeGreaterThan(35);
    expect(bright![0]! - 250).toBeLessThan(12);
  });

  it("an S-curve on luminance adds contrast to greys", () => {
    const [dark, bright] = run([grey(64), grey(192)], adj(), curves({ luma: S }));
    expect(dark![0]).toBeLessThan(64);
    expect(bright![0]).toBeGreaterThan(192);
  });

  it("keeps greys grey", () => {
    for (let v = 0; v <= 255; v += 5) {
      const [r, g, b] = run([grey(v)], adj(), curves({ luma: S }))[0]!;
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });

  it("clamps instead of wrapping, at the top and at the bottom", () => {
    // Pushes luminance up around 0.9: this near-white pixel's red channel would pass 255.
    const [bright] = run([[250, 230, 210]], adj(), curves({ luma: pts([0, 0], [0.9, 1], [1, 1]) }));
    expect(bright![0]).toBe(255);
    expect(bright![1]).toBeGreaterThan(230);
    // Pushes the darks down hard: red and blue of this dark pixel would go below 0.
    const [dark] = run([[5, 30, 3]], adj(), curves({ luma: pts([0, 0], [0.5, 0], [1, 1]) }));
    expect(dark![0]).toBe(0);
    expect(dark![2]).toBe(0);
    expect(dark![1]).toBeLessThan(30);
  });
});

describe("order of operations", () => {
  function photo() {
    const d = new Uint8ClampedArray(150 * 100 * 4);
    let seed = 99;
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
    for (let k = 0; k < 50; k++) d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = k * 5;
    return d;
  }

  it("applies tonal, then the RGB curve, then the luminance curve, then colour bands", () => {
    const tonal = { shadows: 40, highlights: -30 };
    const bands = { satGreen: 40, satBlue: -50 };
    const c = curves({ rgb: S, luma: pts([0, 0.05], [0.6, 0.7], [1, 1]) });
    const base = photo();

    const together = new Uint8ClampedArray(base);
    applyColorStage(together, planColorStage(adj({ ...tonal, ...bands }), c)!);

    const step = new Uint8ClampedArray(base);
    applyColorStage(step, planColorStage(adj(tonal))!);
    applyColorStage(step, planColorStage(adj(), curves({ rgb: c.rgb }))!);
    applyColorStage(step, planColorStage(adj(), curves({ luma: c.luma }))!);
    applyColorStage(step, planColorStage(adj(bands))!);

    expect(together).toEqual(step);
  });

  it("still applies the curves to greys when colour bands are on", () => {
    const [out] = run([grey(64)], adj({ satRed: 50 }), curves({ rgb: S }));
    expect(out![0]).toBeLessThan(64);
  });

  it("never touches alpha", () => {
    const data = new Uint8ClampedArray([200, 100, 50, 77]);
    applyColorStage(data, planColorStage(adj(), curves({ rgb: S, luma: S }))!);
    expect(data[3]).toBe(77);
  });
});

describe("the straight line is a no-op even when listed explicitly", () => {
  it("returns identical bytes", () => {
    const explicit = curves({ rgb: pts([0, 0], [0.5, 0.5], [1, 1]), luma: identityCurve() });
    expect(planColorStage(adj(), explicit)).toBeNull();
  });
});
