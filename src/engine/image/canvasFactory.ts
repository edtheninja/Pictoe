/**
 * Creates scratch canvases without assuming a page.
 *
 * The render pipeline needs temporary canvases (blur copies, mask layers, healed sources). It used
 * to call `document.createElement("canvas")` directly, which cannot run in a Web Worker. This helper
 * uses the DOM when there is one (so main-thread behaviour is unchanged, including on Safari
 * versions without `OffscreenCanvas`) and falls back to `OffscreenCanvas` when there isn't.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  throw new Error("no-canvas-available");
}

export function get2dContext(
  canvas: AnyCanvas,
  options?: CanvasRenderingContext2DSettings,
): AnyCtx2D | null {
  // The two canvas types have separate getContext overloads that TypeScript can't call through
  // a union. At runtime both accept ("2d", options) and return a compatible 2D context.
  return (canvas as HTMLCanvasElement).getContext("2d", options);
}
