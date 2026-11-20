import { describe, expect, it } from "vitest";
import { MAX_DABS_PER_MOVE, dabsAlong } from "./strokePath";

const W = 800;
const H = 600;
const px = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });

describe("dabsAlong", () => {
  it("puts the first dab of a stroke where the pointer went down", () => {
    expect(dabsAlong(null, { x: 0.3, y: 0.4 }, 10, W, H)).toEqual([{ x: 0.3, y: 0.4 }]);
  });

  it("adds nothing until the pointer has moved a full spacing", () => {
    const last = { x: 0.5, y: 0.5 };
    expect(dabsAlong(last, { x: 0.5 + 9 / W, y: 0.5 }, 10, W, H)).toEqual([]);
    expect(dabsAlong(last, last, 10, W, H)).toEqual([]);
  });

  it("fills a long move with dabs exactly one spacing apart, in a straight line", () => {
    const last = { x: 0.1, y: 0.2 };
    const to = { x: 0.1 + 100 / W, y: 0.2 }; // 100 px right
    const points = dabsAlong(last, to, 8, W, H);
    expect(points).toHaveLength(12); // 12 spacings of 8 px fit in 100 px
    let before = px(last);
    for (const p of points) {
      const here = px(p);
      expect(Math.hypot(here.x - before.x, here.y - before.y)).toBeCloseTo(8, 9);
      expect(here.y).toBeCloseTo(px(last).y, 9);
      before = here;
    }
    // The last dab is 96 px along, short of the pointer: the remaining 4 px carry to the next move.
    expect(before.x - px(last).x).toBeCloseTo(96, 9);
  });

  it("measures spacing in real pixels on a wide picture, not in fractions", () => {
    // 0.1 across is 80 px wide but 60 px tall: a diagonal move of (0.1, 0.1) is 100 px.
    const points = dabsAlong({ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }, 20, W, H);
    expect(points).toHaveLength(5);
    const a = px({ x: 0.2, y: 0.2 });
    const b = px(points[0]!);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20, 9);
  });

  it("continues cleanly across several moves: no gaps and no doubled dabs", () => {
    // Move in uneven steps; every consecutive pair of dabs must stay one spacing apart.
    const moves = [37, 5, 61, 14, 90, 3, 22].map((m) => m / W);
    let last: { x: number; y: number } | null = { x: 0.1, y: 0.5 };
    let pointer = { x: 0.1, y: 0.5 };
    const dabs = [last];
    for (const m of moves) {
      pointer = { x: pointer.x + m, y: 0.5 };
      for (const p of dabsAlong(last, pointer, 7, W, H)) {
        dabs.push(p);
        last = p;
      }
    }
    for (let i = 1; i < dabs.length; i++) {
      expect(Math.abs((dabs[i]!.x - dabs[i - 1]!.x) * W)).toBeCloseTo(7, 9);
    }
    // And the line is covered to within one spacing of where the pointer ended.
    expect((pointer.x - last.x) * W).toBeLessThan(7);
    expect((pointer.x - last.x) * W).toBeGreaterThanOrEqual(0);
  });

  it("keeps the last dab of a move of exactly whole spacings, despite float rounding", () => {
    // 0.3 - 0.2 is 0.09999999999999998 in floating point, so this is 99.99999999999997 px, not 100.
    const points = dabsAlong({ x: 0.2, y: 0.5 }, { x: 0.3, y: 0.5 }, 20, W / 0.8, H); // 100 px wide
    expect(points).toHaveLength(5);
  });

  it("caps a stray jump, and the next move carries on from the last dab", () => {
    const points = dabsAlong({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 1, W, H); // 800 px at 1 px spacing
    expect(points).toHaveLength(MAX_DABS_PER_MOVE);
    expect(MAX_DABS_PER_MOVE).toBe(200);
    const resumed = dabsAlong(points[points.length - 1]!, { x: 1, y: 0.5 }, 1, W, H);
    expect(resumed.length).toBeGreaterThan(0);
    expect(px(resumed[0]!).x - px(points[points.length - 1]!).x).toBeCloseTo(1, 9);
  });

  it("adds nothing for a spacing that is not positive", () => {
    expect(dabsAlong({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, W, H)).toEqual([]);
    expect(dabsAlong({ x: 0, y: 0 }, { x: 1, y: 1 }, -3, W, H)).toEqual([]);
    expect(dabsAlong({ x: 0, y: 0 }, { x: 1, y: 1 }, Number.NaN, W, H)).toEqual([]);
  });
});
