import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDIT_STATE,
  type LinearMaskShape,
  type MaskLayer,
  type MaskShape,
  type RadialMaskShape,
} from "@/types/editor";
import { frameOf, frameOutputSize } from "./maskSpace";
import { shapeCoverage } from "./maskShapes";
import {
  dragHandle,
  handlesOf,
  linearGuides,
  maskThumbnail,
  nudgeHandle,
  radialOutline,
  type HandleId,
} from "./maskHandles";

const W = 1200;
const H = 800;
const frameFor = (edit: Partial<typeof DEFAULT_EDIT_STATE> = {}) =>
  frameOf(W, H, { ...DEFAULT_EDIT_STATE, ...edit });
const plain = frameFor();

// Every combination of the transforms a mask has to follow.
const FRAMES = [
  ["identity", {}],
  ["rotated 90", { rotation: 90 }],
  ["rotated 270 and flipped", { rotation: 270, flipH: true }],
  ["cropped", { crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 } }],
  [
    "cropped, rotated 180, flipped",
    { rotation: 180, flipH: true, crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } },
  ],
] as const;

const linear: LinearMaskShape = { kind: "linear", x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 };
const radial: RadialMaskShape = {
  kind: "radial",
  cx: 0.5,
  cy: 0.5,
  rx: 0.3,
  ry: 0.15,
  angle: 30,
  feather: 40,
};

const pos = (shape: MaskShape, id: HandleId, frame = plain) =>
  handlesOf(shape, frame).find((h) => h.id === id)!;

describe("handlesOf", () => {
  it("places the two linear handles at the start and end points", () => {
    const [start, end] = handlesOf({ kind: "linear", x1: 0.25, y1: 0.5, x2: 0.75, y2: 0.5 }, plain);
    expect(start).toMatchObject({ id: "start", x: 0.25, y: 0.5 });
    expect(end).toMatchObject({ id: "end", x: 0.75, y: 0.5 });
  });

  it("puts the radial handles on the centre, the x radius, the y radius and the feather side", () => {
    const shape: RadialMaskShape = { ...radial, angle: 0, rx: 0.2, ry: 0.1, feather: 50 };
    const shorter = Math.min(W, H);
    expect(pos(shape, "centre")).toMatchObject({ x: 0.5, y: 0.5 });
    expect(pos(shape, "radiusX").x).toBeCloseTo(0.5 + (0.2 * shorter) / W, 9);
    expect(pos(shape, "radiusX").y).toBeCloseTo(0.5, 9);
    expect(pos(shape, "radiusY").x).toBeCloseTo(0.5, 9);
    expect(pos(shape, "radiusY").y).toBeCloseTo(0.5 + (0.1 * shorter) / H, 9);
    // The feather handle is opposite the x-radius handle, half way out for feather 50.
    expect(pos(shape, "feather").x).toBeCloseTo(0.5 - (0.2 * shorter * 0.5) / W, 9);
  });

  it("keeps the feather handle clear of the centre and the edge at both extremes", () => {
    const hard = pos({ ...radial, feather: 0 }, "feather");
    const soft = pos({ ...radial, feather: 100 }, "feather");
    const centre = pos(radial, "centre");
    const edge = pos(radial, "radiusX");
    const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
    expect(gap(hard, edge)).toBeGreaterThan(20);
    expect(gap(soft, centre)).toBeGreaterThan(20);
  });
});

describe.each(FRAMES)("dragHandle in a %s frame", (_name, edit) => {
  const frame = frameFor(edit);

  it.each([
    ["linear", linear, ["start", "end"]],
    ["radial", radial, ["centre", "radiusX", "radiusY", "feather"]],
  ] as const)("dropping a %s handle where it already is changes nothing", (_k, shape, ids) => {
    for (const id of ids) {
      const h = pos(shape, id, frame);
      const next = dragHandle(shape, id, { x: h.x, y: h.y }, frame);
      for (const [key, value] of Object.entries(shape)) {
        if (typeof value === "number") {
          expect((next as unknown as Record<string, number>)[key]).toBeCloseTo(value, 6);
        }
      }
    }
  });

  it("a dragged handle ends up under the pointer", () => {
    for (const [shape, id, to] of [
      [linear, "start", { x: 0.3, y: 0.4 }],
      [linear, "end", { x: 0.8, y: 0.6 }],
      [radial, "centre", { x: 0.45, y: 0.55 }],
    ] as const) {
      const next = dragHandle(shape, id, to, frame);
      const h = pos(next, id, frame);
      expect(h.x).toBeCloseTo(to.x, 6);
      expect(h.y).toBeCloseTo(to.y, 6);
    }
  });
});

