import { describe, expect, it } from "vitest";
import { PinchTracker, pinchView, type Point, type ViewState } from "./pinch";

const view = (zoom = 1, panX = 0, panY = 0): ViewState => ({ zoom, panX, panY });
const at = (x: number, y = 0): Point => ({ x, y });

/** The point of the picture (from its centre) that sits under a screen point. */
const contentUnder = (v: ViewState, p: Point) => ({
  x: (p.x - v.panX) / v.zoom,
  y: (p.y - v.panY) / v.zoom,
});

const start = (v: ViewState, a: Point, b: Point) => ({
  view: v,
  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  dist: Math.hypot(a.x - b.x, a.y - b.y),
});
const now = (a: Point, b: Point) => ({
  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  dist: Math.hypot(a.x - b.x, a.y - b.y),
});

describe("pinchView", () => {
  it("zooms in as the fingers spread, keeping the picture under the midpoint", () => {
    const v0 = view(1, 30, -20);
    const s = start(v0, at(100), at(200));
    const next = pinchView(s, now(at(50), at(250)), 0.1, 8);
    expect(next.zoom).toBeCloseTo(2, 9);
    const before = contentUnder(v0, s.mid);
    const after = contentUnder(next, { x: 150, y: 0 });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("zooms out as the fingers close", () => {
    const next = pinchView(start(view(2), at(0), at(200)), now(at(50), at(150)), 0.1, 8);
    expect(next.zoom).toBeCloseTo(1, 9);
  });

  it("pans without zooming when both fingers slide together", () => {
    const v0 = view(1.5, 10, 20);
    const next = pinchView(start(v0, at(100), at(200)), now(at(140, 10), at(240, 10)), 0.1, 8);
    expect(next.zoom).toBeCloseTo(1.5, 9);
    expect(next.panX).toBeCloseTo(50, 9); // 10 + 40
    expect(next.panY).toBeCloseTo(30, 9); // 20 + 10
  });

  it("clamps the zoom, and the picture still follows the fingers", () => {
    const v0 = view(7, 5, 5);
    const s = start(v0, at(100), at(200));
    const next = pinchView(s, now(at(0), at(300)), 0.1, 8); // would be 21×
    expect(next.zoom).toBe(8);
    const before = contentUnder(v0, s.mid);
    const after = contentUnder(next, { x: 150, y: 0 });
    expect(after.x).toBeCloseTo(before.x, 9);

    expect(pinchView(s, now(at(150), at(150)), 0.1, 8).zoom).toBe(0.1);
  });

  it("keeps the picture under the fingers for many combinations", () => {
    const starts = [view(1), view(0.5, -40, 25), view(3, 120, -80)];
    const fingerPairs: [Point, Point, Point, Point][] = [
      [at(-50, 10), at(60, -20), at(-120, 30), at(140, -40)],
      [at(0, 0), at(80, 80), at(20, 10), at(60, 70)],
      [at(30, -90), at(-30, 90), at(40, -60), at(-10, 120)],
    ];
    for (const v0 of starts) {
      for (const [a0, b0, a1, b1] of fingerPairs) {
        const s = start(v0, a0, b0);
        const n = now(a1, b1);
        const next = pinchView(s, n, 0.01, 100);
        const before = contentUnder(v0, s.mid);
        const after = contentUnder(next, n.mid);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
      }
    }
  });
});

describe("PinchTracker", () => {
  const tracker = () => new PinchTracker(0.1, 8);

  it("one finger never pinches", () => {
    const t = tracker();
    expect(t.down(1, at(0), view())).toBe(false);
    expect(t.move(1, at(50))).toBeNull();
    expect(t.active).toBe(false);
  });

  it("a second finger starts a pinch, and moving it zooms", () => {
    const t = tracker();
    t.down(1, at(100), view());
    expect(t.down(2, at(200), view())).toBe(true);
    expect(t.active).toBe(true);
    const next = t.move(2, at(300))!; // distance 100 → 200
    expect(next.zoom).toBeCloseTo(2, 9);
  });

  it("zooms relative to the view when the pinch began", () => {
    const t = tracker();
    t.down(1, at(100), view(2, 10, 10));
    t.down(2, at(200), view(2, 10, 10));
    expect(t.move(2, at(300))!.zoom).toBeCloseTo(4, 9);
  });

  it("lifting a pinching finger ends the pinch", () => {
    const t = tracker();
    t.down(1, at(100), view());
    t.down(2, at(200), view());
    expect(t.up(2)).toBe(true);
    expect(t.active).toBe(false);
    expect(t.move(1, at(120))).toBeNull();
    expect(t.up(1)).toBe(false);
  });

  it("a new pair of fingers starts a fresh pinch from the current view", () => {
    const t = tracker();
    t.down(1, at(100), view());
    t.down(2, at(200), view());
    t.up(2);
    t.up(1);
    t.down(3, at(100), view(3));
    expect(t.down(4, at(200), view(3))).toBe(true);
    expect(t.move(4, at(300))!.zoom).toBeCloseTo(6, 9);
  });

  it("ignores a third finger", () => {
    const t = tracker();
    t.down(1, at(100), view());
    t.down(2, at(200), view());
    const before = t.move(2, at(300))!;
    expect(t.down(3, at(500), view())).toBe(false);
    expect(t.move(3, at(900))).toEqual(before);
  });

  it("does not start a pinch with two fingers on the same spot", () => {
    const t = tracker();
    t.down(1, at(100), view());
    expect(t.down(2, at(102), view())).toBe(false);
    expect(t.active).toBe(false);
  });

  it("is safe with unknown fingers, repeated mouse presses and reset", () => {
    const t = tracker();
    expect(t.up(99)).toBe(false);
    expect(t.move(99, at(1))).toBeNull();
    for (let i = 0; i < 3; i++) {
      expect(t.down(1, at(0), view())).toBe(false); // a mouse reuses one id
      t.up(1);
    }
    t.down(1, at(100), view());
    t.down(2, at(200), view());
    t.reset();
    expect(t.active).toBe(false);
    expect(t.move(1, at(150))).toBeNull();
  });
});
