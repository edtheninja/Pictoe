import { afterEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import { resetCanvasFilterSupportCache } from "./canvasFilter";
import {
  DEFAULT_EDIT_STATE,
  identityCurves,
  type Adjustments,
  type CurvesState,
  type EditState,
} from "@/types/editor";

/**
 * Highlights, shadows, whites and blacks must no longer be drawn as blend-mode layers: they are
 * part of the colour stage, which reads and writes the pixels once however many of its
 * operations are on.
 */
type Call = { name: string; args: unknown[] };

class FakeCanvas {
  calls: Call[] = [];
  private ctx: unknown;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.ctx = new Proxy({} as Record<string, unknown>, {
      get:
        (_t, prop: string) =>
        (...args: unknown[]) => {
          this.calls.push({ name: prop, args });
          if (prop === "getImageData") {
            const [, , w, h] = args as number[];
            const value = w! * h! === 1 ? 255 : 90; // 1x1 is the filter probe: report support
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

afterEach(() => vi.unstubAllGlobals());

function render(patch: Partial<Adjustments>, curves?: CurvesState) {
  resetCanvasFilterSupportCache();
  vi.stubGlobal("document", undefined);
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  const edit: EditState = {
    ...DEFAULT_EDIT_STATE,
    adjustments: { ...DEFAULT_EDIT_STATE.adjustments, ...patch },
    curves: curves ?? identityCurves(),
  };
  const target = new FakeCanvas(0, 0);
  renderImage({} as CanvasImageSource, 400, 300, edit, target as never);
  return target.calls;
}

const fills = (calls: Call[]) => calls.filter((c) => c.name === "fillRect");
const blendModes = (calls: Call[]) =>
  calls.filter((c) => c.name === "set:globalCompositeOperation").map((c) => c.args[0]);
const fullReads = (calls: Call[]) =>
  calls.filter((c) => c.name === "getImageData" && (c.args[2] as number) > 1);
const fullWrites = (calls: Call[]) => calls.filter((c) => c.name === "putImageData");

describe("tonal adjustments in the render pipeline", () => {
  it("are not drawn as blend-mode layers any more", () => {
    const calls = render({ highlights: 50, shadows: 30, whites: 20, blacks: -20 });
    expect(fills(calls)).toHaveLength(0);
    for (const mode of ["soft-light", "overlay", "lighten", "multiply"]) {
      expect(blendModes(calls)).not.toContain(mode);
    }
  });

  it("are applied by the colour stage, with one read and one write of the pixels", () => {
    const calls = render({ highlights: 50, shadows: 30, whites: 20, blacks: -20 });
    expect(fullReads(calls)).toHaveLength(1);
    expect(fullWrites(calls)).toHaveLength(1);
  });

  it("share that single read and write with colour bands", () => {
    const calls = render({ shadows: 40, satGreen: 30, satBlue: -20 });
    expect(fullReads(calls)).toHaveLength(1);
    expect(fullWrites(calls)).toHaveLength(1);
  });

  it("cost no pixel pass when every tonal slider is at zero", () => {
    const calls = render({ exposure: 10 });
    expect(fullReads(calls)).toHaveLength(0);
    expect(fullWrites(calls)).toHaveLength(0);
  });

  it("leave the colour-cast layers (temperature and tint) as they were", () => {
    const calls = render({ temperature: 30 });
    expect(fills(calls)).toHaveLength(1);
    expect(blendModes(calls)).toContain("soft-light");
  });
});

describe("tone curves in the render pipeline", () => {
  const bent: CurvesState = {
    rgb: [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.2 },
      { x: 1, y: 1 },
    ],
    luma: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  };

  it("cost no pixel pass while both curves are straight", () => {
    const calls = render({});
    expect(fullReads(calls)).toHaveLength(0);
  });

  it("run in the colour stage, sharing its single read and write with tonal and colour bands", () => {
    const calls = render({ shadows: 30, satGreen: 20 }, bent);
    expect(fullReads(calls)).toHaveLength(1);
    expect(fullWrites(calls)).toHaveLength(1);
  });

  it("alone are enough to trigger the pixel pass", () => {
    const calls = render({}, bent);
    expect(fullReads(calls)).toHaveLength(1);
    expect(fullWrites(calls)).toHaveLength(1);
  });
});
