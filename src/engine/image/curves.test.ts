import { describe, expect, it } from "vitest";
import {
  MAX_CURVE_POINTS,
  MIN_POINT_GAP,
  KEY_STEP,
  KEY_STEP_BIG,
  buildCurvesPlan,
  curveKeyAction,
  evalCurve,
  insertPoint,
  isIdentityCurve,
  movePoint,
  normalizeCurve,
  normalizeCurves,
  removePoint,
  sampleCurve,
  suggestInsertion,
} from "./curves";
import { identityCurve, identityCurves, type CurvePoint } from "@/types/editor";

const pts = (...xy: [number, number][]): CurvePoint[] => xy.map(([x, y]) => ({ x, y }));
const S_CURVE = pts([0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]);

describe("evalCurve", () => {
  it("is the straight line for the identity curve", () => {
    for (let i = 0; i <= 100; i++)
      expect(evalCurve(identityCurve(), i / 100)).toBeCloseTo(i / 100, 10);
  });

  it("passes exactly through every control point", () => {
    const curve = pts([0, 0.05], [0.2, 0.4], [0.55, 0.5], [0.8, 0.9], [1, 0.95]);
    for (const p of curve) expect(evalCurve(curve, p.x)).toBeCloseTo(p.y, 10);
  });

  it("holds the end values outside the first and last points", () => {
    const curve = pts([0, 0.2], [1, 0.8]);
    expect(evalCurve(curve, -1)).toBe(0.2);
    expect(evalCurve(curve, 2)).toBe(0.8);
  });

  it("never overshoots between two neighbouring points", () => {
    const curve = pts([0, 0], [0.1, 0.5], [0.2, 0.52], [0.7, 0.55], [0.75, 1], [1, 1]);
    for (let i = 0; i < curve.length - 1; i++) {
      const [a, b] = [curve[i]!, curve[i + 1]!];
      const [lo, hi] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      for (let k = 0; k <= 50; k++) {
        const y = evalCurve(curve, a.x + ((b.x - a.x) * k) / 50);
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("does not overshoot at a peak or a valley either (zero slope at turning points)", () => {
    const curve = pts([0, 0.2], [0.3, 0.9], [0.6, 0.3], [1, 0.8]);
    for (let i = 0; i < curve.length - 1; i++) {
      const [a, b] = [curve[i]!, curve[i + 1]!];
      const [lo, hi] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      for (let k = 0; k <= 100; k++) {
        const y = evalCurve(curve, a.x + ((b.x - a.x) * k) / 100);
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("is monotone when the points rise, so brightness order is never reversed", () => {
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const y = evalCurve(S_CURVE, i / 1000);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = y;
    }
  });

  it("keeps a flat stretch flat", () => {
    const curve = pts([0, 0], [0.3, 0.4], [0.6, 0.4], [1, 1]);
    for (const x of [0.35, 0.45, 0.55]) expect(evalCurve(curve, x)).toBeCloseTo(0.4, 10);
  });

  it("makes an S-curve darker in the darks and brighter in the brights, equal at the middle", () => {
    expect(evalCurve(S_CURVE, 0.25)).toBeLessThan(0.25);
    expect(evalCurve(S_CURVE, 0.75)).toBeGreaterThan(0.75);
    expect(evalCurve(S_CURVE, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("stays between 0 and 1", () => {
    const curve = pts([0, 0], [0.05, 1], [0.1, 0], [0.9, 1], [1, 0]);
    for (let i = 0; i <= 500; i++) {
      const y = evalCurve(curve, i / 500);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe("curve tables", () => {
  it("samples 256 levels", () => {
    const samples = sampleCurve(S_CURVE);
    expect(samples).toHaveLength(256);
    expect(samples[0]).toBe(0);
    expect(samples[255]).toBeCloseTo(1, 6);
  });

  it("recognises the identity curve, and only that", () => {
    expect(isIdentityCurve(identityCurve())).toBe(true);
    expect(isIdentityCurve(pts([0, 0], [0.5, 0.5], [1, 1]))).toBe(true);
    expect(isIdentityCurve(pts([0, 0.01], [1, 1]))).toBe(false);
    expect(isIdentityCurve(S_CURVE)).toBe(false);
  });

  it("needs no work for straight curves", () => {
    expect(buildCurvesPlan(identityCurves())).toBeNull();
  });

  it("builds an RGB table only when only the RGB curve is changed", () => {
    const plan = buildCurvesPlan({ rgb: S_CURVE, luma: identityCurve() })!;
    expect(plan.rgbLut).toHaveLength(256);
    expect(plan.lumaTable).toBeNull();
    expect(plan.rgbLut![0]).toBe(0);
    expect(plan.rgbLut![255]).toBe(255);
    expect(plan.rgbLut![64]).toBeLessThan(64);
    expect(plan.rgbLut![192]).toBeGreaterThan(192);
  });

  it("builds a luminance table (in byte units) only when only the luminance curve is changed", () => {
    const plan = buildCurvesPlan({ rgb: identityCurve(), luma: pts([0, 0.1], [1, 1]) })!;
    expect(plan.rgbLut).toBeNull();
    expect(plan.lumaTable![0]).toBeCloseTo(25.5, 3); // black lifted by 10%
    expect(plan.lumaTable![255]).toBeCloseTo(0, 3);
  });
});

describe("normalizeCurve", () => {
  it("returns the straight line for anything that can't make a curve", () => {
    for (const junk of [
      undefined,
      null,
      5,
      "x",
      {},
      [],
      [{ x: 0, y: 0 }],
      [{ x: "a", y: 1 }, null],
    ]) {
      expect(normalizeCurve(junk)).toEqual(identityCurve());
    }
  });

  it("drops invalid points, clamps to 0..1 and sorts by x", () => {
    const result = normalizeCurve([
      { x: 1, y: 1 },
      { x: 0.5, y: 2 },
      { x: Number.NaN, y: 0.3 },
      "p",
      { x: 0, y: -4 },
    ]);
    expect(result).toEqual(pts([0, 0], [0.5, 1], [1, 1]));
  });

  it("pins the first point to x = 0 and the last to x = 1, keeping their heights", () => {
    expect(normalizeCurve(pts([0.1, 0.2], [0.9, 0.7]))).toEqual(pts([0, 0.2], [1, 0.7]));
  });

  it("drops interior points that are too close to a neighbour or to an end", () => {
    const result = normalizeCurve(
      pts([0, 0], [0.005, 0.1], [0.4, 0.4], [0.41, 0.9], [0.998, 0.5], [1, 1]),
    );
    expect(result).toEqual(pts([0, 0], [0.4, 0.4], [1, 1]));
  });

  it("limits the number of points", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ x: i / 39, y: i / 39 }));
    expect(normalizeCurve(many).length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
  });

  it("keeps a good curve exactly as it is, and is idempotent", () => {
    expect(normalizeCurve(S_CURVE)).toEqual(S_CURVE);
    const messy = [
      { x: 0.7, y: 0.2 },
      { x: 0.2, y: 0.9 },
      { x: 0.205, y: 0.5 },
      { x: 1.5, y: 0.1 },
    ];
    const once = normalizeCurve(messy);
    expect(normalizeCurve(once)).toEqual(once);
  });

  it("normalises a pair of curves, defaulting what is missing", () => {
    expect(normalizeCurves(undefined)).toEqual(identityCurves());
    expect(normalizeCurves({ rgb: S_CURVE })).toEqual({ rgb: S_CURVE, luma: identityCurve() });
  });
});

describe("editing points", () => {
  it("moves an interior point but keeps it between its neighbours", () => {
    const moved = movePoint(S_CURVE, 1, 0.9, 0.3);
    expect(moved[1]!.x).toBeCloseTo(0.75 - MIN_POINT_GAP, 10);
    expect(moved[1]!.y).toBe(0.3);
    expect(movePoint(S_CURVE, 1, -2, 0.3)[1]!.x).toBeCloseTo(MIN_POINT_GAP, 10);
  });

  it("keeps the end points at x = 0 and x = 1 and only lets them move vertically", () => {
    const first = movePoint(S_CURVE, 0, 0.4, 0.2);
    const last = movePoint(S_CURVE, 3, 0.4, 0.7);
    expect(first[0]).toEqual({ x: 0, y: 0.2 });
    expect(last[3]).toEqual({ x: 1, y: 0.7 });
  });

  it("clamps height to 0..1 and leaves the input list alone", () => {
    const before = JSON.stringify(S_CURVE);
    expect(movePoint(S_CURVE, 1, 0.3, 5)[1]!.y).toBe(1);
    expect(movePoint(S_CURVE, 1, 0.3, -5)[1]!.y).toBe(0);
    expect(JSON.stringify(S_CURVE)).toBe(before);
  });

  it("ignores a bad index", () => {
    expect(movePoint(S_CURVE, 9, 0.5, 0.5)).toEqual(S_CURVE);
  });

  it("inserts a point in x order and says where it went", () => {
    const result = insertPoint(S_CURVE, 0.5, 0.6)!;
    expect(result.index).toBe(2);
    expect(result.points).toHaveLength(5);
    expect(result.points.map((p) => p.x)).toEqual(
      [...result.points.map((p) => p.x)].sort((a, b) => a - b),
    );
    expect(S_CURVE).toHaveLength(4); // input untouched
  });

  it("refuses a point too close to another, at the very ends, or when the curve is full", () => {
    expect(insertPoint(S_CURVE, 0.26, 0.5)).toBeNull();
    expect(insertPoint(S_CURVE, 0.005, 0.5)).toBeNull();
    expect(insertPoint(S_CURVE, 0.998, 0.5)).toBeNull();
    const full = normalizeCurve(
      Array.from({ length: MAX_CURVE_POINTS }, (_, i) => ({
        x: i / (MAX_CURVE_POINTS - 1),
        y: 0.5,
      })),
    );
    expect(full).toHaveLength(MAX_CURVE_POINTS);
    expect(insertPoint(full, 0.033, 0.5)).toBeNull();
  });

  it("removes an interior point but never an end point", () => {
    expect(removePoint(S_CURVE, 1)).toEqual(pts([0, 0], [0.75, 0.85], [1, 1]));
    expect(removePoint(S_CURVE, 0)).toEqual(S_CURVE);
    expect(removePoint(S_CURVE, 3)).toEqual(S_CURVE);
  });

  it("suggests the middle of the widest gap, on the curve", () => {
    const suggestion = suggestInsertion(S_CURVE)!;
    expect(suggestion.x).toBeCloseTo(0.5, 10); // gap 0.25 -> 0.75 is the widest
    expect(suggestion.y).toBeCloseTo(evalCurve(S_CURVE, 0.5), 10);
  });

  it("suggests nothing for a full curve", () => {
    const full = normalizeCurve(
      Array.from({ length: MAX_CURVE_POINTS }, (_, i) => ({
        x: i / (MAX_CURVE_POINTS - 1),
        y: i / (MAX_CURVE_POINTS - 1),
      })),
    );
    expect(suggestInsertion(full)).toBeNull();
  });
});

describe("fuzzing normalizeCurve", () => {
  it("always gives a valid curve, and is stable when repeated", () => {
    let seed = 777;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const junk: unknown[] = [Number.NaN, Infinity, -3, 7, "a", null, undefined, {}, []];
    for (let n = 0; n < 300; n++) {
      const count = Math.floor(rnd() * 25);
      const raw = Array.from({ length: count }, () => ({
        x: rnd() < 0.15 ? junk[Math.floor(rnd() * junk.length)] : rnd() * 1.4 - 0.2,
        y: rnd() < 0.15 ? junk[Math.floor(rnd() * junk.length)] : rnd() * 1.4 - 0.2,
      }));
      const curve = normalizeCurve(raw);
      expect(curve.length).toBeGreaterThanOrEqual(2);
      expect(curve.length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
      expect(curve[0]!.x).toBe(0);
      expect(curve[curve.length - 1]!.x).toBe(1);
      for (let i = 0; i < curve.length; i++) {
        expect(curve[i]!.y).toBeGreaterThanOrEqual(0);
        expect(curve[i]!.y).toBeLessThanOrEqual(1);
        if (i > 0)
          expect(curve[i]!.x - curve[i - 1]!.x).toBeGreaterThanOrEqual(MIN_POINT_GAP - 1e-12);
      }
      expect(normalizeCurve(curve)).toEqual(curve);
    }
  });
});

describe("keyboard control of a point", () => {
  const moveOf = (index: number, key: string, shift = false) => {
    const action = curveKeyAction(S_CURVE, index, key, shift);
    if (action?.kind !== "move") throw new Error(`expected a move for ${key}`);
    return action.points[index]!;
  };

  it("arrow keys move an interior point by one step", () => {
    const p = S_CURVE[1]!;
    expect(moveOf(1, "ArrowUp").y).toBeCloseTo(p.y + KEY_STEP, 10);
    expect(moveOf(1, "ArrowDown").y).toBeCloseTo(p.y - KEY_STEP, 10);
    expect(moveOf(1, "ArrowRight").x).toBeCloseTo(p.x + KEY_STEP, 10);
    expect(moveOf(1, "ArrowLeft").x).toBeCloseTo(p.x - KEY_STEP, 10);
  });

  it("Shift makes the step bigger", () => {
    expect(moveOf(1, "ArrowUp", true).y).toBeCloseTo(S_CURVE[1]!.y + KEY_STEP_BIG, 10);
    expect(KEY_STEP_BIG).toBeGreaterThan(KEY_STEP);
  });

  it("left and right do nothing to the end points, which only move up and down", () => {
    expect(moveOf(0, "ArrowRight")).toEqual({ x: 0, y: 0 });
    expect(moveOf(3, "ArrowLeft")).toEqual({ x: 1, y: 1 });
    expect(moveOf(0, "ArrowUp").y).toBeCloseTo(KEY_STEP, 10);
    expect(moveOf(3, "ArrowDown").y).toBeCloseTo(1 - KEY_STEP, 10);
  });

  it("stops at the edges and at the neighbouring points", () => {
    expect(moveOf(3, "ArrowUp").y).toBe(1);
    expect(moveOf(0, "ArrowDown").y).toBe(0);
    let curve = S_CURVE;
    for (let i = 0; i < 100; i++) {
      const a = curveKeyAction(curve, 1, "ArrowRight", true);
      if (a?.kind === "move") curve = a.points;
    }
    expect(curve[1]!.x).toBeCloseTo(0.75 - MIN_POINT_GAP, 10);
  });

  it("Delete and Backspace remove an interior point and send focus to the one before it", () => {
    for (const key of ["Delete", "Backspace"]) {
      const action = curveKeyAction(S_CURVE, 2, key, false);
      expect(action).toEqual({
        kind: "remove",
        points: pts([0, 0], [0.25, 0.15], [1, 1]),
        focusIndex: 1,
      });
    }
  });

  it("Delete does nothing on an end point", () => {
    expect(curveKeyAction(S_CURVE, 0, "Delete", false)).toBeNull();
    expect(curveKeyAction(S_CURVE, 3, "Backspace", false)).toBeNull();
  });

  it("ignores other keys and bad indexes", () => {
    expect(curveKeyAction(S_CURVE, 1, "a", false)).toBeNull();
    expect(curveKeyAction(S_CURVE, 1, "Enter", false)).toBeNull();
    expect(curveKeyAction(S_CURVE, 9, "ArrowUp", false)).toBeNull();
  });
});
