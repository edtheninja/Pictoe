import { describe, expect, it } from "vitest";
import { exportWithFallback } from "./exportFallback";
import {
  MIN_LONG_EDGE,
  ORIGINAL_SIZE,
  describeSizeNote,
  parseWholeNumber,
  resolveExportSize,
  type SizeSetting,
} from "./exportSize";
import { scaledSize } from "./outputScale";

const resolve = (setting: SizeSetting, w = 6000, h = 4000) => resolveExportSize(setting, w, h);
const percent = (p: number): SizeSetting => ({ mode: "percent", percent: p });
const edge = (pixels: number): SizeSetting => ({ mode: "longEdge", pixels });

describe("resolveExportSize: original", () => {
  it("is the photo's own size, with nothing to say", () => {
    expect(resolve(ORIGINAL_SIZE)).toEqual({
      width: 6000,
      height: 4000,
      longEdge: 6000,
      scale: 1,
      note: null,
    });
    expect(resolve(ORIGINAL_SIZE, 4000, 6000)).toMatchObject({
      width: 4000,
      height: 6000,
      longEdge: 6000,
    });
  });
});

describe("resolveExportSize: percent", () => {
  it("takes a share of the longest side, landscape or portrait", () => {
    expect(resolve(percent(50))).toMatchObject({
      width: 3000,
      height: 2000,
      longEdge: 3000,
      note: null,
    });
    expect(resolve(percent(25), 4000, 6000)).toMatchObject({ width: 1000, height: 1500 });
    expect(resolve(percent(33))).toMatchObject({ width: 1980, height: 1320 });
  });

  it("100% is the original size with no note, and more than 100% is not an enlargement", () => {
    expect(resolve(percent(100))).toMatchObject({
      width: 6000,
      height: 4000,
      scale: 1,
      note: null,
    });
    expect(resolve(percent(150))).toMatchObject({
      width: 6000,
      height: 4000,
      scale: 1,
      note: "not-upscaled",
    });
  });

  it("reports the scale as a share of the original", () => {
    expect(resolve(percent(50)).scale).toBe(0.5);
    expect(resolve(edge(1500)).scale).toBe(0.25);
  });
});

describe("resolveExportSize: longest side", () => {
  it("makes the longest side exactly that, whichever way the photo is turned", () => {
    expect(resolve(edge(2048))).toMatchObject({ width: 2048, height: 1365, longEdge: 2048 });
    expect(resolve(edge(2048), 4000, 6000)).toMatchObject({
      width: 1365,
      height: 2048,
      longEdge: 2048,
    });
    expect(resolve(edge(1000), 3000, 3000)).toMatchObject({ width: 1000, height: 1000 });
  });

  it("is the original when it equals the photo, and not an enlargement when it is more", () => {
    expect(resolve(edge(6000))).toMatchObject({ width: 6000, height: 4000, note: null });
    expect(resolve(edge(6001))).toMatchObject({ width: 6000, height: 4000, note: "not-upscaled" });
    expect(resolve(edge(100_000))).toMatchObject({
      width: 6000,
      height: 4000,
      note: "not-upscaled",
    });
  });

  it("rounds a fractional request to the nearest pixel", () => {
    expect(resolve(edge(2047.6)).longEdge).toBe(2048);
    expect(resolve(edge(2047.4)).longEdge).toBe(2047);
  });

  it("raises a tiny request to the minimum and says so", () => {
    expect(resolve(edge(1))).toMatchObject({ longEdge: MIN_LONG_EDGE, note: "raised-to-minimum" });
    expect(resolve(percent(0.1))).toMatchObject({
      longEdge: MIN_LONG_EDGE,
      note: "raised-to-minimum",
    });
    expect(resolve(edge(MIN_LONG_EDGE))).toMatchObject({ longEdge: MIN_LONG_EDGE, note: null });
  });

  it("leaves a photo already at or below the minimum alone", () => {
    expect(resolveExportSize(edge(5), 10, 8)).toMatchObject({ width: 10, height: 8, note: null });
    expect(resolveExportSize(percent(10), 16, 9)).toMatchObject({
      width: 16,
      height: 9,
      note: null,
    });
  });
});

describe("resolveExportSize: nonsense never makes a broken file", () => {
  it("falls back to the original size, and says it ignored the request", () => {
    for (const setting of [
      edge(0),
      edge(-5),
      edge(Number.NaN),
      edge(Number.POSITIVE_INFINITY),
      percent(0),
      percent(-10),
      percent(Number.NaN),
    ]) {
      expect(resolve(setting)).toMatchObject({
        width: 6000,
        height: 4000,
        scale: 1,
        note: "ignored",
      });
    }
  });
});

