import type { EditState, MaskLayer, Adjustments, CurvesState } from "@/types/editor";
import type { MaskShape, MaskStroke } from "@/types/editor";
import {
  applyFilterFallback,
  filterString,
  NO_FILTER,
  supportsCanvasFilter,
  type FilterParams,
} from "./canvasFilter";
import { createCanvas, get2dContext, type AnyCanvas, type AnyCtx2D } from "./canvasFactory";
import { applyColorStage, planColorStage } from "./colorStage";
import { exportWithFallback, type ExportResult } from "./exportFallback";
import { healedSource } from "./healedSource";
import { MaskCache } from "./maskCache";
import { buildLocalFilterParams, localStageAdjustments } from "./localAdjustments";
import { layerHasEffect, linearToPixels, radialToPixels } from "./maskShapes";
import { timed } from "./profile";
import {
  frameOf,
  frameOutputSize,
  maskFrameKey,
  radiusToPixels,
  sourceToOutput,
  type MaskFrame,
} from "./maskSpace";

/**
 * Pure rendering engine. Knows nothing about React.
 * The same pipeline drives the interactive preview (downscaled) and the
 * final export (full resolution), so what you see is what you get.
 */

export type RenderTarget = HTMLCanvasElement | OffscreenCanvas;

type Ctx2D = AnyCtx2D;

/** Size of the output for a given edit state and source dimensions. */
export function outputSize(srcW: number, srcH: number, edit: EditState) {
  const swap =
    ((edit.rotation % 360) + 360) % 360 === 90 || ((edit.rotation % 360) + 360) % 360 === 270;
  const baseW = swap ? srcH : srcW;
  const baseH = swap ? srcW : srcH;
  return {
    width: Math.max(1, Math.round(baseW * edit.crop.width)),
    height: Math.max(1, Math.round(baseH * edit.crop.height)),
  };
}

