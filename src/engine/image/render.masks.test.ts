import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import { DEFAULT_EDIT_STATE, type EditState, type MaskLayer } from "@/types/editor";

/**
 * These tests run the real renderImage with a fake canvas that records every call, then
 * check where the mask brush circle is drawn. That exercises the wiring between the
 * source-space strokes, the crop/rotation/flip, the preview scale and the mask cache.
 */
type Call = { name: string; args: unknown[] };
type FakeCanvas = { width: number; height: number; calls: Call[]; getContext: () => unknown };

function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, prop: string) =>
      (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return prop === "createRadialGradient" ? { addColorStop() {} } : undefined;
      },
    set: () => true,
  });
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

let made: FakeCanvas[] = [];

beforeEach(() => {
  made = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const c = fakeCanvas();
      made.push(c);
      return c;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const SRC_W = 1200;
const SRC_H = 800;

const layer = (id: string, x: number, y: number): MaskLayer => ({
  id,
  name: id,
  strokes: [{ x, y, radius: 0.05 }],
  adjustments: { exposure: 10, contrast: 0, saturation: 0, temperature: 0 },
});

/** Renders and returns the [cx, cy, radius] of the brush circle that was drawn. */
function brushCircle(edit: EditState, mask: MaskLayer, maxDimension?: number) {
  made = [];
  const target = fakeCanvas();
  renderImage({} as CanvasImageSource, SRC_W, SRC_H, edit, target as never, maxDimension, [mask]);
  const arc = made.flatMap((c) => c.calls).find((c) => c.name === "arc");
  return arc ? (arc.args.slice(0, 3) as number[]) : null;
}

describe("mask brush placement in the real renderer", () => {
  it("draws at the stroke's position on an unedited image", () => {
    const [cx, cy, r] = brushCircle(DEFAULT_EDIT_STATE, layer("plain", 0.25, 0.75))!;
    expect(cx).toBeCloseTo(300, 6); // 0.25 × 1200
    expect(cy).toBeCloseTo(600, 6); // 0.75 × 800
    expect(r).toBeCloseTo(40, 6); // 0.05 × shorter side (800)
  });

  it("follows the picture when the image is rotated 90°", () => {
    const edit = { ...DEFAULT_EDIT_STATE, rotation: 90 };
    // Left edge, halfway down → top, centred. The output is now 800 × 1200.
    const [cx, cy, r] = brushCircle(edit, layer("rot", 0.1, 0.5))!;
    expect(cx).toBeCloseTo(400, 6); // 0.5 × 800
    expect(cy).toBeCloseTo(120, 6); // 0.1 × 1200
    expect(r).toBeCloseTo(40, 6); // same size on the picture
  });

  it("follows the picture when the image is flipped", () => {
    const edit = { ...DEFAULT_EDIT_STATE, flipH: true };
    const [cx, cy] = brushCircle(edit, layer("flip", 0.2, 0.3))!;
    expect(cx).toBeCloseTo(960, 6); // (1 − 0.2) × 1200
    expect(cy).toBeCloseTo(240, 6);
  });

  it("follows the picture when the crop changes", () => {
    const edit = { ...DEFAULT_EDIT_STATE, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
    // The centre of the picture sits on the left edge of a right-half crop (600 × 800).
    const [cx, cy, r] = brushCircle(edit, layer("crop", 0.5, 0.5))!;
    expect(cx).toBeCloseTo(0, 6);
    expect(cy).toBeCloseTo(400, 6);
    expect(r).toBeCloseTo(40, 6);
  });

  it("scales position and brush size down together for a smaller preview", () => {
    const [cx, cy, r] = brushCircle(DEFAULT_EDIT_STATE, layer("preview", 0.25, 0.75), 600)!;
    expect(cx).toBeCloseTo(150, 6); // preview is half size: 600 × 400
    expect(cy).toBeCloseTo(300, 6);
    expect(r).toBeCloseTo(20, 6);
  });

  it("redraws a cached preview mask when the crop changes afterwards", () => {
    const mask = layer("cached", 0.5, 0.5);
    const first = brushCircle(DEFAULT_EDIT_STATE, mask, 600)!;
    expect(first[0]).toBeCloseTo(300, 6); // centre of a 600 × 400 preview

    const cropped = { ...DEFAULT_EDIT_STATE, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
    const second = brushCircle(cropped, mask, 600);
    // A stale cache would draw nothing here (null) or draw in the old place.
    expect(second).not.toBeNull();
    expect(second![0]).toBeCloseTo(0, 6);
  });
});
