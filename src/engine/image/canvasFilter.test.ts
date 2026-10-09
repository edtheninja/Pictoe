import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFilterFallback,
  filterPixels,
  filterString,
  NO_FILTER,
  resetCanvasFilterSupportCache,
  supportsCanvasFilter,
  type FilterParams,
} from "./canvasFilter";

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const run = (data: Uint8ClampedArray, over: Partial<FilterParams>, w = 1, h = 1) => {
  filterPixels(data, w, h, { ...NO_FILTER, ...over });
  return Array.from(data);
};
const near = (actual: number, expected: number, tol = 1) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe("filterString", () => {
  it("produces the same CSS filter string the renderer always used", () => {
    expect(filterString({ brightness: 1.2, contrast: 0.9, saturate: 1.5, blurPx: 0 })).toBe(
      "brightness(1.2000) contrast(0.9000) saturate(1.5000)",
    );
    expect(filterString({ ...NO_FILTER, blurPx: 2.5 })).toBe(
      "brightness(1.0000) contrast(1.0000) saturate(1.0000) blur(2.50px)",
    );
    expect(filterString({ ...NO_FILTER, blurPx: 0.1 })).not.toContain("blur");
  });
});

describe("filterPixels (Safari fallback) follows the CSS filter definitions", () => {
  it("leaves the image alone for neutral settings", () => {
    expect(run(px(10, 120, 250), {})).toEqual([10, 120, 250, 255]);
  });

  it("brightness multiplies and clamps", () => {
    expect(run(px(100, 100, 100), { brightness: 1.5 })).toEqual([150, 150, 150, 255]);
    expect(run(px(200, 100, 10), { brightness: 2 })).toEqual([255, 200, 20, 255]);
  });

  it("contrast pivots around mid-grey", () => {
    const [r] = run(px(100, 100, 100), { contrast: 2 });
    near(r!, 72.5); // (100/255 − 0.5) × 2 + 0.5, scaled back to 0–255
    near(run(px(128, 128, 128), { contrast: 3 })[0]!, 128, 2); // mid-grey is the fixed point
  });

  it("saturate 0 gives the spec's luminance grey, saturate 1 changes nothing", () => {
    const grey = run(px(200, 100, 50), { saturate: 0 });
    const luma = 0.213 * 200 + 0.715 * 100 + 0.072 * 50;
    for (const channel of grey.slice(0, 3)) near(channel, luma);
    expect(run(px(200, 100, 50), { saturate: 1 })).toEqual([200, 100, 50, 255]);
  });

  it("leaves alpha untouched", () => {
    expect(run(px(100, 100, 100, 77), { brightness: 1.5, contrast: 1.2, saturate: 0.5 })[3]).toBe(
      77,
    );
  });

  it("applies brightness before contrast, as the filter string does", () => {
    // brightness 0.5 then contrast 2 on 200: 100 → 72.5. The other order would give 127.5.
    near(run(px(200, 200, 200), { brightness: 0.5, contrast: 2 })[0]!, 72.5);
  });
});

describe("gaussian blur fallback", () => {
  const size = 21;
  const image = (centre: number) => {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
    const c = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    data[c] = centre;
    return data;
  };
  const red = (data: Uint8ClampedArray, x: number, y: number) => data[(y * size + x) * 4]!;

  it("keeps a flat image flat", () => {
    const data = new Uint8ClampedArray(size * size * 4).fill(90);
    filterPixels(data, size, size, { ...NO_FILTER, blurPx: 3 });
    expect(new Set(data).size).toBe(1);
  });

  it("spreads a bright pixel symmetrically and roughly preserves total light", () => {
    const data = image(255);
    filterPixels(data, size, size, { ...NO_FILTER, blurPx: 1.5 });
    const c = 10;
    expect(red(data, c, c)).toBeLessThan(255);
    expect(red(data, c + 1, c)).toBeGreaterThan(0);
    expect(red(data, c - 1, c)).toBe(red(data, c + 1, c));
    expect(red(data, c, c - 1)).toBe(red(data, c, c + 1));
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += data[i]!;
    expect(Math.abs(total - 255) / 255).toBeLessThan(0.05);
  });

  it("does nothing below the blur threshold", () => {
    const data = image(255);
    const before = Array.from(data);
    filterPixels(data, size, size, { ...NO_FILTER, blurPx: 0.1 });
    expect(Array.from(data)).toEqual(before);
  });
});

describe("applyFilterFallback", () => {
  const fakeCtx = () => {
    const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(100),
      width: w,
      height: h,
    }));
    const putImageData = vi.fn();
    return { ctx: { getImageData, putImageData } as never, getImageData, putImageData };
  };

  it("skips the pixel round-trip entirely when there is nothing to do", () => {
    const { ctx, getImageData } = fakeCtx();
    applyFilterFallback(ctx, 4, 4, NO_FILTER);
    expect(getImageData).not.toHaveBeenCalled();
  });

  it("reads, filters and writes back otherwise", () => {
    const { ctx, putImageData } = fakeCtx();
    applyFilterFallback(ctx, 2, 2, { ...NO_FILTER, brightness: 1.5 });
    const written = putImageData.mock.calls[0]![0] as { data: Uint8ClampedArray };
    expect(written.data[0]).toBe(150);
  });
});

describe("supportsCanvasFilter", () => {
  beforeEach(() => resetCanvasFilterSupportCache());
  afterEach(() => vi.unstubAllGlobals());

  const stubProbe = (pixel: () => number) =>
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillRect() {}, getImageData: () => ({ data: [pixel()] }) }),
      }),
    });

  it("is true when inverting black produced white", () => {
    stubProbe(() => 255);
    expect(supportsCanvasFilter()).toBe(true);
  });

  it("is false when the filter was ignored, as in Safari", () => {
    stubProbe(() => 0);
    expect(supportsCanvasFilter()).toBe(false);
  });

  it("keeps the native path when the check cannot run", () => {
    stubProbe(() => {
      throw new Error("no canvas");
    });
    expect(supportsCanvasFilter()).toBe(true);
  });

  it("only probes once", () => {
    const pixel = vi.fn(() => 0);
    stubProbe(pixel);
    supportsCanvasFilter();
    supportsCanvasFilter();
    expect(pixel).toHaveBeenCalledTimes(1);
  });
});
