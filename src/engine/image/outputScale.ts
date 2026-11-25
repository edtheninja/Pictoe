/**
 * The size an image ends up at when its longest side is limited to `maxDimension`: the photo's
 * proportions kept, each side rounded, never smaller than 1 pixel, and never enlarged. This one
 * formula is what the renderer draws at and what the export panel promises, so the size shown
 * before saving is exactly the size of the file. No DOM, so it can be tested.
 */
export function scaledSize(width: number, height: number, maxDimension?: number) {
  let scale = 1;
  if (maxDimension) scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
