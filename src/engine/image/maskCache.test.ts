import { describe, expect, it, vi } from "vitest";
import { MaskCache, planMaskUpdate } from "./maskCache";
import type { MaskStroke } from "@/types/editor";

const stroke = (x: number): MaskStroke => ({ x, y: 0.5, radius: 0.05 });

describe("planMaskUpdate", () => {
  const strokes = [stroke(0.1), stroke(0.2)];

  it("rebuilds when nothing is cached or the size changed", () => {
    expect(planMaskUpdate(undefined, strokes, 100, 100)).toBe("rebuild");
    expect(planMaskUpdate({ w: 100, h: 100, strokes }, strokes, 200, 100)).toBe("rebuild");
    expect(planMaskUpdate({ w: 100, h: 100, strokes }, strokes, 100, 200)).toBe("rebuild");
  });

  it("reuses when the strokes array is unchanged", () => {
    expect(planMaskUpdate({ w: 100, h: 100, strokes }, strokes, 100, 100)).toBe("reuse");
  });

  it("appends when new strokes extend the cached ones", () => {
    const more = [...strokes, stroke(0.3)];
    expect(planMaskUpdate({ w: 100, h: 100, strokes }, more, 100, 100)).toBe("append");
  });

  it("rebuilds after an undo (fewer strokes) or a different history", () => {
    expect(planMaskUpdate({ w: 100, h: 100, strokes }, strokes.slice(0, 1), 100, 100)).toBe(
      "rebuild",
    );
    expect(planMaskUpdate({ w: 100, h: 100, strokes }, [stroke(0.9), stroke(0.8)], 100, 100)).toBe(
      "rebuild",
    );
    // Same prefix length but a changed earlier stroke must not be appended onto.
    expect(
      planMaskUpdate(
        { w: 100, h: 100, strokes },
        [stroke(0.9), strokes[1]!, stroke(0.3)],
        100,
        100,
      ),
    ).toBe("rebuild");
  });
});

describe("MaskCache", () => {
  const setup = () => {
    let made = 0;
    const create = vi.fn((w: number, h: number) => ({ id: ++made, w, h }));
    const draw = vi.fn();
    return { cache: new MaskCache(create, draw), create, draw };
  };

  it("draws each stroke once while painting, instead of redrawing them all every time", () => {
    const { cache, create, draw } = setup();
    let strokes: MaskStroke[] = [];
    for (let i = 0; i < 300; i++) {
      strokes = [...strokes, stroke(i / 300)];
      cache.get("layer", strokes, 800, 600);
    }
    const drawn = draw.mock.calls.reduce((sum, call) => sum + call[3].length, 0);
    expect(drawn).toBe(300); // without the cache this would be 300 × 301 / 2 = 45,150
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("reuses the same canvas when only an adjustment changed", () => {
    const { cache, draw } = setup();
    const strokes = [stroke(0.1)];
    const first = cache.get("a", strokes, 100, 100);
    const second = cache.get("a", strokes, 100, 100);
    expect(second).toBe(first);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("appends onto the same canvas but rebuilds into a new one", () => {
    const { cache } = setup();
    const base = [stroke(0.1)];
    const first = cache.get("a", base, 100, 100);
    expect(cache.get("a", [...base, stroke(0.2)], 100, 100)).toBe(first); // append
    expect(cache.get("a", [stroke(0.5)], 100, 100)).not.toBe(first); // undo-style rebuild
    expect(cache.get("a", [stroke(0.5)], 200, 200)).not.toBe(first); // resized
  });

  it("keeps layers separate", () => {
    const { cache, create } = setup();
    const a = cache.get("a", [stroke(0.1)], 100, 100);
    const b = cache.get("b", [stroke(0.1)], 100, 100);
    expect(a).not.toBe(b);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("prune forgets deleted layers only", () => {
    const { cache, create } = setup();
    const keep = [stroke(0.1)];
    cache.get("keep", keep, 100, 100);
    cache.get("gone", [stroke(0.2)], 100, 100);
    cache.prune(["keep"]);
    cache.get("keep", keep, 100, 100);
    expect(create).toHaveBeenCalledTimes(2); // "keep" survived
    cache.get("gone", [stroke(0.2)], 100, 100);
    expect(create).toHaveBeenCalledTimes(3); // "gone" was rebuilt
  });
});
