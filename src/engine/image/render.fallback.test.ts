import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import { resetCanvasFilterSupportCache } from "./canvasFilter";
import { DEFAULT_EDIT_STATE, type EditState, type MaskLayer } from "@/types/editor";

/**
 * Runs the real renderImage against a recording fake canvas that either honours ctx.filter
 * (Chrome, Firefox) or ignores it (Safari, iOS), and checks which path the renderer takes.
 */
type Call = { name: string; args: unknown[] };
type FakeCanvas = { width: number; height: number; calls: Call[]; getContext: () => unknown };

let made: FakeCanvas[] = [];

function fakeCanvas(nativeFilter: boolean): FakeCanvas {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, prop: string) =>
      (...args: unknown[]) => {
        calls.push({ name: prop, args });
        if (prop === "createRadialGradient") return { addColorStop() {} };
        if (prop === "getImageData") {
          const [, , w, h] = args as number[];
          // The 1×1 support probe reads 255 only if the filter really inverted the black pixel.
          const value = w! * h! === 1 ? (nativeFilter ? 255 : 0) : 100;
          return { data: new Uint8ClampedArray(w! * h! * 4).fill(value), width: w, height: h };
        }
        return undefined;
      },
    set: (_t, prop: string, value) => {
      calls.push({ name: `set:${prop}`, args: [value] });
      return true;
    },
  });
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

const setup = (nativeFilter: boolean) => {
  resetCanvasFilterSupportCache();
  made = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const c = fakeCanvas(nativeFilter);
      made.push(c);
      return c;
    },
  });
};
afterEach(() => vi.unstubAllGlobals());

const mask: MaskLayer = {
  id: "m",
  name: "m",
  strokes: [{ x: 0.5, y: 0.5, radius: 0.1 }],
  adjustments: { exposure: 10, contrast: 0, saturation: 0, temperature: 0 },
};

function render(edit: EditState, withMask = false) {
  const target = fakeCanvas(false);
  renderImage(
    {} as CanvasImageSource,
    400,
    300,
    edit,
    target as never,
    undefined,
    withMask ? [mask] : [],
  );
  const all = [target, ...made];
  const calls = (name: string) => all.flatMap((c) => c.calls).filter((c) => c.name === name);
  const filters = calls("set:filter").map((c) => String(c.args[0]));
  return { target, filters, calls };
}

const bright = (exposure: number): EditState => ({
  ...DEFAULT_EDIT_STATE,
  adjustments: { ...DEFAULT_EDIT_STATE.adjustments, exposure },
});

describe("renderer when the browser supports ctx.filter", () => {
  beforeEach(() => setup(true));

  it("uses the native filter and does no pixel work for plain adjustments", () => {
    const { filters, target } = render(bright(50));
    expect(filters.some((f) => f.includes("brightness(1.2750)"))).toBe(true);
    expect(target.calls.filter((c) => c.name === "putImageData")).toHaveLength(0);
  });
});

describe("renderer when ctx.filter is ignored (Safari / iOS)", () => {
  beforeEach(() => setup(false));

  it("never relies on the native filter, and brightens the pixels directly", () => {
    const { filters, target } = render(bright(50));
    expect(filters.some((f) => f.includes("brightness("))).toBe(false);
    const written = target.calls.find((c) => c.name === "putImageData")!.args[0] as {
      data: Uint8ClampedArray;
    };
    expect(written.data[0]).toBeGreaterThan(100); // fake image is 100; exposure +50 brightens it
  });

  it("does not touch the pixels when there is nothing to adjust", () => {
    const { target } = render(DEFAULT_EDIT_STATE);
    expect(target.calls.filter((c) => c.name === "putImageData")).toHaveLength(0);
  });

  it("uses the pixel fallback for sharpening instead of a native blur", () => {
    const edit = {
      ...DEFAULT_EDIT_STATE,
      adjustments: { ...DEFAULT_EDIT_STATE.adjustments, sharpness: 50 },
    };
    const { filters } = render(edit);
    expect(filters.some((f) => f.includes("blur("))).toBe(false);
  });

  it("uses the pixel fallback for local areas too", () => {
    const { calls } = render(DEFAULT_EDIT_STATE, true);
    const writes = calls("putImageData").map(
      (c) => (c.args[0] as { data: Uint8ClampedArray }).data[0],
    );
    expect(writes.some((v) => v! > 100)).toBe(true); // area exposure +10 → 100 × 1.055
  });
});
