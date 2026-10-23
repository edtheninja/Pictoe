import type { HealStroke } from "@/types/editor";
import { cloneDab, dabFromStroke, dabRects } from "./cloneStamp";
import { planStrokeUpdate } from "./incremental";

/** Reading and writing rectangles of pixels, whatever holds them (a canvas, or an array in tests). */
export type Surface = {
  width: number;
  height: number;
  read(x: number, y: number, w: number, h: number): Uint8ClampedArray;
  write(data: Uint8ClampedArray, x: number, y: number, w: number, h: number): void;
};

/** Applies clone strokes to a surface, in order. Each dab reads both areas before writing. */
export function applyStrokes(surface: Surface, strokes: readonly HealStroke[]) {
  for (const stroke of strokes) {
    const dab = dabFromStroke(stroke, surface.width, surface.height);
    const rects = dabRects(dab, surface.width, surface.height);
    if (!rects) continue;

    const src = {
      ...rects.src,
      data: surface.read(rects.src.x, rects.src.y, rects.src.w, rects.src.h),
    };
    const dst = {
      ...rects.dst,
      data: surface.read(rects.dst.x, rects.dst.y, rects.dst.w, rects.dst.h),
    };
    cloneDab(src, dst, dab, surface.width, surface.height);
    surface.write(dst.data, dst.x, dst.y, dst.w, dst.h);
  }
}

type Entry<C> = { canvas: C; surface: Surface; strokes: readonly HealStroke[] };

/**
 * A copy of the source image with the clone strokes applied, kept per source image so the
 * result is built once. Adding strokes paints only the new ones onto the copy; an undo rebuilds
 * it. Cloning happens on the source, before crop, rotation and filters, so everything
 * downstream (preview, export, rotate, crop) just uses the healed copy.
 */
export class HealedSources<K extends object, C> {
  private entries = new WeakMap<K, Entry<C>>();

  constructor(
    private readonly make: (source: K, w: number, h: number) => { canvas: C; surface: Surface },
  ) {}

  get(source: K, w: number, h: number, strokes: readonly HealStroke[]): C {
    const entry = this.entries.get(source);
    const sameSize = entry && entry.surface.width === w && entry.surface.height === h;
    const plan = sameSize ? planStrokeUpdate(entry.strokes, strokes) : "rebuild";

    if (plan === "reuse") return entry!.canvas;

    if (plan === "append") {
      applyStrokes(entry!.surface, strokes.slice(entry!.strokes.length));
      entry!.strokes = strokes;
      return entry!.canvas;
    }

    const fresh = this.make(source, w, h);
    applyStrokes(fresh.surface, strokes);
    this.entries.set(source, { canvas: fresh.canvas, surface: fresh.surface, strokes });
    return fresh.canvas;
  }
}

function makeCanvasSource(source: CanvasImageSource, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);

  const surface: Surface = {
    width: w,
    height: h,
    read: (x, y, rw, rh) => ctx.getImageData(x, y, rw, rh).data,
    // The data always came from getImageData, so it is backed by a plain ArrayBuffer.
    write: (data, x, y, rw, rh) =>
      ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, rw, rh), x, y),
  };
  return { canvas, surface };
}

/** The healed copy of a source image, for use wherever the original would be drawn. */
export const healedSource = new HealedSources<CanvasImageSource, HTMLCanvasElement>(
  makeCanvasSource,
);
