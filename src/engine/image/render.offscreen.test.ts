import { afterEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import { resetCanvasFilterSupportCache } from "./canvasFilter";
import { DEFAULT_EDIT_STATE, type EditState, type MaskLayer } from "@/types/editor";

/**
 * The render pipeline must run with no `document` at all, because that is what a Web Worker is.
 * These tests remove `document`, provide a fake OffscreenCanvas, and run the real renderImage with
 * every stage that makes scratch canvases switched on: sharpen, local masks, heal strokes, colour
 * bands, and the Safari pixel fallback for `ctx.filter`.
 */
type Call = { name: string; args: unknown[] };

class FakeOffscreen {
  static made: FakeOffscreen[] = [];
  static nativeFilter = true;
  calls: Call[] = [];
  private ctx: unknown;
  constructor(
    public width: number,
    public height: number,
  ) {
    FakeOffscreen.made.push(this);
    this.ctx = new Proxy({} as Record<string, unknown>, {
      get:
        (_t, prop: string) =>
        (...args: unknown[]) => {
          this.calls.push({ name: prop, args });
          if (prop === "createRadialGradient") return { addColorStop() {} };
          if (prop === "getImageData") {
            const [, , w, h] = args as number[];
            const value = w! * h! === 1 ? (FakeOffscreen.nativeFilter ? 255 : 0) : 100;
            return { data: new Uint8ClampedArray(w! * h! * 4).fill(value), width: w, height: h };
          }
          return undefined;
        },
      set: (_t, prop: string, value) => {
        this.calls.push({ name: `set:${prop}`, args: [value] });
        return true;
      },
    });
  }
  getContext() {
    return this.ctx;
  }
}

function setup(nativeFilter: boolean) {
  resetCanvasFilterSupportCache();
  FakeOffscreen.made = [];
  FakeOffscreen.nativeFilter = nativeFilter;
  vi.stubGlobal("document", undefined);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

let nextId = 0;
const everything = (): { edit: EditState; layers: MaskLayer[] } => ({
  edit: {
    ...DEFAULT_EDIT_STATE,
    adjustments: {
      ...DEFAULT_EDIT_STATE.adjustments,
      exposure: 12,
      sharpness: 50,
      satGreen: 30,
    },
    healStrokes: [{ x: 0.5, y: 0.5, dx: 0.1, dy: 0.1, radius: 0.05, softness: 40 }],
  },
  layers: [
    {
      id: `layer-${nextId++}`,
      name: "local",
      strokes: [{ x: 0.5, y: 0.5, radius: 0.1 }],
      adjustments: { exposure: 10, contrast: 0, saturation: 0, temperature: 20 },
    },
  ],
});

function run(nativeFilter: boolean) {
  setup(nativeFilter);
  const { edit, layers } = everything();
  const target = new FakeOffscreen(0, 0);
  FakeOffscreen.made = [];
  renderImage({} as CanvasImageSource, 400, 300, edit, target as never, undefined, layers);
  return { target, scratch: FakeOffscreen.made };
}

describe("renderImage with no document (Worker-style)", () => {
  for (const [label, native] of [
    ["native ctx.filter", true],
    ["Safari pixel fallback", false],
  ] as const) {
    it(`renders every stage using OffscreenCanvas scratch canvases (${label})`, () => {
      const { target, scratch } = run(native);
      // Heal source, sharpen blur copy, mask canvas, local-layer temp (and the filter probe).
      expect(scratch.length).toBeGreaterThanOrEqual(4);
      // Each scratch canvas was sized to the render, not left at the constructor default.
      expect(
        scratch.filter((c) => c.width === 400 && c.height === 300).length,
      ).toBeGreaterThanOrEqual(4);
      // The local layer was composited back onto the target.
      const drawn = target.calls
        .filter((c) => c.name === "drawImage")
        .map((c) => c.args[0] as unknown);
      expect(drawn.some((a) => scratch.includes(a as FakeOffscreen))).toBe(true);
      // The filter probe ran against an OffscreenCanvas too: it only sets ctx.filter anywhere
      // when native filtering was detected, and uses pixel maths otherwise.
      const setFilter = [target, ...scratch]
        .flatMap((c) => c.calls)
        .some((c) => c.name === "set:filter" && c.args[0] !== "none" && c.args[0] !== "invert(1)");
      expect(setFilter).toBe(native);
      // Sharpen and colour bands both wrote pixels back to the target.
      expect(target.calls.filter((c) => c.name === "putImageData").length).toBeGreaterThanOrEqual(
        2,
      );
    });
  }
});
