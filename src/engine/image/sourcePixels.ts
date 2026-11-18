import { createCanvas, get2dContext } from "./canvasFactory";
import type { Rect } from "./cloneStamp";

/**
 * Reads one rectangle of the original photo's pixels. Only that rectangle is drawn and read, so
 * the cost follows the rectangle and not the photo: a 24 MP photo costs the same as a small one.
 * (Needs a canvas, so it is not unit-tested; the browser tests cover it.)
 */
export function readSourceWindow(source: CanvasImageSource, rect: Rect): Uint8ClampedArray {
  const canvas = createCanvas(rect.w, rect.h);
  const ctx = get2dContext(canvas, { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray(rect.w * rect.h * 4);
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return ctx.getImageData(0, 0, rect.w, rect.h).data;
}
