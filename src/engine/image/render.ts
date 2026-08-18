import type { Adjustments, EditState } from "@/types/editor";

/**
 * Pure rendering engine. Knows nothing about React.
 * The same pipeline drives the interactive preview (downscaled) and the
 * final export (full resolution), so what you see is what you get.
 */

export type RenderTarget = HTMLCanvasElement | OffscreenCanvas;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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

function buildFilter(a: Adjustments, scale: number): string {
  const brightness = 1 + (a.exposure / 100) * 0.55 + (a.brightness / 100) * 0.4;
  const contrast = 1 + (a.contrast / 100) * 0.6 + (a.clarity / 100) * 0.25;
  const saturate = Math.max(0, 1 + a.saturation / 100 + (a.vibrance / 100) * 0.5);
  const blurPx = (a.blur / 100) * 24 * scale;

  const parts = [
    `brightness(${clamp(brightness, 0.05, 4).toFixed(4)})`,
    `contrast(${clamp(contrast, 0.05, 4).toFixed(4)})`,
    `saturate(${saturate.toFixed(4)})`,
  ];
  if (blurPx > 0.15) parts.push(`blur(${blurPx.toFixed(2)}px)`);
  return parts.join(" ");
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

  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = w;
  blurCanvas.height = h;
  const blurCtx = blurCanvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!blurCtx) return;

  const radius = 1 + (amount / 100) * 3;
  blurCtx.filter = `blur(${radius.toFixed(2)}px)`;
  blurCtx.drawImage(target as CanvasImageSource, 0, 0, w, h);
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

  // Highlights / whites lift or recover the bright end.
  layer("#ffffff", (Math.max(0, a.highlights) / 100) * 0.3, "soft-light");
  layer("#000000", (Math.max(0, -a.highlights) / 100) * 0.3, "soft-light");
  layer("#ffffff", (Math.max(0, a.whites) / 100) * 0.28, "overlay");
  layer("#000000", (Math.max(0, -a.whites) / 100) * 0.22, "overlay");

  // Shadows / blacks shape the dark end.
  layer("#ffffff", (Math.max(0, a.shadows) / 100) * 0.28, "lighten");
  layer("#000000", (Math.max(0, -a.shadows) / 100) * 0.22, "multiply");
  layer("#000000", (Math.max(0, -a.blacks) / 100) * 0.3, "multiply");
  layer("#ffffff", (Math.max(0, a.blacks) / 100) * 0.2, "lighten");

  // Temperature (warm/cool) and tint (magenta/green).
  layer("#ff9a3c", (Math.max(0, a.temperature) / 100) * 0.35, "soft-light");
  layer("#3ca5ff", (Math.max(0, -a.temperature) / 100) * 0.35, "soft-light");
  layer("#ff3cf0", (Math.max(0, a.tint) / 100) * 0.25, "soft-light");
  layer("#54ff3c", (Math.max(0, -a.tint) / 100) * 0.25, "soft-light");
}

/**
 * Renders the source image through the edit state onto `target`.
 * `maxDimension` downscales for fast interactive previews; omit for export quality.
 */
export function renderImage(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  edit: EditState,
  target: RenderTarget,
  maxDimension?: number,
) {
  const out = outputSize(srcW, srcH, edit);
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
  // Full rotated canvas dimensions (before crop), in output pixels.
  const rotW = (swap ? srcH : srcW) * (w / out.width);
  const rotH = (swap ? srcW : srcH) * (h / out.height);

  // Translate so the crop origin lands at 0,0
  ctx.translate(-edit.crop.x * rotW, -edit.crop.y * rotH);

  ctx.filter = buildFilter(edit.adjustments, Math.max(w, h) / Math.max(out.width, out.height));
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";

  ctx.translate(rotW / 2, rotH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  if (edit.flipH) ctx.scale(-1, 1);
  const dw = swap ? rotH : rotW;
  const dh = swap ? rotW : rotH;
  ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  ctx.save();
  ctx.filter = "none";
  tone(ctx, w, h, edit.adjustments);
  ctx.restore();

  sharpen(ctx, target, w, h, edit.adjustments.sharpness);

  return { width: w, height: h };
}

export async function exportImage(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  edit: EditState,
  format: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  renderImage(source, srcW, srcH, edit, canvas);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality));
  if (!blob) throw new Error("encode-failed");
  return blob;
}
