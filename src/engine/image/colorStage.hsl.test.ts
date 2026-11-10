import { describe, expect, it } from "vitest";
import {
  BAND_CENTERS,
  BAND_TABLE_SIZE,
  HUE_BAND_HALF_WIDTH,
  HUE_SHIFT_DEGREES,
  LUM_STRENGTH,
  buildBandTables,
} from "./colorBands";
import { applyColorStage, planColorStage } from "./colorStage";
import {
  BAND_NAMES,
  DEFAULT_ADJUSTMENTS,
  bandKey,
  identityCurves,
  type Adjustments,
} from "@/types/editor";

const adj = (patch: Partial<Adjustments> = {}): Adjustments => ({
  ...DEFAULT_ADJUSTMENTS,
  ...patch,
});

function run(pixels: [number, number, number][], a: Adjustments) {
  const data = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  const plan = planColorStage(a);
  if (plan) applyColorStage(data, plan);
  return pixels.map((_, i) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!]);
}

// --- a direct-formula reference: no tables, cosine weights evaluated per pixel -----------------
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
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(f(h / 360 + 1 / 3) * 255),
    Math.round(f(h / 360) * 255),
    Math.round(f(h / 360 - 1 / 3) * 255),
  ];
}
const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
function referenceMixer(d: Uint8ClampedArray, a: Adjustments) {
  for (let i = 0; i < d.length; i += 4) {
    const { h, s, l } = rgbToHsl(d[i]!, d[i + 1]!, d[i + 2]!);
    if (s < 0.02) continue;
    let satDelta = 0;
    let hueDelta = 0;
    let lumDelta = 0;
    for (const band of BAND_NAMES) {
      const dist = hueDistance(h, BAND_CENTERS[band]);
      if (dist >= HUE_BAND_HALF_WIDTH) continue;
      const w = Math.cos((dist / HUE_BAND_HALF_WIDTH) * (Math.PI / 2));
      satDelta += w * a[bandKey("sat", band)];
      hueDelta += w * (a[bandKey("hue", band)] / 100) * HUE_SHIFT_DEGREES;
      lumDelta += w * (a[bandKey("lum", band)] / 100);
    }
    lumDelta = Math.max(-1, Math.min(1, lumDelta));
    if (satDelta === 0 && hueDelta === 0 && lumDelta === 0) continue;
    const newS = Math.max(0, Math.min(1, s * (1 + satDelta / 100)));
    const newH = (((h + hueDelta) % 360) + 360) % 360;
    const newL =
      lumDelta > 0 ? l + (1 - l) * lumDelta * LUM_STRENGTH : l + l * lumDelta * LUM_STRENGTH;
    const [r, g, b] = hslToRgb(newH, newS, newL);
    d[i] = r!;
    d[i + 1] = g!;
    d[i + 2] = b!;
  }
}

function photo(w: number, h: number) {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 31415;
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
  for (let k = 0; k < 40; k++) d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = k * 6;
  return d;
}

describe("colour mixer matches a direct per-pixel formula", () => {
  const cases: [string, Partial<Adjustments>][] = [
    ["hue only", { hueGreen: 80 }],
    ["luminance only, darker", { lumBlue: -90 }],
    ["luminance only, lighter", { lumRed: 70 }],
    ["hue, saturation and luminance on one band", { hueOrange: -60, satOrange: 40, lumOrange: 30 }],
    ["overlapping neighbours", { hueOrange: 70, lumYellow: -50, satOrange: 30, satYellow: -40 }],
    [
      "every slider at once",
      Object.fromEntries(
        BAND_NAMES.flatMap((band, i) => [
          [bandKey("hue", band), (i % 2 ? 1 : -1) * (20 + i * 12)],
          [bandKey("sat", band), (i % 2 ? -1 : 1) * (15 + i * 10)],
          [bandKey("lum", band), (i % 3 === 0 ? 1 : -1) * (25 + i * 8)],
        ]),
      ),
    ],
  ];

  for (const [name, patch] of cases) {
    it(`${name}: within two levels on every channel, alpha untouched`, () => {
      const base = photo(160, 120);
      const expected = new Uint8ClampedArray(base);
      const actual = new Uint8ClampedArray(base);
      referenceMixer(expected, adj(patch));
      applyColorStage(actual, planColorStage(adj(patch))!);
      let maxDiff = 0;
      let alphaChanged = 0;
      let changed = 0;
      for (let i = 0; i < base.length; i++) {
        if (i % 4 === 3) {
          if (expected[i] !== actual[i]) alphaChanged++;
          continue;
        }
        maxDiff = Math.max(maxDiff, Math.abs(expected[i]! - actual[i]!));
        if (actual[i] !== base[i]) changed++;
      }
      expect(maxDiff).toBeLessThanOrEqual(2);
      expect(alphaChanged).toBe(0);
      expect(changed).toBeGreaterThan(200); // the edit really did something
    });
  }
});

