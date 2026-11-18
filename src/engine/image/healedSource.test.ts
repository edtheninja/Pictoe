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

  it("paints a stroke with no mode and one marked clone identically (saves from before modes)", () => {
    const a = arraySurface(W, W);
    const b = arraySurface(W, W);
    applyStrokes(a.surface, [stroke({ softness: 40 })]);
    applyStrokes(b.surface, [stroke({ softness: 40, mode: "clone" })]);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
});

describe("applyStrokes with heal strokes", () => {
  // A 60 x 60 picture: grey 100 on the left (with a bright blemish at (10, 10)), grey 130 on the
  // right. A stroke at the blemish copying from 30 px to the right lands on the brighter side.
  const N = 60;
  const scene = (x: number, y: number) => {
    if (Math.hypot(x + 0.5 - 10.5, y + 0.5 - 10.5) < 2) return [220, 220, 220, 255];
    return x < 30 ? [100, 100, 100, 255] : [130, 130, 130, 255];
  };
  const healStroke = (over: Partial<HealStroke> = {}): HealStroke => ({
    x: 10.5 / N,
    y: 10.5 / N,
    dx: 30 / N,
    dy: 0,
    radius: 4 / N,
    softness: 0,
    mode: "heal",
    ...over,
  });
  const run = (strokes: HealStroke[]) => {
    const s = arraySurface(N, N, scene);
    applyStrokes(s.surface, strokes);
    return s.data;
  };

  it("a heal stroke ends at the target's brightness where a clone leaves the source's", () => {
    const healed = run([healStroke()]);
    const cloned = run([healStroke({ mode: "clone" })]);
    expect(at(healed, N, 10, 10)[0]).toBeCloseTo(100, 0);
    expect(at(cloned, N, 10, 10)[0]).toBe(130);
  });

  it("leaves everything outside the dab untouched, ring included", () => {
    const original = arraySurface(N, N, scene).data;
    const healed = run([healStroke()]);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (Math.hypot(x + 0.5 - 10.5, y + 0.5 - 10.5) >= 4) {
          expect(at(healed, N, x, y)).toEqual(at(original, N, x, y));
        }
      }
  });

  it("a drag of overlapping heal dabs heals along the whole path", () => {
    const drag = [10.5, 12.5, 14.5, 16.5, 18.5].map((x) => healStroke({ x: x / N }));
    const healed = run(drag);
    for (const x of [10, 12, 14, 16, 18]) expect(at(healed, N, x, 10)[0]).toBeCloseTo(100, 0);
  });

  it("mixes modes in order: a clone stroke and a heal stroke each do their own job", () => {
    const strokes = [
      healStroke({ mode: "clone", x: 10.5 / N, y: 10.5 / N }),
      healStroke({ x: 10.5 / N, y: 40.5 / N, dx: 0.25 }),
    ];
    const out = run(strokes);
    expect(at(out, N, 10, 10)[0]).toBe(130); // clone: source brightness
  });

  it("the cache's append path gives the same picture as painting every stroke from scratch", () => {
    const make = () =>
      new HealedSources<object, object>((_src, w, h) => {
        const s = arraySurface(w, h, scene);
        return { canvas: s.data, surface: s.surface };
      });
    const first = healStroke();
    const second = healStroke({ x: 14.5 / N });
    const third = healStroke({ x: 18.5 / N, mode: "clone" });

    const incremental = make();
    const src = {};
    incremental.get(src, N, N, [first]);
    incremental.get(src, N, N, [first, second]);
    const viaAppend = incremental.get(src, N, N, [first, second, third]) as Uint8ClampedArray;

    const viaRebuild = make().get({}, N, N, [first, second, third]) as Uint8ClampedArray;
    expect(Array.from(viaAppend)).toEqual(Array.from(viaRebuild));
  });

  it("a heal dab still costs two reads (source area and target area), like a clone", () => {
    const made: ReturnType<typeof arraySurface>[] = [];
    const cache = new HealedSources<object, object>((_s, w, h) => {
      const s = arraySurface(w, h, scene);
      made.push(s);
      return { canvas: s.data, surface: s.surface };
    });
    const src = {};
    const a = healStroke();
    cache.get(src, N, N, [a]);
    const before = made[0]!.reads();
    cache.get(src, N, N, [a, healStroke({ x: 14.5 / N })]);
    expect(made[0]!.reads() - before).toBe(2);
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
