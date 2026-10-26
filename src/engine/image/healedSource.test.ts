import { describe, expect, it } from "vitest";
import { applyStrokes, HealedSources, type Surface } from "./healedSource";
import type { HealStroke } from "@/types/editor";

/** An in-memory surface: a w×h RGBA array standing in for a canvas. */
function arraySurface(w: number, h: number, fill?: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r = 0, g = 0, b = 0, a = 255] = fill ? fill(x, y) : [x * 8, y * 8, 0, 255];
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  let reads = 0;
  const surface: Surface = {
    width: w,
    height: h,
    read(x, y, rw, rh) {
      reads++;
      const out = new Uint8ClampedArray(rw * rh * 4);
      for (let j = 0; j < rh; j++)
        out.set(data.subarray(((y + j) * w + x) * 4, ((y + j) * w + x + rw) * 4), j * rw * 4);
      return out;
    },
    write(src, x, y, rw, rh) {
      for (let j = 0; j < rh; j++)
        data.set(src.subarray(j * rw * 4, (j + 1) * rw * 4), ((y + j) * w + x) * 4);
    },
  };
  return { surface, data, reads: () => reads };
}
const at = (data: Uint8ClampedArray, w: number, x: number, y: number) =>
  Array.from(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

// Paints around (10,10) copying from 12px to the right; 40×40 image.
const W = 40;
const stroke = (over: Partial<HealStroke> = {}): HealStroke => ({
  x: 10.5 / W,
  y: 10.5 / W,
  dx: 12 / W,
  dy: 0,
  radius: 4 / W,
  softness: 0,
  ...over,
});

describe("applyStrokes", () => {
  it("paints the source area into the target", () => {
    const { surface, data } = arraySurface(W, W);
    applyStrokes(surface, [stroke()]);
    expect(at(data, W, 10, 10)).toEqual([22 * 8, 10 * 8, 0, 255]);
  });

  it("applies strokes in order, so a later stroke can copy from an earlier result", () => {
    const { surface, data } = arraySurface(W, W);
    // Stroke 1 puts (22,10)'s colour at (10,10). Stroke 2 copies (10,10) → (22,20) region.
    applyStrokes(surface, [
      stroke(),
      stroke({ x: 22.5 / W, y: 20.5 / W, dx: -12 / W, dy: -10 / W }),
    ]);
    expect(at(data, W, 22, 20)).toEqual(at(data, W, 10, 10));
  });

  it("ignores strokes that fall outside the image", () => {
    const { surface, data } = arraySurface(W, W);
    const before = Array.from(data);
    applyStrokes(surface, [stroke({ x: 5, y: 5 })]);
    expect(Array.from(data)).toEqual(before);
  });
});

describe("HealedSources", () => {
  const setup = () => {
    const made: ReturnType<typeof arraySurface>[] = [];
    const cache = new HealedSources<object, object>((_src, w, h) => {
      const s = arraySurface(w, h);
      made.push(s);
      return { canvas: s.data, surface: s.surface };
    });
    return { cache, made, source: {} };
  };

  it("builds once and reuses the same canvas for the same strokes array", () => {
    const { cache, made, source } = setup();
    const strokes = [stroke()];
    const a = cache.get(source, W, W, strokes);
    const reads = made[0]!.reads();
    const b = cache.get(source, W, W, strokes);
    expect(b).toBe(a);
    expect(made).toHaveLength(1);
    expect(made[0]!.reads()).toBe(reads); // no extra pixel work
  });

  it("appends only the new strokes when the array grows from the same items", () => {
    const { cache, made, source } = setup();
    const first = stroke();
    cache.get(source, W, W, [first]);
    const readsAfterFirst = made[0]!.reads();
    cache.get(source, W, W, [first, stroke({ x: 30.5 / W, y: 30.5 / W, dx: -12 / W })]);
    expect(made).toHaveLength(1);
    // One more dab = two more reads (source area + target area), not a replay of both strokes.
    expect(made[0]!.reads() - readsAfterFirst).toBe(2);
  });

  it("rebuilds from a fresh copy after an undo (fewer strokes)", () => {
    const { cache, made, source } = setup();
    const a = stroke();
    const b = stroke({ x: 30.5 / W, y: 30.5 / W, dx: -12 / W });
    cache.get(source, W, W, [a, b]);
    const undone = cache.get(source, W, W, [a]);
    expect(made).toHaveLength(2);
    // The second build must not still contain stroke b's paint.
    expect(at(made[1]!.data, W, 30, 30)).toEqual([30 * 8, 30 * 8, 0, 255]);
    expect(undone).toBe(made[1]!.data);
  });

  it("rebuilds when an earlier stroke was replaced, even if the length grew", () => {
    const { cache, made, source } = setup();
    cache.get(source, W, W, [stroke()]);
    cache.get(source, W, W, [stroke(), stroke({ x: 30.5 / W })]); // new object at index 0
    expect(made).toHaveLength(2);
  });

  it("rebuilds when the source size changes", () => {
    const { cache, made, source } = setup();
    const strokes = [stroke()];
    cache.get(source, W, W, strokes);
    cache.get(source, W + 10, W, strokes);
    expect(made).toHaveLength(2);
  });

  it("keeps separate results per source image", () => {
    const { cache, made } = setup();
    const strokes = [stroke()];
    const a = cache.get({}, W, W, strokes);
    const b = cache.get({}, W, W, strokes);
    expect(a).not.toBe(b);
    expect(made).toHaveLength(2);
  });
});
