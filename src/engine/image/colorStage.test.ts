import { describe, expect, it } from "vitest";
import {
  BAND_TABLE_SIZE,
  HUE_BAND_CENTERS,
  HUE_BAND_HALF_WIDTH,
  activeBands,
  buildBandTable,
  hasActiveBands,
} from "./colorBands";
import { applyColorStage, planColorStage } from "./colorStage";
import { DEFAULT_ADJUSTMENTS, type Adjustments } from "@/types/editor";

/** Runs the colour stage the way render.ts does: plan, then one pass if anything is active. */
function applyColorBands(data: Uint8ClampedArray, a: Adjustments) {
  const plan = planColorStage(a);
  if (plan) applyColorStage(data, plan);
}

/**
 * The reference below is the implementation Pictoe shipped before the optimisation, copied
 * unchanged from render.ts (per-pixel objects, `cos` for every band). The optimised version must
 * match it to within one level on any channel.
 */
const CENTERS: Record<string, number> = {
  satRed: 0,
  satOrange: 30,
  satYellow: 60,
  satGreen: 120,
  satBlue: 210,
  satPurple: 280,
};
const HALF = 45;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}
function hslToRgb(h: number, s: number, l: number) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hk + 1 / 3) * 255),
    g: Math.round(hue2rgb(hk) * 255),
    b: Math.round(hue2rgb(hk - 1 / 3) * 255),
  };
}
function referenceColorBands(d: Uint8ClampedArray, a: Adjustments) {
  const active = Object.entries(CENTERS).filter(
    ([key]) => Math.abs(a[key as keyof Adjustments] as number) > 0.5,
  );
  if (active.length === 0) return;
  for (let i = 0; i < d.length; i += 4) {
    const { h: hue, s, l } = rgbToHsl(d[i]!, d[i + 1]!, d[i + 2]!);
    if (s < 0.02) continue;
    let delta = 0;
    for (const [key, center] of active) {
      const dist = hueDistance(hue, center);
      if (dist >= HALF) continue;
      delta += Math.cos((dist / HALF) * (Math.PI / 2)) * (a[key as keyof Adjustments] as number);
    }
    if (delta === 0) continue;
    const newS = clamp(s * (1 + delta / 100), 0, 1);
    const { r, g, b } = hslToRgb(hue, newS, l);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

/** Deterministic photo-like pixels: smooth colour fields plus noise, a few greys and dark/light edges. */
function syntheticPhoto(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 987654321;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = 128 + 110 * Math.sin(x / 37) + (rnd() - 0.5) * 40;
      d[i + 1] = 128 + 110 * Math.sin(y / 29 + 1) + (rnd() - 0.5) * 40;
      d[i + 2] = 128 + 110 * Math.sin((x + y) / 53 + 2) + (rnd() - 0.5) * 40;
      d[i + 3] = 200 + (rnd() > 0.5 ? 55 : 0); // alpha must survive untouched
    }
  }
  // Exact greys and extremes.
  for (let k = 0; k < 40; k++) {
    const v = Math.round((k / 39) * 255);
    d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v;
  }
  return d;
}

const adj = (patch: Partial<Adjustments>): Adjustments => ({ ...DEFAULT_ADJUSTMENTS, ...patch });

function compare(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let maxDiff = 0;
  let changedAlpha = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) {
      if (a[i] !== b[i]) changedAlpha++;
      continue;
    }
    maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!));
  }
  return { maxDiff, changedAlpha };
}

describe("colour stage matches the original colour-band implementation", () => {
  const cases: [string, Partial<Adjustments>][] = [
    ["one band, boosted", { satGreen: 40 }],
    ["one band, fully desaturated", { satBlue: -100 }],
    ["red band (hue wraps around 0°)", { satRed: 60 }],
    ["all six bands boosted", Object.fromEntries(Object.keys(CENTERS).map((k) => [k, 25]))],
    [
      "mixed boosts and cuts",
      { satRed: -50, satOrange: 80, satYellow: -20, satGreen: 100, satBlue: -100, satPurple: 35 },
    ],
    ["neighbouring bands overlap", { satOrange: 70, satYellow: 70 }],
  ];

  for (const [name, patch] of cases) {
    it(`${name}: within one level on every channel, alpha untouched`, () => {
      const base = syntheticPhoto(160, 120);
      const expected = new Uint8ClampedArray(base);
      const actual = new Uint8ClampedArray(base);
      referenceColorBands(expected, adj(patch));
      applyColorBands(actual, adj(patch));
      const { maxDiff, changedAlpha } = compare(expected, actual);
      expect(maxDiff).toBeLessThanOrEqual(1);
      expect(changedAlpha).toBe(0);
      // Guard against a vacuous pass: the edit must actually have changed something.
      expect(compare(base, actual).maxDiff).toBeGreaterThan(3);
    });
  }
});

