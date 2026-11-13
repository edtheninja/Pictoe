import type { MaskLayer, MaskShape } from "@/types/editor";
import {
  frameOutputSize,
  outputToSource,
  radiusToPixels,
  sourceToOutput,
  type MaskFrame,
} from "./maskSpace";
import { linearToPixels, radialToPixels, sanitizeShape, shapeCoverage } from "./maskShapes";

/**
 * Handles for editing gradient masks on the photo, and the thumbnail raster for the layer list.
 * Pure maths, no DOM. Handle positions are fractions (0-1) of the VISIBLE output frame, which is
 * what the overlay lays out in; shapes themselves stay in source space, so a drag converts the
 * pointer back through outputToSource and crop, rotation and flip need no special cases.
 */

export type HandleId = "start" | "end" | "centre" | "radiusX" | "radiusY" | "feather";

export type Handle = { id: HandleId; x: number; y: number };

type Point = { x: number; y: number };

/** The feather handle sits on the far side of the ellipse from the x-radius handle, and is
 *  kept clear of the centre and the edge so it never hides under another handle. */
const FEATHER_HANDLE_MIN = 0.12;
const FEATHER_HANDLE_MAX = 0.88;
const MIN_VECTOR = 1e-9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Handles of a shape, in output-frame fractions. */
export function handlesOf(shape: MaskShape, frame: MaskFrame): Handle[] {
  if (shape.kind === "linear") {
    const { from, to } = linearToPixels(shape, frame, 1, 1);
    return [
      { id: "start", ...from },
      { id: "end", ...to },
    ];
  }

  const { centre, axisX, axisY, innerStop } = radialToPixels(shape, frame, 1, 1);
  const f = clamp(innerStop, FEATHER_HANDLE_MIN, FEATHER_HANDLE_MAX);
  return [
    { id: "centre", ...centre },
    { id: "radiusX", x: centre.x + axisX.x, y: centre.y + axisX.y },
    { id: "radiusY", x: centre.x + axisY.x, y: centre.y + axisY.y },
    { id: "feather", x: centre.x - axisX.x * f, y: centre.y - axisX.y * f },
  ];
}

/**
 * The shape after a handle is dragged to `to` (output-frame fractions). Returns the shape
 * unchanged when the result would be unusable (for example both linear points on one spot),
 * and always returns a sanitised shape, the same limits the reducer applies.
 */
export function dragHandle(shape: MaskShape, id: HandleId, to: Point, frame: MaskFrame): MaskShape {
  const src = outputToSource(to, frame);

  if (shape.kind === "linear") {
    const next =
      id === "start"
        ? { ...shape, x1: src.x, y1: src.y }
        : id === "end"
          ? { ...shape, x2: src.x, y2: src.y }
          : shape;
    return sanitizeShape(next) ?? shape;
  }

  const shorter = Math.min(frame.srcW, frame.srcH);
  // The pointer relative to the centre, in source pixels.
  const vx = (src.x - shape.cx) * frame.srcW;
  const vy = (src.y - shape.cy) * frame.srcH;
  const theta = (shape.angle * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  let next: MaskShape = shape;
  switch (id) {
    case "centre":
      next = { ...shape, cx: src.x, cy: src.y };
      break;
    case "radiusX": {
      const len = Math.hypot(vx, vy);
      // Right on the centre there is no direction: keep the angle, only shrink.
      next =
        len < MIN_VECTOR
          ? { ...shape, rx: 0 }
          : { ...shape, rx: len / shorter, angle: (Math.atan2(vy, vx) * 180) / Math.PI };
      break;
    }
    case "radiusY":
      next = { ...shape, ry: Math.abs(vx * -uy + vy * ux) / shorter };
      break;
    case "feather": {
      // Distance along the x axis towards the feather side, as a share of the x radius.
      const d = -(vx * ux + vy * uy) / (shape.rx * shorter);
      next = { ...shape, feather: (1 - d) * 100 };
      break;
    }
    default:
      break;
  }
  return sanitizeShape(next) ?? shape;
}

/** Moves a handle by (dx, dy) output-frame fractions from where it is now (keyboard nudges). */
export function nudgeHandle(
  shape: MaskShape,
  id: HandleId,
  dx: number,
  dy: number,
  frame: MaskFrame,
): MaskShape {
  const at = handlesOf(shape, frame).find((h) => h.id === id);
  if (!at) return shape;
  return dragHandle(shape, id, { x: at.x + dx, y: at.y + dy }, frame);
}

export type Segment = { a: Point; b: Point };

/**
 * Guide lines for a linear gradient: a line through each end point, perpendicular to the
 * gradient, drawn in output-frame fractions. "Perpendicular" is judged in pixels, not in
 * fractions, so it stays square on a wide or tall frame.
 */
export function linearGuides(
  shape: Extract<MaskShape, { kind: "linear" }>,
  frame: MaskFrame,
): Segment[] {
  const { width: w, height: h } = frameOutputSize(frame);
  const { from, to } = linearToPixels(shape, frame, w, h);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  // A perpendicular long enough to cross the whole frame from any point inside it.
  const reach = Math.hypot(w, h);
  const px = (-dy / len) * reach;
  const py = (dx / len) * reach;
  const line = (p: Point): Segment => ({
    a: { x: (p.x - px) / w, y: (p.y - py) / h },
    b: { x: (p.x + px) / w, y: (p.y + py) / h },
  });
  return [line(from), line(to)];
}

/** Points around a radial mask's edge, in output-frame fractions (a closed outline). */
export function radialOutline(
  shape: Extract<MaskShape, { kind: "radial" }>,
  frame: MaskFrame,
  steps = 72,
): Point[] {
  const { centre, axisX, axisY } = radialToPixels(shape, frame, 1, 1);
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push({
      x: centre.x + axisX.x * c + axisY.x * s,
      y: centre.y + axisX.y * c + axisY.y * s,
    });
  }
  return points;
}

