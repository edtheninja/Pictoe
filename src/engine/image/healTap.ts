import { autoSourceWindow, findAutoSource, type AutoSource, type Spot } from "./autoSource";
import type { Rect } from "./cloneStamp";

/** Reads a rectangle of the photo's pixels as RGBA, row by row (a canvas, or an array in tests). */
export type ReadPixels = (rect: Rect) => Uint8ClampedArray;

/**
 * The source for a one-tap heal at `at` (0-1 across the photo) with a brush of `radius` (a
 * fraction of the photo's shorter side, as strokes store it), or null when no good place to copy
 * from was found. Reads only the window the search needs. The offset comes back as fractions of
 * the photo's width and height, ready to store in a stroke as `dx` and `dy`.
 */
export function autoSourceFor(
  read: ReadPixels,
  srcW: number,
  srcH: number,
  at: { x: number; y: number },
  radius: number,
): { dx: number; dy: number; score: number } | null {
  const spot: Spot = { cx: at.x * srcW, cy: at.y * srcH, r: radius * Math.min(srcW, srcH) };
  if (!(spot.r > 0)) return null;

  const window = autoSourceWindow(spot, srcW, srcH);
  if (window.w <= 0 || window.h <= 0) return null;

  const found: AutoSource | null = findAutoSource(
    { ...window, data: read(window) },
    srcW,
    srcH,
    spot,
  );
  if (!found) return null;
  return { dx: found.dx / srcW, dy: found.dy / srcH, score: found.score };
}
