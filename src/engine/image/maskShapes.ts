import type { LinearMaskShape, MaskLayer, MaskShape, RadialMaskShape } from "@/types/editor";
import { sourceToOutput, type MaskFrame } from "./maskSpace";

/**
 * Geometry for gradient masks (linear and radial). Pure maths, no DOM: the renderer turns the
 * numbers returned here into canvas gradients. Shapes are stored relative to the SOURCE image,
 * so every function maps them through the current crop, rotation and flip first.
 */

export const DEFAULT_RADIAL_FEATHER = 30;

/** Largest half-axis a radial mask may have, as a fraction of the source's shorter side. */
export const MAX_RADIAL_RADIUS = 2;

export type Point = { x: number; y: number };

export type LinearPixels = { from: Point; to: Point };

/** Where the gradient starts (full effect) and ends (none), in pixels of a w × h render. */
export function linearToPixels(
  shape: LinearMaskShape,
  frame: MaskFrame,
  w: number,
  h: number,
): LinearPixels {
  const a = sourceToOutput({ x: shape.x1, y: shape.y1 }, frame);
  const b = sourceToOutput({ x: shape.x2, y: shape.y2 }, frame);
  return { from: { x: a.x * w, y: a.y * h }, to: { x: b.x * w, y: b.y * h } };
}

export type RadialPixels = {
  centre: Point;
  /** The x half-axis as a vector in render pixels (its length is the radius). */
  axisX: Point;
  /** The y half-axis as a vector in render pixels. */
  axisY: Point;
  /** Fraction (0-1) of the radius where the effect starts to fade; 1 = a hard edge. */
  innerStop: number;
};

/**
 * The ellipse as a centre and two axis vectors in render pixels. Going through
 * sourceToOutput for the centre and both axis tips means rotation, flip and crop need no
 * special cases here, and `angle` stays an angle on the picture whatever the frame does.
 */