describe("colour stage behaviour", () => {
  it("does nothing when no band is active", () => {
    const base = syntheticPhoto(40, 30);
    const data = new Uint8ClampedArray(base);
    applyColorBands(data, adj({}));
    expect(data).toEqual(base);
    applyColorBands(data, adj({ satRed: 0.4 })); // below the activation threshold
    expect(data).toEqual(base);
  });

  it("leaves exact greys alone", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 90, 90, 90, 255, 255, 255, 255, 255]);
    const before = new Uint8ClampedArray(data);
    applyColorBands(data, adj({ satRed: 100, satGreen: 100, satBlue: 100 }));
    expect(data).toEqual(before);
  });

  it("fully desaturates a pure red when the red band is at -100", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    applyColorBands(data, adj({ satRed: -100 }));
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[3]).toBe(255);
  });

  it("only touches hues near the active band", () => {
    // Pure blue (210°-ish band) must be unaffected by a red-only change; pure red must change.
    const data = new Uint8ClampedArray([0, 0, 255, 255, 200, 60, 60, 255]);
    applyColorBands(data, adj({ satRed: -100 }));
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expect(data[4]).not.toBe(200);
  });

  it("treats hues just either side of 0° the same for the red band", () => {
    // Hue ~350° and ~10° are equally far from red; both should lose a similar amount of saturation.
    const data = new Uint8ClampedArray([200, 40, 74, 255, 200, 74, 40, 255]);
    const spread = (a: number, b: number, c: number) => Math.max(a, b, c) - Math.min(a, b, c);
    const before = [spread(200, 40, 74), spread(200, 74, 40)];
    applyColorBands(data, adj({ satRed: -60 }));
    const after = [spread(data[0]!, data[1]!, data[2]!), spread(data[4]!, data[5]!, data[6]!)];
    expect(after[0]).toBeLessThan(before[0]!);
    expect(after[1]).toBeLessThan(before[1]!);
    expect(Math.abs(after[0]! - after[1]!)).toBeLessThanOrEqual(2);
  });

  it("reports which bands are active", () => {
    expect(activeBands(adj({ satGreen: 10, satBlue: -3, satRed: 0.5 }))).toEqual([
      "satGreen",
      "satBlue",
    ]);
    expect(hasActiveBands(adj({}))).toBe(false);
    expect(hasActiveBands(adj({ satPurple: -1 }))).toBe(true);
  });
});

describe("planColorStage", () => {
  it("returns null when nothing in the stage is active, so the pixel pass is skipped", () => {
    expect(planColorStage(adj({}))).toBeNull();
    expect(planColorStage(adj({ satRed: 0.4, satBlue: -0.5 }))).toBeNull(); // below the activation threshold
  });

  it("returns a plan with a band table as soon as one band is active", () => {
    const plan = planColorStage(adj({ satGreen: 30 }));
    expect(plan).not.toBeNull();
    expect(plan!.bandTable).toBeInstanceOf(Float32Array);
  });
});

describe("buildBandTable", () => {
  const at = (table: Float32Array, hue: number) =>
    table[Math.round((hue / 360) * BAND_TABLE_SIZE) % BAND_TABLE_SIZE]!;

  it("is null with no active band", () => {
    expect(buildBandTable(adj({}))).toBeNull();
  });

  it("peaks at the band's centre and fades to zero at its edges", () => {
    const table = buildBandTable(adj({ satGreen: 80 }))!;
    const centre = HUE_BAND_CENTERS.satGreen;
    expect(at(table, centre)).toBeCloseTo(80, 1);
    expect(at(table, centre + HUE_BAND_HALF_WIDTH / 2)).toBeLessThan(80);
    expect(at(table, centre + HUE_BAND_HALF_WIDTH / 2)).toBeGreaterThan(0);
    expect(at(table, centre + HUE_BAND_HALF_WIDTH + 1)).toBe(0);
    expect(at(table, centre - HUE_BAND_HALF_WIDTH - 1)).toBe(0);
  });

  it("is symmetric around the centre, including across 0° for the red band", () => {
    const table = buildBandTable(adj({ satRed: 60 }))!;
    for (const offset of [5, 15, 30, 44]) {
      expect(at(table, offset)).toBeCloseTo(at(table, 360 - offset), 1);
    }
  });

  it("adds neighbouring bands where they overlap", () => {
    const both = buildBandTable(adj({ satOrange: 40, satYellow: 40 }))!;
    const orange = buildBandTable(adj({ satOrange: 40 }))!;
    const yellow = buildBandTable(adj({ satYellow: 40 }))!;
    expect(at(both, 45)).toBeCloseTo(at(orange, 45) + at(yellow, 45), 3);
  });
});