describe("dragHandle (radial)", () => {
  it("the x-radius handle sets both the x radius and the angle", () => {
    const shape: RadialMaskShape = { ...radial, angle: 0, rx: 0.2 };
    const shorter = Math.min(W, H);
    // Straight down from the centre by 0.25 of the shorter side.
    const to = { x: 0.5, y: 0.5 + (0.25 * shorter) / H };
    const next = dragHandle(shape, "radiusX", to, plain) as RadialMaskShape;
    expect(next.rx).toBeCloseTo(0.25, 6);
    expect(next.angle).toBeCloseTo(90, 6);
    expect(next.ry).toBe(shape.ry);
  });

  it("the y-radius handle changes only the y radius", () => {
    const shape: RadialMaskShape = { ...radial, angle: 0, rx: 0.2, ry: 0.1 };
    const shorter = Math.min(W, H);
    const next = dragHandle(
      shape,
      "radiusY",
      { x: 0.5, y: 0.5 + (0.3 * shorter) / H },
      plain,
    ) as RadialMaskShape;
    expect(next.ry).toBeCloseTo(0.3, 6);
    expect(next.rx).toBe(0.2);
    expect(next.angle).toBe(0);
  });

  it("the feather handle sets the feather from how far in it is, clamped to 0-100", () => {
    const shape: RadialMaskShape = { ...radial, angle: 0, rx: 0.3, feather: 10 };
    const shorter = Math.min(W, H);
    const reach = (frac: number) => ({ x: 0.5 - (frac * 0.3 * shorter) / W, y: 0.5 });
    expect(
      (dragHandle(shape, "feather", reach(0.25), plain) as RadialMaskShape).feather,
    ).toBeCloseTo(75, 6);
    expect((dragHandle(shape, "feather", reach(3), plain) as RadialMaskShape).feather).toBe(0);
    expect(
      (dragHandle(shape, "feather", { x: 0.9, y: 0.5 }, plain) as RadialMaskShape).feather,
    ).toBe(100);
  });

  it("dragging the x-radius handle onto the centre keeps the angle and gives the smallest radius", () => {
    const next = dragHandle(radial, "radiusX", { x: 0.5, y: 0.5 }, plain) as RadialMaskShape;
    expect(next.angle).toBeCloseTo(radial.angle, 9);
    expect(next.rx).toBeGreaterThan(0);
    expect(next.rx).toBeLessThan(0.01);
  });

  it("keeps the radii within the limits the reducer applies", () => {
    const huge = dragHandle(radial, "radiusX", { x: 40, y: 0.5 }, plain) as RadialMaskShape;
    expect(huge.rx).toBe(2);
  });
});

describe("dragHandle (linear)", () => {
  it("refuses to put both points on one spot and returns the shape unchanged", () => {
    expect(dragHandle(linear, "end", { x: linear.x1, y: linear.y1 }, plain)).toEqual(linear);
  });

  it("ignores a handle id the shape does not have", () => {
    expect(dragHandle(linear, "centre", { x: 0.1, y: 0.1 }, plain)).toEqual(linear);
  });
});

describe("nudgeHandle", () => {
  it.each(FRAMES)("moves a handle by the given fraction of the visible frame (%s)", (_n, edit) => {
    const frame = frameFor(edit);
    const before = pos(linear, "end", frame);
    const next = nudgeHandle(linear, "end", 0.02, -0.01, frame);
    const after = pos(next, "end", frame);
    expect(after.x - before.x).toBeCloseTo(0.02, 6);
    expect(after.y - before.y).toBeCloseTo(-0.01, 6);
  });

  it("returns the shape for a handle it does not have", () => {
    expect(nudgeHandle(linear, "feather", 0.1, 0.1, plain)).toBe(linear);
  });
});