describe("resolveExportSize: invariants over many photos and settings", () => {
  it("is never larger than the photo, never below 1 px, and its numbers agree with each other", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let n = 0; n < 3000; n++) {
      const w = 1 + Math.floor(rand() * 12_000);
      const h = 1 + Math.floor(rand() * 12_000);
      const setting: SizeSetting =
        rand() < 0.5 ? percent(Math.floor(rand() * 130)) : edge(Math.floor(rand() * 14_000));
      const r = resolveExportSize(setting, w, h);
      expect(r.width).toBeGreaterThanOrEqual(1);
      expect(r.height).toBeGreaterThanOrEqual(1);
      expect(r.width).toBeLessThanOrEqual(w);
      expect(r.height).toBeLessThanOrEqual(h);
      expect(r.longEdge).toBe(Math.max(r.width, r.height));
      expect(r.longEdge).toBeGreaterThanOrEqual(Math.min(MIN_LONG_EDGE, Math.max(w, h)));
      expect(r.scale).toBeGreaterThan(0);
      expect(r.scale).toBeLessThanOrEqual(1);
      // The size shown is the size the renderer draws at: same formula, fed the same long edge.
      expect({ width: r.width, height: r.height }).toEqual({
        width: scaledSize(w, h, r.longEdge).width,
        height: scaledSize(w, h, r.longEdge).height,
      });
    }
  });

  it("keeps the photo's proportions, to within a pixel's rounding", () => {
    for (const [w, h] of [
      [6000, 4000],
      [4000, 6000],
      [5472, 3648],
      [3024, 4032],
      [1000, 1000],
    ] as const) {
      for (const setting of [percent(10), percent(37), edge(500), edge(2048)]) {
        const r = resolveExportSize(setting, w, h);
        const wanted = (Math.min(w, h) / Math.max(w, h)) * r.longEdge;
        expect(Math.abs(Math.min(r.width, r.height) - wanted)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });
});

describe("a requested size going through the browser-limit fallback", () => {
  const blob = () => new Blob([new Uint8Array(10)]);

  it("first tries exactly the requested longest side, and it is not 'scaled' when that works", async () => {
    const requested = resolve(percent(50));
    const tried: number[] = [];
    const result = await exportWithFallback(
      requested.width,
      requested.height,
      async (maxDimension) => {
        tried.push(maxDimension);
        const s = scaledSize(6000, 4000, maxDimension);
        return { blob: blob(), width: s.width, height: s.height };
      },
    );
    expect(tried).toEqual([requested.longEdge]);
    expect(result).toMatchObject({ width: 3000, height: 2000, scaled: false });
  });

  it("steps down from the requested size, not from the photo's, and reports 'scaled' against what was asked", async () => {
    const requested = resolve(edge(4000)); // 4000 x 2667
    const tried: number[] = [];
    const result = await exportWithFallback(
      requested.width,
      requested.height,
      async (maxDimension) => {
        tried.push(maxDimension);
        const s = scaledSize(6000, 4000, maxDimension);
        // A browser that cannot make more than 5 megapixels.
        return {
          blob: s.width * s.height <= 5_000_000 ? blob() : null,
          width: s.width,
          height: s.height,
        };
      },
    );
    // 4000 x 2667 is 10.7 MP (too big); 75% of 4000 is 3000 x 2000, 6 MP (too big); half of 4000
    // is 2000 x 1333, 2.7 MP (fits). The steps are fractions of what was asked for, not of 6000.
    expect(tried).toEqual([4000, 3000, 2000]);
    expect(result).toMatchObject({ width: 2000, height: 1333, scaled: true });
  });
});

describe("parseWholeNumber", () => {
  it("reads a whole number, ignoring surrounding spaces and leading zeros", () => {
    expect(parseWholeNumber("2048")).toBe(2048);
    expect(parseWholeNumber("  2048  ")).toBe(2048);
    expect(parseWholeNumber("007")).toBe(7);
    expect(parseWholeNumber("0")).toBe(0);
  });

  it("returns null for anything else, so half-typed or odd text is never a size", () => {
    for (const text of [
      "",
      " ",
      "20x",
      "-5",
      "1.5",
      "1e3",
      "12 34",
      "1234567",
      "٣",
      "NaN",
      "0x10",
    ]) {
      expect(parseWholeNumber(text)).toBeNull();
    }
  });
});

describe("describeSizeNote", () => {
  it("has something to say for each note, and nothing for none", () => {
    expect(describeSizeNote(null)).toBeNull();
    expect(describeSizeNote("not-upscaled")).toMatch(/original size/);
    expect(describeSizeNote("raised-to-minimum")).toContain(String(MIN_LONG_EDGE));
    expect(describeSizeNote("ignored")).toMatch(/original size/);
  });
});
