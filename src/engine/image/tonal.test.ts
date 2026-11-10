import { describe, expect, it } from "vitest";
import { TONAL_STRENGTH, buildTonalTable, hasActiveTonal, tonalDelta, tonalWeights } from "./tonal";
import { applyColorStage, planColorStage } from "./colorStage";
import { DEFAULT_ADJUSTMENTS, type Adjustments } from "@/types/editor";

const adj = (patch: Partial<Adjustments>): Adjustments => ({ ...DEFAULT_ADJUSTMENTS, ...patch });

/** Runs the colour stage on a list of [r, g, b] pixels and returns the resulting [r, g, b] list. */
function run(pixels: [number, number, number][], patch: Partial<Adjustments>) {
  const data = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  const plan = planColorStage(adj(patch));
  if (plan) applyColorStage(data, plan);
  return pixels.map((_, i) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!]);
}
const grey = (v: number): [number, number, number] => [v, v, v];
/** How much a grey of level `v` changed under the given adjustments. */
const change = (v: number, patch: Partial<Adjustments>) => run([grey(v)], patch)[0]![0]! - v;

describe("tonal weights", () => {
  const steps = Array.from({ length: 101 }, (_, i) => i / 100);

  it("stay between 0 and 1", () => {
    for (const l of steps) {
      for (const w of Object.values(tonalWeights(l))) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it("shadows and blacks fall with luminance; highlights and whites rise", () => {
    for (let i = 1; i < steps.length; i++) {
      const [a, b] = [tonalWeights(steps[i - 1]!), tonalWeights(steps[i]!)];
      expect(b.shadows).toBeLessThanOrEqual(a.shadows + 1e-12);
      expect(b.blacks).toBeLessThanOrEqual(a.blacks + 1e-12);
      expect(b.highlights).toBeGreaterThanOrEqual(a.highlights - 1e-12);
      expect(b.whites).toBeGreaterThanOrEqual(a.whites - 1e-12);
    }
  });

  it("each slider is full strength at its own end of the range", () => {
    expect(tonalWeights(0).shadows).toBe(1);
    expect(tonalWeights(0).blacks).toBe(1);
    expect(tonalWeights(1).highlights).toBe(1);
    expect(tonalWeights(1).whites).toBe(1);
  });

  it("leaves the mid-tones almost alone: whites and blacks not at all, shadows and highlights little", () => {
    const mid = tonalWeights(0.5);
    expect(mid.blacks).toBe(0);
    expect(mid.whites).toBe(0);
    expect(mid.shadows).toBeLessThan(0.25);
    expect(mid.highlights).toBeLessThan(0.25);
  });

  it("is mirror-symmetric: shadows mirror highlights and blacks mirror whites", () => {
    for (const l of steps) {
      expect(tonalWeights(l).shadows).toBeCloseTo(tonalWeights(1 - l).highlights, 10);
      expect(tonalWeights(l).blacks).toBeCloseTo(tonalWeights(1 - l).whites, 10);
    }
  });
});

describe("tonal table", () => {
  it("is null when no tonal slider is active", () => {
    expect(buildTonalTable(adj({}))).toBeNull();
    expect(buildTonalTable(adj({ highlights: 0.01 }))).toBeNull();
    expect(hasActiveTonal(adj({ blacks: -1 }))).toBe(true);
  });

  it("has one finite entry per luminance byte, in byte units", () => {
    const table = buildTonalTable(adj({ shadows: 100 }))!;
    expect(table).toHaveLength(256);
    for (const v of table) expect(Number.isFinite(v)).toBe(true);
    expect(table[0]).toBeCloseTo(TONAL_STRENGTH.shadows * 255, 3);
  });

  it("matches tonalDelta", () => {
    const a = adj({ highlights: -40, shadows: 60, whites: 20, blacks: -30 });
    const table = buildTonalTable(a)!;
    for (const i of [0, 30, 90, 128, 200, 255]) {
      expect(table[i]).toBeCloseTo(tonalDelta(i / 255, a) * 255, 3);
    }
  });
});

describe("each slider acts on its own part of the range", () => {
  it("highlights: brightens the brights, leaves the darks alone, barely moves the mid-tones", () => {
    const bright = change(200, { highlights: 100 });
    expect(bright).toBeGreaterThan(30);
    expect(change(20, { highlights: 100 })).toBe(0);
    expect(Math.abs(change(128, { highlights: 100 }))).toBeLessThan(bright * 0.35);
  });

  it("shadows: brightens the darks, leaves the brights alone, barely moves the mid-tones", () => {
    const dark = change(40, { shadows: 100 });
    expect(dark).toBeGreaterThan(30);
    expect(change(235, { shadows: 100 })).toBe(0);
    expect(Math.abs(change(128, { shadows: 100 }))).toBeLessThan(dark * 0.35);
  });

  it("blacks: acts on the deepest darks only", () => {
    expect(change(5, { blacks: 100 })).toBeGreaterThan(15);
    expect(change(60, { blacks: 100 })).toBeLessThan(5);
    expect(change(90, { blacks: 100 })).toBe(0);
    expect(change(128, { blacks: 100 })).toBe(0);
    expect(change(200, { blacks: 100 })).toBe(0);
  });

  it("whites: acts on the brightest brights only", () => {
    expect(change(215, { whites: 100 })).toBeGreaterThan(8);
    expect(change(100, { whites: 100 })).toBe(0);
    expect(change(30, { whites: 100 })).toBe(0);
    expect(change(150, { whites: 100 })).toBe(0);
  });

  it("a positive value brightens and a negative value darkens, for all four", () => {
    const region: Record<string, number> = {
      highlights: 200,
      shadows: 40,
      whites: 215,
      blacks: 20,
    };
    for (const [key, level] of Object.entries(region)) {
      expect(change(level, { [key]: 60 })).toBeGreaterThan(0);
      expect(change(level, { [key]: -60 })).toBeLessThan(0);
    }
  });

  it("the effect grows with the slider", () => {
    const region: Record<string, number> = {
      highlights: 190,
      shadows: 50,
      whites: 220,
      blacks: 15,
    };
    for (const [key, level] of Object.entries(region)) {
      const effects = [20, 40, 60, 80, 100].map((v) => change(level, { [key]: v }));
      for (let i = 1; i < effects.length; i++)
        expect(effects[i]!).toBeGreaterThanOrEqual(effects[i - 1]!);
      expect(effects[4]!).toBeGreaterThan(effects[0]!);
    }
  });
});

describe("what a tonal change does to a pixel", () => {
  it("keeps greys grey at every level", () => {
    for (let v = 0; v <= 255; v++) {
      const [r, g, b] = run([grey(v)], {
        highlights: -50,
        shadows: 70,
        whites: 30,
        blacks: -40,
      })[0]!;
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });

  it("moves a coloured pixel's luminance by the intended amount", () => {
    const [r, g, b] = [30, 60, 90]; // a dark pixel, where the shadows slider acts
    const a = adj({ shadows: 60 });
    const lumaIn = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const expected = buildTonalTable(a)![Math.round(lumaIn)]!;
    const [r2, g2, b2] = run([[r, g, b]], a)[0]!;
    const lumaOut = 0.2126 * r2! + 0.7152 * g2! + 0.0722 * b2!;
    expect(expected).toBeGreaterThan(5);
    expect(Math.abs(lumaOut - lumaIn - expected)).toBeLessThanOrEqual(1);
  });

  it("keeps the same difference between the channels (no hue change) while nothing clips", () => {
    const [r, g, b] = run([[30, 60, 90]], { shadows: 60 })[0]!;
    expect(r!).toBeGreaterThan(50); // it really was lifted
    expect(Math.abs(g! - r! - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(b! - g! - 30)).toBeLessThanOrEqual(1);
  });

  it("clamps at the ends instead of wrapping around", () => {
    expect(run([grey(250)], { highlights: 100, whites: 100 })[0]!.slice(0, 3)).toEqual([
      255, 255, 255,
    ]);
    expect(run([grey(3)], { shadows: -100, blacks: -100 })[0]!.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("never touches alpha", () => {
    const data = new Uint8ClampedArray([200, 100, 50, 77, 10, 10, 10, 0]);
    applyColorStage(data, planColorStage(adj({ highlights: 80, shadows: 80, satRed: 40 }))!);
    expect(data[3]).toBe(77);
    expect(data[7]).toBe(0);
  });
});

describe("tonal and colour bands in one pass", () => {
  function photo(w: number, h: number) {
    const d = new Uint8ClampedArray(w * h * 4);
    let seed = 4242;
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
    // Some exact greys and near-greys, which the band section skips.
    for (let k = 0; k < 60; k++) d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = k * 4;
    return d;
  }

  it("gives the same bytes as applying the two operations one after the other", () => {
    const tonal = { highlights: -40, shadows: 50, whites: 20, blacks: -25 };
    const bands = { satGreen: 40, satRed: -30, satBlue: 60 };
    const base = photo(120, 90);

    const together = new Uint8ClampedArray(base);
    applyColorStage(together, planColorStage(adj({ ...tonal, ...bands }))!);

    const sequential = new Uint8ClampedArray(base);
    applyColorStage(sequential, planColorStage(adj(tonal))!);
    applyColorStage(sequential, planColorStage(adj(bands))!);

    expect(together).toEqual(sequential);
  });

  it("still applies the tonal change to greys when colour bands are on", () => {
    const [r] = run([grey(40)], { shadows: 100, satGreen: 50 })[0]!;
    expect(r!).toBeGreaterThan(70);
  });

  it("plans only the sections that are active", () => {
    expect(planColorStage(adj({}))).toBeNull();
    const tonalOnly = planColorStage(adj({ shadows: 10 }))!;
    expect(tonalOnly.tonalTable).not.toBeNull();
    expect(tonalOnly.bands).toBeNull();
    const bandsOnly = planColorStage(adj({ satRed: 10 }))!;
    expect(bandsOnly.tonalTable).toBeNull();
    expect(bandsOnly.bands).not.toBeNull();
    const both = planColorStage(adj({ shadows: 10, satRed: 10 }))!;
    expect(both.tonalTable).not.toBeNull();
    expect(both.bands).not.toBeNull();
  });
});