describe("guides", () => {
  it("draws linear guide lines perpendicular to the gradient, judged in pixels", () => {
    const shape: LinearMaskShape = { kind: "linear", x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.8 };
    const { height } = frameOutputSize(plain);
    for (const g of linearGuides(shape, plain)) {
      // The gradient runs straight down, so the guides must be level.
      expect(g.a.y * height).toBeCloseTo(g.b.y * height, 6);
      expect(Math.min(g.a.x, g.b.x)).toBeLessThan(0);
      expect(Math.max(g.a.x, g.b.x)).toBeGreaterThan(1);
    }
  });

  it("stays perpendicular on a slanted gradient in a wide frame", () => {
    const { width: w, height: h } = frameOutputSize(plain);
    const [g] = linearGuides(linear, plain);
    const gx = (linear.x2 - linear.x1) * w;
    const gy = (linear.y2 - linear.y1) * h;
    const lx = (g!.b.x - g!.a.x) * w;
    const ly = (g!.b.y - g!.a.y) * h;
    expect(gx * lx + gy * ly).toBeCloseTo(0, 4);
  });

  it("outlines a radial mask where its coverage reaches zero", () => {
    const { width: w, height: h } = frameOutputSize(plain);
    for (const p of radialOutline(radial, plain, 24)) {
      expect(shapeCoverage(radial, p, plain, w, h)).toBeCloseTo(0, 6);
    }
  });
});

describe("maskThumbnail", () => {
  const layer = (patch: Partial<MaskLayer>): MaskLayer => ({
    id: "a",
    name: "A",
    strokes: [],
    adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 },
    ...patch,
  });
  const TW = 30;
  const TH = 20;
  const px = (out: Uint8ClampedArray, x: number, y: number) =>
    out[Math.floor(y * TH) * TW + Math.floor(x * TW)]!;

  it("draws a gradient layer from the same coverage maths as the renderer", () => {
    const shape: MaskShape = { kind: "linear", x1: 0.5, y1: 0, x2: 0.5, y2: 1 };
    const out = maskThumbnail(layer({ shape }), plain, TW, TH);
    expect(px(out, 0.5, 0.02)).toBeGreaterThan(240);
    expect(px(out, 0.5, 0.98)).toBeLessThan(15);
    expect(px(out, 0.1, 0.5)).toBeGreaterThan(100);
    expect(px(out, 0.1, 0.5)).toBeLessThan(155);
  });

  it("shows a painted stroke, and an erase stroke on top removes it", () => {
    const paint = { x: 0.5, y: 0.5, radius: 0.2, softness: 0, mode: "paint" as const };
    const painted = maskThumbnail(layer({ strokes: [paint] }), plain, TW, TH);
    expect(px(painted, 0.5, 0.5)).toBe(255);
    expect(px(painted, 0.02, 0.02)).toBe(0);

    const erased = maskThumbnail(
      layer({ strokes: [paint, { ...paint, mode: "erase" }] }),
      plain,
      TW,
      TH,
    );
    expect(px(erased, 0.5, 0.5)).toBe(0);
  });

  it("is empty for an unpainted brush layer and full when that layer is inverted", () => {
    expect(Math.max(...maskThumbnail(layer({}), plain, TW, TH))).toBe(0);
    expect(Math.min(...maskThumbnail(layer({ invert: true }), plain, TW, TH))).toBe(255);
  });

  it("inverts a gradient", () => {
    const shape: MaskShape = { kind: "linear", x1: 0.5, y1: 0, x2: 0.5, y2: 1 };
    const out = maskThumbnail(layer({ shape, invert: true }), plain, TW, TH);
    expect(px(out, 0.5, 0.02)).toBeLessThan(15);
    expect(px(out, 0.5, 0.98)).toBeGreaterThan(240);
  });

  it("follows the frame: a stroke at the source's top-left lands top-right after a 90 degree turn", () => {
    const stroke = { x: 0.1, y: 0.1, radius: 0.08, softness: 0, mode: "paint" as const };
    const turned = maskThumbnail(layer({ strokes: [stroke] }), frameFor({ rotation: 90 }), TH, TW);
    // Rotated frame is portrait, so the raster is TH wide and TW tall.
    const at = (x: number, y: number) => turned[Math.floor(y * TW) * TH + Math.floor(x * TH)]!;
    expect(at(0.9, 0.1)).toBe(255);
    expect(at(0.1, 0.1)).toBe(0);
  });

  it("does not let a hidden layer change what its thumbnail shows", () => {
    const shape: MaskShape = {
      kind: "radial",
      cx: 0.5,
      cy: 0.5,
      rx: 0.3,
      ry: 0.3,
      angle: 0,
      feather: 0,
    };
    expect(maskThumbnail(layer({ shape, visible: false }), plain, TW, TH)).toEqual(
      maskThumbnail(layer({ shape }), plain, TW, TH),
    );
  });
});