export function radialToPixels(
  shape: RadialMaskShape,
  frame: MaskFrame,
  w: number,
  h: number,
): RadialPixels {
  const shorter = Math.min(frame.srcW, frame.srcH);
  const theta = (shape.angle * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  // Work in source pixels so the axes keep their true lengths and angle, then normalise.
  const cxPx = shape.cx * frame.srcW;
  const cyPx = shape.cy * frame.srcH;
  const tip = (dx: number, dy: number): Point => {
    const o = sourceToOutput({ x: (cxPx + dx) / frame.srcW, y: (cyPx + dy) / frame.srcH }, frame);
    return { x: o.x * w, y: o.y * h };
  };

  const centre = sourceToOutput({ x: shape.cx, y: shape.cy }, frame);
  const c: Point = { x: centre.x * w, y: centre.y * h };
  const tx = tip(ux * shape.rx * shorter, uy * shape.rx * shorter);
  const ty = tip(-uy * shape.ry * shorter, ux * shape.ry * shorter);

  const feather = Math.max(0, Math.min(100, shape.feather));
  return {
    centre: c,
    axisX: { x: tx.x - c.x, y: tx.y - c.y },
    axisY: { x: ty.x - c.x, y: ty.y - c.y },
    innerStop: 1 - feather / 100,
  };
}

/**
 * Mask coverage (0-1) of a gradient shape at a point of the output frame (0-1 across the
 * frame). The renderer draws with canvas gradients; this is the same definition in plain
 * maths so it can be tested, and is what any later hit-testing or thumbnail code should use.
 */
export function shapeCoverage(shape: MaskShape, p: Point, frame: MaskFrame, w: number, h: number) {
  const px = { x: p.x * w, y: p.y * h };

  if (shape.kind === "linear") {
    const { from, to } = linearToPixels(shape, frame, w, h);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return 0;
    const t = ((px.x - from.x) * dx + (px.y - from.y) * dy) / len2;
    return 1 - Math.max(0, Math.min(1, t));
  }

  const { centre, axisX, axisY, innerStop } = radialToPixels(shape, frame, w, h);
  const det = axisX.x * axisY.y - axisX.y * axisY.x;
  if (det === 0) return 0;
  // Solve centre + a·axisX + b·axisY = px for (a, b); the ellipse is a² + b² ≤ 1.
  const rx = px.x - centre.x;
  const ry = px.y - centre.y;
  const a = (rx * axisY.y - ry * axisY.x) / det;
  const b = (axisX.x * ry - axisX.y * rx) / det;
  const d = Math.hypot(a, b);
  if (d >= 1) return 0;
  if (d <= innerStop) return 1;
  return (1 - d) / (1 - innerStop);
}

/** True when the layer is a gradient mask rather than a brush mask. */
export function isShapeLayer(layer: Pick<MaskLayer, "shape">): boolean {
  return layer.shape !== undefined;
}

/** Layers with no effect to render: hidden ones, and brush layers that nothing was painted on
 *  (unless inverted, where "nothing painted" means "everywhere"). */
export function layerHasEffect(layer: MaskLayer): boolean {
  if (layer.visible === false) return false;
  if (layer.shape) return true;
  return layer.strokes.length > 0 || layer.invert === true;
}

/** A new layer's default shape, centred on the picture. */
export function defaultShape(kind: "linear"): LinearMaskShape;
export function defaultShape(kind: "radial"): RadialMaskShape;
export function defaultShape(kind: MaskShape["kind"]): MaskShape;
export function defaultShape(kind: MaskShape["kind"]): MaskShape {
  return kind === "linear"
    ? { kind: "linear", x1: 0.5, y1: 0.25, x2: 0.5, y2: 0.55 }
    : {
        kind: "radial",
        cx: 0.5,
        cy: 0.5,
        rx: 0.3,
        ry: 0.3,
        angle: 0,
        feather: DEFAULT_RADIAL_FEATHER,
      };
}

const MIN_RADIAL_RADIUS = 0.005;
const SHAPE_COORD_MIN = -1;
const SHAPE_COORD_MAX = 2;
/** A linear gradient shorter than this (as a fraction of the picture) has no usable direction. */
const MIN_LINEAR_LENGTH = 1e-6;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const coord = (v: number) => clampTo(v, SHAPE_COORD_MIN, SHAPE_COORD_MAX);

/**
 * Turns anything that claims to be a mask shape into a valid one, or null when it cannot be
 * repaired (unknown kind, a missing or non-numeric position, a linear gradient whose two
 * points coincide). Used for edits coming from the UI and for restoring saved sessions, so
 * both apply the same limits. Positions are kept within a modest margin around the picture,
 * radii within 0.005-2, feather within 0-100 (30 when absent) and the angle within -180 to 180.
 */
export function sanitizeShape(raw: unknown): MaskShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;

  if (s["kind"] === "linear") {
    const { x1, y1, x2, y2 } = s;
    if (!isNum(x1) || !isNum(y1) || !isNum(x2) || !isNum(y2)) return null;
    const shape: LinearMaskShape = {
      kind: "linear",
      x1: coord(x1),
      y1: coord(y1),
      x2: coord(x2),
      y2: coord(y2),
    };
    if (Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < MIN_LINEAR_LENGTH) return null;
    return shape;
  }

  if (s["kind"] === "radial") {
    const { cx, cy, rx, ry } = s;
    if (!isNum(cx) || !isNum(cy) || !isNum(rx) || !isNum(ry)) return null;
    const angle = isNum(s["angle"]) ? s["angle"] : 0;
    return {
      kind: "radial",
      cx: coord(cx),
      cy: coord(cy),
      rx: clampTo(rx, MIN_RADIAL_RADIUS, MAX_RADIAL_RADIUS),
      ry: clampTo(ry, MIN_RADIAL_RADIUS, MAX_RADIAL_RADIUS),
      angle: ((((angle + 180) % 360) + 360) % 360) - 180,
      feather: isNum(s["feather"]) ? clampTo(s["feather"], 0, 100) : DEFAULT_RADIAL_FEATHER,
    };
  }

  return null;
}
