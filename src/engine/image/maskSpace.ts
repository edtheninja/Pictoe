import type { CropRect, EditState, MaskLayer, MaskStroke } from "@/types/editor";

/**
 * Mask strokes are stored relative to the SOURCE image so they stay attached to the
 * picture when crop, rotation or flip change. These helpers convert between that space
 * and the visible (cropped, rotated, flipped) output frame. Pure maths, no DOM.
 *
 * Conventions: x and y run 0–1 across the width and height of whichever space they are
 * in. Rotation is clockwise in 90° steps (all the crop tool produces); flip is applied
 * before rotation, matching the canvas transform order in renderImage.
 */
export type MaskFrame = {
  srcW: number;
  srcH: number;
  crop: CropRect;
  rotation: number;
  flipH: boolean;
};

type Point = { x: number; y: number };

const quarterTurns = (rotation: number) => ((Math.round(rotation / 90) % 4) + 4) % 4;

export function frameOf(
  srcW: number,
  srcH: number,
  edit: Pick<EditState, "crop" | "rotation" | "flipH">,
): MaskFrame {
  return { srcW, srcH, crop: edit.crop, rotation: edit.rotation, flipH: edit.flipH };
}

/** Size of the image after rotation but before cropping, in source pixels. */
function rotatedSize(f: MaskFrame) {
  return quarterTurns(f.rotation) % 2 === 1 ? { w: f.srcH, h: f.srcW } : { w: f.srcW, h: f.srcH };
}

/** Size of the visible output frame in source pixels (kept equal to outputSize in render.ts by a test). */
export function frameOutputSize(f: MaskFrame) {
  const r = rotatedSize(f);
  return {
    width: Math.max(1, Math.round(r.w * f.crop.width)),
    height: Math.max(1, Math.round(r.h * f.crop.height)),
  };
}

/** A point on the source image → where it appears in the output frame (0–1; may fall outside if cropped away). */
export function sourceToOutput(p: Point, f: MaskFrame): Point {
  const cx = (p.x - 0.5) * f.srcW;
  const cy = (p.y - 0.5) * f.srcH;
  const fx = f.flipH ? -cx : cx;

  let X: number;
  let Y: number;
  switch (quarterTurns(f.rotation)) {
    case 1:
      X = -cy;
      Y = fx;
      break;
    case 2:
      X = -fx;
      Y = -cy;
      break;
    case 3:
      X = cy;
      Y = -fx;
      break;
    default:
      X = fx;
      Y = cy;
  }

  const r = rotatedSize(f);
  const u = X / r.w + 0.5;
  const v = Y / r.h + 0.5;
  return { x: (u - f.crop.x) / f.crop.width, y: (v - f.crop.y) / f.crop.height };
}

/** A point in the visible output frame → the point on the source image underneath it. */
export function outputToSource(p: Point, f: MaskFrame): Point {
  const u = f.crop.x + p.x * f.crop.width;
  const v = f.crop.y + p.y * f.crop.height;
  const r = rotatedSize(f);
  const X = (u - 0.5) * r.w;
  const Y = (v - 0.5) * r.h;

  let fx: number;
  let cy: number;
  switch (quarterTurns(f.rotation)) {
    case 1:
      fx = Y;
      cy = -X;
      break;
    case 2:
      fx = -X;
      cy = -Y;
      break;
    case 3:
      fx = -Y;
      cy = X;
      break;
    default:
      fx = X;
      cy = Y;
  }

  const cx = f.flipH ? -fx : fx;
  return { x: cx / f.srcW + 0.5, y: cy / f.srcH + 0.5 };
}

/** A brush radius measured against the visible frame's shorter side → against the source's shorter side. */
export function radiusToSource(radius: number, f: MaskFrame): number {
  const out = frameOutputSize(f);
  return (radius * Math.min(out.width, out.height)) / Math.min(f.srcW, f.srcH);
}

/** A source-relative radius → pixels in a render that is `scale` × the natural output size. */
export function radiusToPixels(radius: number, f: MaskFrame, scale: number): number {
  return radius * Math.min(f.srcW, f.srcH) * scale;
}

/** Converts a stroke recorded against the visible frame into source space. */
export function strokeToSource(stroke: MaskStroke, f: MaskFrame): MaskStroke {
  const p = outputToSource(stroke, f);
  return { ...stroke, x: p.x, y: p.y, radius: radiusToSource(stroke.radius, f) };
}

/**
 * Sessions saved before masks moved to source space hold strokes relative to the visible
 * frame at the time. Converting with the saved edit is exact unless the crop was changed
 * after painting, which is the case that was already misaligned.
 */
export function migrateLegacyLayers(layers: MaskLayer[], f: MaskFrame): MaskLayer[] {
  return layers.map((layer) =>
    layer.strokes.length === 0
      ? layer
      : { ...layer, strokes: layer.strokes.map((s) => strokeToSource(s, f)) },
  );
}

/** Anything that changes where a source-space stroke lands in the output frame. */
export function maskFrameKey(f: MaskFrame): string {
  return [
    f.srcW,
    f.srcH,
    f.crop.x,
    f.crop.y,
    f.crop.width,
    f.crop.height,
    quarterTurns(f.rotation),
    f.flipH ? 1 : 0,
  ].join("|");
}
