import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvas, get2dContext } from "./canvasFactory";

afterEach(() => vi.unstubAllGlobals());

describe("createCanvas", () => {
  it("uses the DOM when there is one, and sets the size", () => {
    const fake = { width: 0, height: 0 };
    const createElement = vi.fn(() => fake);
    vi.stubGlobal("document", { createElement });
    const canvas = createCanvas(30, 20);
    expect(createElement).toHaveBeenCalledWith("canvas");
    expect(canvas).toBe(fake);
    expect(fake).toMatchObject({ width: 30, height: 20 });
  });

  it("falls back to OffscreenCanvas when there is no document (a Worker)", () => {
    class FakeOffscreen {
      constructor(
        public width: number,
        public height: number,
      ) {}
    }
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const canvas = createCanvas(64, 48);
    expect(canvas).toBeInstanceOf(FakeOffscreen);
    expect(canvas).toMatchObject({ width: 64, height: 48 });
  });

  it("throws a clear error when neither is available", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(() => createCanvas(1, 1)).toThrow("no-canvas-available");
  });
});

describe("get2dContext", () => {
  it("passes the context options through", () => {
    const getContext = vi.fn(() => "ctx");
    const canvas = { getContext } as never;
    expect(get2dContext(canvas, { willReadFrequently: true })).toBe("ctx");
    expect(getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
  });
});
