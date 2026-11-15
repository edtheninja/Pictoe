import { describe, expect, it } from "vitest";
import { internStrokes } from "./strokeInterning";
import { planStrokeUpdate } from "./incremental";

type S = { x: number; y: number; radius: number; mode?: string };
const clone = <T>(v: T): T => structuredClone(v);

describe("internStrokes", () => {
  it("returns the incoming array when there is nothing cached", () => {
    const incoming: S[] = [{ x: 1, y: 2, radius: 3 }];
    expect(internStrokes(undefined, incoming)).toBe(incoming);
  });

  it("returns the cached array itself when a cloned copy is equal, so caches see 'reuse'", () => {
    const cached: S[] = [
      { x: 1, y: 2, radius: 3 },
      { x: 4, y: 5, radius: 6, mode: "erase" },
    ];
    const result = internStrokes(cached, clone(cached));
    expect(result).toBe(cached);
    expect(planStrokeUpdate(cached, result)).toBe("reuse");
  });

  it("keeps old item identities for an unchanged prefix, so caches see 'append'", () => {
    const cached: S[] = [
      { x: 1, y: 2, radius: 3 },
      { x: 4, y: 5, radius: 6 },
    ];
    const incoming = [...clone(cached), { x: 7, y: 8, radius: 9 }];
    const result = internStrokes(cached, incoming);
    expect(result).not.toBe(cached);
    expect(result[0]).toBe(cached[0]);
    expect(result[1]).toBe(cached[1]);
    expect(result[2]).toEqual({ x: 7, y: 8, radius: 9 });
    expect(planStrokeUpdate(cached, result)).toBe("append");
  });

  it("lets caches rebuild after an undo (fewer strokes)", () => {
    const cached: S[] = [
      { x: 1, y: 2, radius: 3 },
      { x: 4, y: 5, radius: 6 },
    ];
    const result = internStrokes(cached, clone(cached.slice(0, 1)));
    expect(planStrokeUpdate(cached, result)).toBe("rebuild");
  });

  it("lets caches rebuild when an earlier stroke was replaced", () => {
    const cached: S[] = [
      { x: 1, y: 2, radius: 3 },
      { x: 4, y: 5, radius: 6 },
    ];
    const incoming = [
      { x: 1, y: 2, radius: 99 },
      { x: 4, y: 5, radius: 6 },
      { x: 0, y: 0, radius: 1 },
    ];
    const result = internStrokes(cached, incoming);
    expect(result[0]).not.toBe(cached[0]);
    expect(planStrokeUpdate(cached, result)).toBe("rebuild");
  });

  it("treats a changed or extra property as a different stroke", () => {
    const cached: S[] = [{ x: 1, y: 2, radius: 3 }];
    const result = internStrokes(cached, [{ x: 1, y: 2, radius: 3, mode: "erase" }]);
    expect(result).not.toBe(cached);
    expect(result[0]).not.toBe(cached[0]);
  });

  it("sees a stroke whose mode changed as different, and an unchanged mode as the same", () => {
    const cached: S[] = [{ x: 1, y: 2, radius: 3, mode: "clone" }];
    expect(internStrokes(cached, clone(cached))).toBe(cached);

    const changed = internStrokes(cached, [{ x: 1, y: 2, radius: 3, mode: "heal" }]);
    expect(changed).not.toBe(cached);
    expect(changed[0]).toEqual({ x: 1, y: 2, radius: 3, mode: "heal" });
    expect(planStrokeUpdate(cached, changed)).toBe("rebuild");
  });
});
