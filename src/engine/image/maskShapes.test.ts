import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT_STATE, type MaskLayer, type MaskShape } from "@/types/editor";
import { frameOf } from "./maskSpace";
import { defaultShape, layerHasEffect, sanitizeShape, shapeCoverage } from "./maskShapes";

const W = 1200;
const H = 800;
const frameFor = (edit: Partial<typeof DEFAULT_EDIT_STATE> = {}) =>
  frameOf(W, H, { ...DEFAULT_EDIT_STATE, ...edit });

/** Coverage at a point of the output frame, for a render of w × h pixels. */
const at = (shape: MaskShape, x: number, y: number, edit = {}, w = W, h = H) =>
  shapeCoverage(shape, { x, y }, frameFor(edit), w, h);

describe("linear gradient coverage", () => {
  const down: MaskShape = { kind: "linear", x1: 0.5, y1: 0.25, x2: 0.5, y2: 0.75 };

  it("is full at the start, none at the end, and fades in a straight line between", () => {
    expect(at(down, 0.3, 0.25)).toBeCloseTo(1, 9);
    expect(at(down, 0.3, 0.5)).toBeCloseTo(0.5, 9);
    expect(at(down, 0.3, 0.75)).toBeCloseTo(0, 9);
    expect(at(down, 0.3, 0.375)).toBeCloseTo(0.75, 9);
  });

  it("stays constant beyond both ends", () => {
    expect(at(down, 0.9, 0)).toBe(1);
    expect(at(down, 0.9, 1)).toBe(0);
  });

  it("does not depend on the position across the gradient", () => {
    expect(at(down, 0.0, 0.5)).toBeCloseTo(at(down, 1.0, 0.5), 9);
  });

  it("follows the picture when it is rotated 90° clockwise (source top becomes the right side)", () => {
    const top: MaskShape = { kind: "linear", x1: 0.5, y1: 0, x2: 0.5, y2: 1 };
    const edit = { rotation: 90 };
    // The output is 800 × 1200 now.
    expect(at(top, 1, 0.5, edit, H, W)).toBeCloseTo(1, 9);
    expect(at(top, 0.5, 0.5, edit, H, W)).toBeCloseTo(0.5, 9);
    expect(at(top, 0, 0.5, edit, H, W)).toBeCloseTo(0, 9);
  });

  it("follows the picture when it is flipped", () => {
    const left: MaskShape = { kind: "linear", x1: 0, y1: 0.5, x2: 1, y2: 0.5 };
    const edit = { flipH: true };
    expect(at(left, 1, 0.3, edit)).toBeCloseTo(1, 9);
    expect(at(left, 0, 0.3, edit)).toBeCloseTo(0, 9);
  });

  it("follows the picture when it is cropped", () => {
    const across: MaskShape = { kind: "linear", x1: 0.5, y1: 0.5, x2: 1, y2: 0.5 };
    const edit = { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
    // The right half is 600 × 800 and the gradient spans exactly that width.
    expect(at(across, 0, 0.5, edit, 600, 800)).toBeCloseTo(1, 9);
    expect(at(across, 0.5, 0.5, edit, 600, 800)).toBeCloseTo(0.5, 9);
    expect(at(across, 1, 0.5, edit, 600, 800)).toBeCloseTo(0, 9);
  });

  it("is unchanged by the preview scale", () => {
    expect(at(down, 0.3, 0.5, {}, 600, 400)).toBeCloseTo(at(down, 0.3, 0.5), 9);
  });
});

describe("radial gradient coverage", () => {
  // Radius 0.25 of the shorter side (800) = 200 px, centred on a 1200 × 800 picture.
  const circle = (feather: number, extra: Partial<Extract<MaskShape, { kind: "radial" }>> = {}) =>
    ({
      kind: "radial",
      cx: 0.5,
      cy: 0.5,
      rx: 0.25,
      ry: 0.25,
      angle: 0,
      feather,
      ...extra,
    }) as MaskShape;
  /** A point `dx`, `dy` pixels from the centre of the 1200 × 800 render. */
  const px = (dx: number, dy: number) => [(600 + dx) / W, (400 + dy) / H] as const;

  it("is full at the centre and none outside the edge", () => {
    expect(at(circle(30), 0.5, 0.5)).toBe(1);
    expect(at(circle(30), ...px(201, 0))).toBe(0);
    expect(at(circle(30), ...px(0, -250))).toBe(0);
  });

  it("has a hard edge at feather 0", () => {
    expect(at(circle(0), ...px(199, 0))).toBe(1);
    expect(at(circle(0), ...px(201, 0))).toBe(0);
  });

  it("fades over the feather width, measured inwards from the edge", () => {
    // Feather 50: solid to half the radius, then a straight fade to the edge.
    expect(at(circle(50), ...px(100, 0))).toBe(1);
    expect(at(circle(50), ...px(150, 0))).toBeCloseTo(0.5, 9);
    expect(at(circle(50), ...px(200 - 1e-9, 0))).toBeCloseTo(0, 6);
    // Feather 100 fades from the centre.
    expect(at(circle(100), ...px(100, 0))).toBeCloseTo(0.5, 9);
  });

  it("is an ellipse when the half-axes differ, turned by `angle`", () => {
    const wide = circle(0, { rx: 0.4, ry: 0.1 }); // 320 px by 80 px
    expect(at(wide, ...px(300, 0))).toBe(1);
    expect(at(wide, ...px(0, 300))).toBe(0);
    expect(at(wide, ...px(0, 70))).toBe(1);

    // 90° clockwise on the picture: the long axis now points down.
    const tall = circle(0, { rx: 0.4, ry: 0.1, angle: 90 });
    expect(at(tall, ...px(0, 300))).toBe(1);
    expect(at(tall, ...px(300, 0))).toBe(0);
  });

  it("follows the picture when it is rotated 90° (a wide ellipse becomes tall)", () => {
    const wide = circle(0, { rx: 0.4, ry: 0.1 });
    const edit = { rotation: 90 };
    // The output is 800 × 1200; its centre is (400, 600).
    expect(at(wide, 0.5, (600 + 300) / 1200, edit, H, W)).toBe(1);
    expect(at(wide, (400 + 300) / 800, 0.5, edit, H, W)).toBe(0);
  });

  it("mirrors the ellipse's angle when the picture is flipped", () => {
    const tilted = circle(0, { rx: 0.4, ry: 0.1, angle: 30 });
    const along = (sign: number) => {
      const d = 200;
      return px(sign * d * Math.cos(Math.PI / 6), d * Math.sin(Math.PI / 6));
    };
    expect(at(tilted, ...along(1))).toBe(1);
    expect(at(tilted, ...along(-1))).toBe(0);
    // Flipped: the long axis now leans the other way.
    expect(at(tilted, ...along(-1), { flipH: true })).toBe(1);
    expect(at(tilted, ...along(1), { flipH: true })).toBe(0);
  });

  it("keeps the same size on the picture when the crop changes", () => {
    const edit = { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
    // The centre of the picture is the left edge of a right-half crop (600 × 800).
    expect(at(circle(0), 0, 0.5, edit, 600, 800)).toBe(1);
    expect(at(circle(0), 190 / 600, 0.5, edit, 600, 800)).toBe(1);
    expect(at(circle(0), 210 / 600, 0.5, edit, 600, 800)).toBe(0);
  });
});

describe("sanitizeShape", () => {
  it("accepts a valid shape unchanged", () => {
    const linear = { kind: "linear", x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 } as const;
    expect(sanitizeShape(linear)).toEqual(linear);
    const radial = { kind: "radial", cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.1, angle: 45, feather: 20 };
    expect(sanitizeShape(radial)).toEqual(radial);
  });

  it("refuses what it cannot repair", () => {
    expect(sanitizeShape(null)).toBeNull();
    expect(sanitizeShape("radial")).toBeNull();
    expect(sanitizeShape({ kind: "spiral" })).toBeNull();
    expect(sanitizeShape({ kind: "linear", x1: 0, y1: 0, x2: "1", y2: 1 })).toBeNull();
    expect(sanitizeShape({ kind: "linear", x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 })).toBeNull();
    expect(sanitizeShape({ kind: "radial", cx: NaN, cy: 0, rx: 0.1, ry: 0.1 })).toBeNull();
    expect(sanitizeShape({ kind: "radial", cx: 0.5, cy: 0.5, rx: 0.1 })).toBeNull();
  });

  it("clamps positions, radii and feather, fills a missing feather and angle", () => {
    const r = sanitizeShape({ kind: "radial", cx: 9, cy: -9, rx: 0, ry: 50, feather: 400 });
    expect(r).toEqual({
      kind: "radial",
      cx: 2,
      cy: -1,
      rx: 0.005,
      ry: 2,
      angle: 0,
      feather: 100,
    });
    const d = sanitizeShape({ kind: "radial", cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 }) as {
      feather: number;
    };
    expect(d.feather).toBe(30);
    expect(sanitizeShape({ kind: "linear", x1: -5, y1: 0, x2: 5, y2: 1 })).toMatchObject({
      x1: -1,
      x2: 2,
    });
  });

  it("brings the angle into -180 to 180", () => {
    const angle = (a: number) =>
      (
        sanitizeShape({ kind: "radial", cx: 0, cy: 0, rx: 0.1, ry: 0.1, angle: a }) as {
          angle: number;
        }
      ).angle;
    expect(angle(270)).toBe(-90);
    expect(angle(190)).toBe(-170);
    expect(angle(-90)).toBe(-90);
    expect(angle(720)).toBe(0);
  });

  it("returns shapes the default constructors produce unchanged", () => {
    expect(sanitizeShape(defaultShape("linear"))).toEqual(defaultShape("linear"));
    expect(sanitizeShape(defaultShape("radial"))).toEqual(defaultShape("radial"));
  });
});

describe("layerHasEffect", () => {
  const base: MaskLayer = {
    id: "a",
    name: "A",
    strokes: [],
    adjustments: { exposure: 10, contrast: 0, saturation: 0, temperature: 0 },
  };

  it("is false for an empty brush layer, true once something is painted", () => {
    expect(layerHasEffect(base)).toBe(false);
    expect(layerHasEffect({ ...base, strokes: [{ x: 0.5, y: 0.5, radius: 0.05 }] })).toBe(true);
  });

  it("treats an empty inverted brush layer as covering everything", () => {
    expect(layerHasEffect({ ...base, invert: true })).toBe(true);
  });

  it("is true for a gradient layer, and false for any hidden layer", () => {
    expect(layerHasEffect({ ...base, shape: defaultShape("radial") })).toBe(true);
    expect(layerHasEffect({ ...base, shape: defaultShape("radial"), visible: false })).toBe(false);
    expect(
      layerHasEffect({ ...base, strokes: [{ x: 0.5, y: 0.5, radius: 0.05 }], visible: false }),
    ).toBe(false);
  });
});