describe("hue", () => {
  it("a positive value turns red towards orange, a negative value towards purple", () => {
    const [up] = run([[255, 0, 0]], adj({ hueRed: 100 }));
    expect(up![0]).toBe(255);
    expect(Math.abs(up![1]! - 255 * (HUE_SHIFT_DEGREES / 60))).toBeLessThanOrEqual(3);
    expect(up![2]).toBe(0);
    expect(Math.abs(up![1]! - 128)).toBeLessThanOrEqual(3); // a full slider turns the hue 30 degrees
    const [down] = run([[255, 0, 0]], adj({ hueRed: -100 }));
    expect(down![1]).toBe(0);
    expect(Math.abs(down![2]! - 255 * (HUE_SHIFT_DEGREES / 60))).toBeLessThanOrEqual(3);
  });

  it("keeps the pixel's saturation and lightness, and turns its hue by the expected amount", () => {
    const px: [number, number, number] = [200, 100, 50];
    const before = rgbToHsl(...px);
    const [r, g, b] = run([px], adj({ hueOrange: 60 }))[0]!;
    const after = rgbToHsl(r!, g!, b!);
    const weight = Math.cos(
      (hueDistance(before.h, BAND_CENTERS.Orange) / HUE_BAND_HALF_WIDTH) * (Math.PI / 2),
    );
    expect(Math.abs(after.s - before.s)).toBeLessThan(0.015);
    expect(Math.abs(after.l - before.l)).toBeLessThan(0.015);
    expect(Math.abs(after.h - (before.h + weight * 0.6 * HUE_SHIFT_DEGREES))).toBeLessThan(1.5);
  });

  it("wraps around 0 and 360 degrees", () => {
    // A pinkish red at about 350 degrees, pushed up by the red band, ends up in the oranges.
    const px: [number, number, number] = [255, 0, 43];
    expect(rgbToHsl(...px).h).toBeGreaterThan(345);
    const [r, g, b] = run([px], adj({ hueRed: 100 }))[0]!;
    const after = rgbToHsl(r!, g!, b!);
    expect(after.h).toBeLessThan(40);
    expect(after.h).toBeGreaterThan(5);
  });
});

