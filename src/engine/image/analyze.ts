import type { ImageAnalysis } from "@/types/editor";

const SAMPLE_MAX_DIM = 150;

/**
 * Cheap, local, synchronous image analysis. Downsamples the source image onto
 * an offscreen canvas and reads back pixel data — no network, no ML model,
 * just histogram-level stats used to make intent suggestions image-aware
 * instead of fixed-magnitude guesses.
 */
export function analyzeImage(element: HTMLImageElement): ImageAnalysis {
  const { naturalWidth: w, naturalHeight: h } = element;
  const scale = Math.min(1, SAMPLE_MAX_DIM / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    // Canvas unavailable — return neutral stats rather than throw, so a
    // failed analysis never blocks loading an image.
    return {
      avgLuminance: 128,
      shadowClipPct: 0,
      highlightClipPct: 0,
      contrastRange: 255,
      warmthBias: 0,
    };
  }

  ctx.drawImage(element, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  let luminanceSum = 0;
  let shadowClipped = 0;
  let highlightClipped = 0;
  let rSum = 0;
  let bSum = 0;
  let min = 255;
  let max = 0;
  const pixelCount = sw * sh;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    luminanceSum += luminance;
    rSum += r;
    bSum += b;
    if (luminance < min) min = luminance;
    if (luminance > max) max = luminance;
    if (luminance < 8) shadowClipped++;
    if (luminance > 247) highlightClipped++;
  }

  return {
    avgLuminance: luminanceSum / pixelCount,
    shadowClipPct: shadowClipped / pixelCount,
    highlightClipPct: highlightClipped / pixelCount,
    contrastRange: max - min,
    warmthBias: (rSum - bSum) / pixelCount / 255, // -1 (cool) .. 1 (warm)
  };
}