// ---- Thumbnails -----------------------------------------------------------------------

/** Brush coverage (0-1) at distance `d` from a stroke centre, as a share of its radius. */
function brushFalloff(d: number, softness: number): number {
  if (d >= 1) return 0;
  const inner = 1 - clamp(softness, 0, 100) / 100;
  if (d <= inner) return 1;
  return (1 - d) / (1 - inner);
}

/**
 * Coverage of a layer over the visible frame, as a w × h raster of 0-255, for the layer-list
 * thumbnail. It follows the same definitions as the renderer (brush strokes composited in
 * order, erase removing, gradients from `shapeCoverage`, invert flipping the result) but is a
 * small approximation, not the exact render. A hidden layer still shows its shape: the
 * thumbnail says what the layer covers, and the eye icon says whether it is on.
 */
export function maskThumbnail(layer: MaskLayer, frame: MaskFrame, w: number, h: number) {
  const out = new Uint8ClampedArray(w * h);
  const { width: outW, height: outH } = frameOutputSize(frame);

  if (layer.shape) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = shapeCoverage(
          layer.shape,
          { x: (i + 0.5) / w, y: (j + 0.5) / h },
          frame,
          outW,
          outH,
        );
        out[j * w + i] = Math.round(c * 255);
      }
    }
  } else {
    const alpha = new Float32Array(w * h);
    for (const stroke of layer.strokes) {
      const at = sourceToOutput(stroke, frame);
      const cx = at.x * w;
      const cy = at.y * h;
      // The radius in thumbnail pixels along each axis (the frame is not square).
      const rPx = radiusToPixels(stroke.radius, frame, 1);
      const rx = (rPx / outW) * w;
      const ry = (rPx / outH) * h;
      if (rx <= 0 || ry <= 0) continue;
      const soft = stroke.softness ?? 30;
      const erase = stroke.mode === "erase";
      const i0 = Math.max(0, Math.floor(cx - rx));
      const i1 = Math.min(w - 1, Math.ceil(cx + rx));
      const j0 = Math.max(0, Math.floor(cy - ry));
      const j1 = Math.min(h - 1, Math.ceil(cy + ry));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot((i + 0.5 - cx) / rx, (j + 0.5 - cy) / ry);
          const c = brushFalloff(d, soft);
          if (c === 0) continue;
          const k = j * w + i;
          alpha[k] = erase ? alpha[k]! * (1 - c) : alpha[k]! + c * (1 - alpha[k]!);
        }
      }
    }
    for (let k = 0; k < alpha.length; k++) out[k] = Math.round(alpha[k]! * 255);
  }

  if (layer.invert) for (let k = 0; k < out.length; k++) out[k] = 255 - out[k]!;
  return out;
}