describe("luminance", () => {
  const green: [number, number, number] = [40, 200, 60];

  it("a negative value darkens the band's colours and a positive value lightens them", () => {
    const l0 = rgbToHsl(...green).l;
    const dark = run([green], adj({ lumGreen: -100 }))[0]!;
    const light = run([green], adj({ lumGreen: 100 }))[0]!;
    expect(rgbToHsl(dark[0]!, dark[1]!, dark[2]!).l).toBeLessThan(l0 - 0.15);
    expect(rgbToHsl(light[0]!, light[1]!, light[2]!).l).toBeGreaterThan(l0 + 0.15);
  });

  it("moves lightness by the documented amount and keeps hue and saturation", () => {
    const before = rgbToHsl(...green);
    const weight = Math.cos(
      (hueDistance(before.h, BAND_CENTERS.Green) / HUE_BAND_HALF_WIDTH) * (Math.PI / 2),
    );
    const [r, g, b] = run([green], adj({ lumGreen: -100 }))[0]!;
    const after = rgbToHsl(r!, g!, b!);
    expect(Math.abs(after.l - before.l * (1 - weight * LUM_STRENGTH))).toBeLessThan(0.012);
    expect(Math.abs(after.h - before.h)).toBeLessThan(1.5);
    expect(Math.abs(after.s - before.s)).toBeLessThan(0.02);
  });

  it("never pushes lightness past white or black", () => {
    const [bright] = run([[255, 250, 120]], adj({ lumYellow: 100, lumOrange: 100 }));
    const [dim] = run([[30, 25, 0]], adj({ lumYellow: -100, lumOrange: -100 }));
    for (const v of [...bright!, ...dim!]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("what the mixer leaves alone", () => {
  it("pixels outside every adjusted band are unchanged, exactly", () => {
    const blue: [number, number, number] = [30, 60, 220];
    expect(
      run([blue], adj({ hueGreen: 100, satGreen: 100, lumGreen: 100 }))[0]!.slice(0, 3),
    ).toEqual(blue);
    // Hue about 175 degrees is more than 45 degrees from both the green and the red band.
    const cyan: [number, number, number] = [0, 255, 234];
    expect(rgbToHsl(...cyan).h).toBeGreaterThan(170);
    const redAndGreen = adj({
      hueGreen: 100,
      satGreen: 100,
      lumGreen: 100,
      hueRed: 100,
      satRed: 100,
      lumRed: 100,
    });
    expect(run([cyan], redAndGreen)[0]!.slice(0, 3)).toEqual(cyan);
  });

  it("across a whole photo, every pixel outside the adjusted band is byte-identical", () => {
    const base = photo(220, 160);
    const data = new Uint8ClampedArray(base);
    applyColorStage(data, planColorStage(adj({ hueGreen: 100, satGreen: 60, lumGreen: -40 }))!);
    let outside = 0;
    for (let i = 0; i < base.length; i += 4) {
      const { h } = rgbToHsl(base[i]!, base[i + 1]!, base[i + 2]!);
      if (hueDistance(h, BAND_CENTERS.Green) < HUE_BAND_HALF_WIDTH + 1) continue;
      outside++;
      expect([data[i], data[i + 1], data[i + 2]]).toEqual([base[i], base[i + 1], base[i + 2]]);
    }
    expect(outside).toBeGreaterThan(10000); // most of the photo is outside the green band
  });

  it("greys and near-greys are unchanged, and alpha is never touched", () => {
    const all = Object.fromEntries(
      BAND_NAMES.flatMap((b) => [
        [bandKey("hue", b), 100],
        [bandKey("lum", b), 100],
      ]),
    );
    expect(run([[90, 90, 90]], adj(all))[0]!.slice(0, 3)).toEqual([90, 90, 90]);
    const data = new Uint8ClampedArray([200, 60, 60, 77]);
    applyColorStage(data, planColorStage(adj({ hueRed: 50, lumRed: 50 }))!);
    expect(data[3]).toBe(77);
  });

  it("does no pixel work while every mixer slider is at zero", () => {
    expect(planColorStage(adj())).toBeNull();
  });
});

describe("band tables for hue and luminance", () => {
  const at = (table: Float32Array, hue: number) =>
    table[Math.round((hue / 360) * BAND_TABLE_SIZE) % BAND_TABLE_SIZE]!;

  it("are null with no mixer slider active, and appear for a hue or luminance slider alone", () => {
    expect(buildBandTables(adj())).toBeNull();
    expect(buildBandTables(adj({ hueRed: 20 }))).not.toBeNull();
    expect(buildBandTables(adj({ lumPurple: -20 }))).not.toBeNull();
  });

  it("hue peaks at the centre at slider times the maximum turn, and fades to zero at the edges", () => {
    const t = buildBandTables(adj({ hueGreen: 50 }))!;
    expect(at(t.hue, BAND_CENTERS.Green)).toBeCloseTo(0.5 * HUE_SHIFT_DEGREES, 3);
    expect(at(t.hue, BAND_CENTERS.Green + HUE_BAND_HALF_WIDTH + 1)).toBe(0);
    expect(Array.from(t.sat).every((v) => v === 0)).toBe(true);
  });

  it("luminance peaks at the centre at the slider value and is limited to -1..1 where bands overlap", () => {
    const one = buildBandTables(adj({ lumBlue: -60 }))!;
    expect(at(one.lum, BAND_CENTERS.Blue)).toBeCloseTo(-0.6, 3);
    const overlap = buildBandTables(adj({ lumOrange: 100, lumYellow: 100 }))!;
    for (const v of overlap.lum) {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(-1);
    }
  });

  it("marks only the hues some slider touches", () => {
    const t = buildBandTables(adj({ hueGreen: 50 }))!;
    expect(t.touched[Math.round((BAND_CENTERS.Green / 360) * BAND_TABLE_SIZE)]).toBe(1);
    expect(t.touched[Math.round((BAND_CENTERS.Red / 360) * BAND_TABLE_SIZE)]).toBe(0);
  });
});

describe("the mixer in the whole stage", () => {
  it("runs after tonal and curves: the same bytes as applying the sections one after another", () => {
    const base = photo(150, 100);
    const tonal = { shadows: 40, highlights: -30 };
    const mixer = { hueRed: 40, satGreen: 40, lumBlue: -50, lumOrange: 30 };
    const curves = {
      rgb: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ],
      luma: identityCurves().luma,
    };

    const together = new Uint8ClampedArray(base);
    applyColorStage(together, planColorStage(adj({ ...tonal, ...mixer }), curves)!);

    const step = new Uint8ClampedArray(base);
    applyColorStage(step, planColorStage(adj(tonal))!);
    applyColorStage(step, planColorStage(adj(), curves)!);
    applyColorStage(step, planColorStage(adj(mixer))!);

    expect(together).toEqual(step);
  });
});