function buildFilterParams(a: Adjustments, scale: number): FilterParams {
  const brightness = 1 + (a.exposure / 100) * 0.55 + (a.brightness / 100) * 0.4;
  const contrast = 1 + (a.contrast / 100) * 0.6 + (a.clarity / 100) * 0.25;
  const saturate = Math.max(0, 1 + a.saturation / 100 + (a.vibrance / 100) * 0.5);
  return {
    brightness: clamp(brightness, 0.05, 4),
    contrast: clamp(contrast, 0.05, 4),
    saturate,
    blurPx: (a.blur / 100) * 24 * scale,
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function clampByte(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Real unsharp-mask sharpening: blur a copy of the current canvas, then push
 * each pixel away from its blurred neighbor. Operates on whatever's already
 * been drawn, so it runs after the base image and tone layers are composited.
 */
function sharpen(ctx: Ctx2D, target: RenderTarget, w: number, h: number, amount: number) {
  if (amount <= 0) return;

  const original = ctx.getImageData(0, 0, w, h);

  const blurCtx = get2dContext(createCanvas(w, h));
  if (!blurCtx) return;

  const radius = 1 + (amount / 100) * 3;
  const nativeBlur = supportsCanvasFilter();
  if (nativeBlur) blurCtx.filter = `blur(${radius.toFixed(2)}px)`;
  blurCtx.drawImage(target as CanvasImageSource, 0, 0, w, h);
  if (!nativeBlur) applyFilterFallback(blurCtx, w, h, { ...NO_FILTER, blurPx: radius });
  const blurred = blurCtx.getImageData(0, 0, w, h);

  const strength = (amount / 100) * 1.4;
  const o = original.data;
  const b = blurred.data;
  for (let i = 0; i < o.length; i += 4) {
    o[i] = clampByte(o[i]! + strength * (o[i]! - b[i]!));
    o[i + 1] = clampByte(o[i + 1]! + strength * (o[i + 1]! - b[i + 1]!));
    o[i + 2] = clampByte(o[i + 2]! + strength * (o[i + 2]! - b[i + 2]!));
  }

  ctx.putImageData(original, 0, 0);
}

function tone(ctx: Ctx2D, w: number, h: number, a: Adjustments) {
  const layer = (color: string, alpha: number, mode: GlobalCompositeOperation) => {
    if (alpha <= 0.001) return;
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };

  // Highlights, shadows, whites and blacks are luminosity-weighted and live in the colour stage
  // (tonal.ts); only the colour casts below are still blend layers.
  layer("#ff9a3c", (Math.max(0, a.temperature) / 100) * 0.35, "soft-light");
  layer("#3ca5ff", (Math.max(0, -a.temperature) / 100) * 0.35, "soft-light");
  layer("#ff3cf0", (Math.max(0, a.tint) / 100) * 0.25, "soft-light");
  layer("#54ff3c", (Math.max(0, -a.tint) / 100) * 0.25, "soft-light");
}

/** All per-pixel colour work in one read and one write; skipped entirely when nothing is active. */
function applyColorStagePass(
  ctx: Ctx2D,
  w: number,
  h: number,
  a: Adjustments,
  curves?: CurvesState,
) {
  const plan = planColorStage(a, curves);
  if (!plan) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  applyColorStage(imageData.data, plan);
  ctx.putImageData(imageData, 0, 0);
}

function createMaskCanvas(w: number, h: number): AnyCanvas {
  return createCanvas(w, h);
}

/** Draws brush strokes (normalized to the output frame) onto a mask canvas.
 *  Strokes are composited in order, so drawing only new strokes onto an
 *  existing canvas gives the same result as redrawing all of them. */
function drawMaskStrokes(
  canvas: AnyCanvas,
  w: number,
  h: number,
  strokes: readonly MaskStroke[],
  frame: MaskFrame,
) {
  const mctx = get2dContext(canvas)!;
  const scale = w / frameOutputSize(frame).width;

  for (const stroke of strokes) {
    const p = sourceToOutput(stroke, frame);
    const cx = p.x * w;
    const cy = p.y * h;
    const r = radiusToPixels(stroke.radius, frame, scale);

    const softness = Math.max(0, Math.min(100, stroke.softness ?? 30));

    mctx.save();

    mctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";

    if (softness === 0) {
      mctx.fillStyle = "rgba(255,255,255,1)";
    } else {
      const grad = mctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const innerStop = 1 - softness / 100;

      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(innerStop, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");

      mctx.fillStyle = grad;
    }

    mctx.beginPath();
    mctx.arc(cx, cy, r, 0, Math.PI * 2);
    mctx.fill();

    mctx.restore();
  }
}

/** Draws a gradient mask (white, fading to transparent) filling the whole canvas.
 *  Cheap enough (one gradient fill) that it is redrawn every render, not cached. */
function drawMaskShape(
  canvas: AnyCanvas,
  w: number,
  h: number,
  shape: MaskShape,
  frame: MaskFrame,
) {
  const mctx = get2dContext(canvas)!;

  if (shape.kind === "linear") {
    const { from, to } = linearToPixels(shape, frame, w, h);
    const grad = mctx.createLinearGradient(from.x, from.y, to.x, to.y);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    mctx.fillStyle = grad;
    mctx.fillRect(0, 0, w, h);
    return;
  }

  const { centre, axisX, axisY, innerStop } = radialToPixels(shape, frame, w, h);
  mctx.save();
  // Draw a unit circle, then let the transform stretch it into the ellipse (any rotation or
  // flip is already in the axis vectors).
  mctx.setTransform(axisX.x, axisX.y, axisY.x, axisY.y, centre.x, centre.y);
  if (innerStop >= 1) {
    mctx.fillStyle = "rgba(255,255,255,1)";
  } else {
    const grad = mctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(innerStop, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    mctx.fillStyle = grad;
  }
  mctx.beginPath();
  mctx.arc(0, 0, 1, 0, Math.PI * 2);
  mctx.fill();
  mctx.restore();
}

/** Preview masks are cached per layer. Exports skip the cache so a full-resolution
 *  mask isn't kept in memory afterwards. Resolution-independent either way. */
const previewMaskCache = new MaskCache<AnyCanvas, MaskFrame>(
  createMaskCanvas,
  drawMaskStrokes,
  maskFrameKey,
);

function rasterizeMask(
  w: number,
  h: number,
  strokes: readonly MaskStroke[],
  frame: MaskFrame,
): AnyCanvas {
  const canvas = createMaskCanvas(w, h);
  drawMaskStrokes(canvas, w, h, strokes, frame);
  return canvas;
}

/**
 * Applies one local (masked) layer: re-draws the already-rendered image
 * through that layer's own filter (so local edits stack on top of the
 * global edit, not a separately-graded version), cuts it down to the
 * painted area via destination-in compositing, then composites the result
 * back onto the main render target.
 */
function applyMaskLayer(
  ctx: Ctx2D,
  target: RenderTarget,
  w: number,
  h: number,
  layer: MaskLayer,
  cached: boolean,
  frame: MaskFrame,
) {
  if (!layerHasEffect(layer)) return;

  const temp = createCanvas(w, h);
  const tctx = get2dContext(temp);
  if (!tctx) return;

  const localFilter = buildLocalFilterParams(layer.adjustments);
  const nativeLocal = supportsCanvasFilter();
  if (nativeLocal) tctx.filter = filterString(localFilter);
  tctx.drawImage(target as CanvasImageSource, 0, 0, w, h);
  if (nativeLocal) tctx.filter = "none";
  else applyFilterFallback(tctx, w, h, localFilter);

  // Colour casts, the same blend layers as the global temperature and tint sliders.
  const cast = (color: string, amount: number, strength: number) => {
    if (amount < 0.5) return;
    tctx.save();
    tctx.globalCompositeOperation = "soft-light";
    tctx.globalAlpha = clamp(amount / 100, 0, 1) * strength;
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, w, h);
    tctx.restore();
  };
  const adj = layer.adjustments;
  cast("#ff9a3c", Math.max(0, adj.temperature), 0.35);
  cast("#3ca5ff", Math.max(0, -adj.temperature), 0.35);
  cast("#ff3cf0", Math.max(0, adj.tint), 0.25);
  cast("#54ff3c", Math.max(0, -adj.tint), 0.25);

  // Highlights and shadows: the colour stage, run on this area's scratch canvas only.
  applyColorStagePass(tctx, w, h, localStageAdjustments(adj));

  // Sharpness: unsharp mask on the scratch canvas, so only the masked part is sharpened.
  sharpen(tctx, temp as RenderTarget, w, h, adj.sharpness);

  let mask: AnyCanvas;
  if (layer.shape) {
    mask = createMaskCanvas(w, h);
    drawMaskShape(mask, w, h, layer.shape, frame);
  } else {
    mask = cached
      ? previewMaskCache.get(layer.id, layer.strokes, w, h, frame)
      : rasterizeMask(w, h, layer.strokes, frame);
  }
  // Keep the filtered copy where the mask is (destination-in), or everywhere except where
  // the mask is when the layer is inverted (destination-out).
  tctx.globalCompositeOperation = layer.invert ? "destination-out" : "destination-in";
  tctx.drawImage(mask, 0, 0);

  ctx.drawImage(temp, 0, 0);
}

/**
 * Renders the source image through the edit state onto `target`.
 * `maxDimension` downscales for fast interactive previews; omit for export quality.
 * `maskLayers` (optional) are applied last, each stacking on top of everything above.
 */
export function renderImage(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  edit: EditState,
  target: RenderTarget,
  maxDimension?: number,
  maskLayers?: MaskLayer[],
) {
  return timed("total", () =>
    renderPipeline(source, srcW, srcH, edit, target, maxDimension, maskLayers),
  );
}

function renderPipeline(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  edit: EditState,
  target: RenderTarget,
  maxDimension: number | undefined,
  maskLayers: MaskLayer[] | undefined,
) {
  const out = outputSize(srcW, srcH, edit);
  // Clone strokes are applied to a cached copy of the source, before crop, rotation and filters.
  const drawSource = edit.healStrokes?.length
    ? healedSource.get(source, srcW, srcH, edit.healStrokes)
    : source;
  let scale = 1;
  if (maxDimension) scale = Math.min(1, maxDimension / Math.max(out.width, out.height));

  const w = Math.max(1, Math.round(out.width * scale));
  const h = Math.max(1, Math.round(out.height * scale));
  target.width = w;
  target.height = h;

  const ctx = target.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("no-2d-context");

  ctx.clearRect(0, 0, w, h);
  ctx.save();

  const rot = (((edit.rotation % 360) + 360) % 360) as number;
  const swap = rot === 90 || rot === 270;
  const rotW = (swap ? srcH : srcW) * (w / out.width);
  const rotH = (swap ? srcW : srcH) * (h / out.height);

  ctx.translate(-edit.crop.x * rotW, -edit.crop.y * rotH);

  const filterParams = buildFilterParams(
    edit.adjustments,
    Math.max(w, h) / Math.max(out.width, out.height),
  );
  const nativeFilter = supportsCanvasFilter();
  if (nativeFilter) ctx.filter = filterString(filterParams);
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";

  ctx.translate(rotW / 2, rotH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  if (edit.flipH) ctx.scale(-1, 1);
  const dw = swap ? rotH : rotW;
  const dh = swap ? rotW : rotH;
  timed("draw (+native filter)", () => ctx.drawImage(drawSource, -dw / 2, -dh / 2, dw, dh));
  ctx.restore();
  // Safari/iOS ignore ctx.filter, so apply the same chain with pixel maths instead.
  if (!nativeFilter) {
    timed("filter fallback (pixels)", () => applyFilterFallback(ctx, w, h, filterParams));
  }

  ctx.save();
  ctx.filter = "none";
  timed("tone layers", () => tone(ctx, w, h, edit.adjustments));
  ctx.restore();

  timed("colour stage", () => applyColorStagePass(ctx, w, h, edit.adjustments, edit.curves));

  timed("sharpen", () => sharpen(ctx, target, w, h, edit.adjustments.sharpness));

  if (maskLayers) {
    // Only interactive previews (which pass maxDimension) use the cache.
    const cached = maxDimension !== undefined;
    const frame = frameOf(srcW, srcH, edit);
    // Prune only when masks are actually supplied, so holding "compare with
    // original" (which passes none) doesn't throw the cache away.
    if (cached) previewMaskCache.prune(maskLayers.map((l) => l.id));
    timed("local masks", () => {
      for (const layer of maskLayers) {
        applyMaskLayer(ctx, target, w, h, layer, cached, frame);
      }
    });
  }

  return { width: w, height: h };
}

/**
 * Renders the edit at full size and encodes it. If the browser can't make a canvas that large
 * (or runs out of memory), it steps down to the largest size that works and says so in the result.
 */
export async function exportImageSafely(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  edit: EditState,
  format: string,
  quality: number,
  maskLayers?: MaskLayer[],
): Promise<ExportResult & { full: { width: number; height: number } }> {
  const full = outputSize(srcW, srcH, edit);
  const result = await exportWithFallback(full.width, full.height, async (maxDimension) => {
    const canvas = document.createElement("canvas");
    try {
      const { width, height } = renderImage(
        source,
        srcW,
        srcH,
        edit,
        canvas,
        maxDimension,
        maskLayers,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, format, quality),
      );
      return { blob, width, height };
    } finally {
      canvas.width = 0; // give the pixel memory back before a smaller retry
      canvas.height = 0;
    }
  });
  return { ...result, full };
}

export async function exportImage(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  edit: EditState,
  format: string,
  quality: number,
  maskLayers?: MaskLayer[],
): Promise<Blob> {
  return (await exportImageSafely(source, srcW, srcH, edit, format, quality, maskLayers)).blob;
}
