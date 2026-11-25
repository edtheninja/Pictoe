import { describe, expect, it } from "vitest";
import { scaledSize } from "./outputScale";

describe("scaledSize", () => {
  it("leaves the size alone when there is no limit, or the limit is not smaller", () => {
    expect(scaledSize(6000, 4000)).toEqual({ width: 6000, height: 4000, scale: 1 });
    expect(scaledSize(6000, 4000, 0)).toEqual({ width: 6000, height: 4000, scale: 1 });
    expect(scaledSize(6000, 4000, 6000)).toEqual({ width: 6000, height: 4000, scale: 1 });
    expect(scaledSize(6000, 4000, 99_999)).toEqual({ width: 6000, height: 4000, scale: 1 }); // never enlarges
  });

  it("limits the longest side exactly, and keeps the proportions, for landscape and portrait", () => {
    expect(scaledSize(6000, 4000, 2000)).toMatchObject({ width: 2000, height: 1333 });
    expect(scaledSize(4000, 6000, 2000)).toMatchObject({ width: 1333, height: 2000 });
    expect(scaledSize(3000, 3000, 750)).toMatchObject({ width: 750, height: 750 });
  });

  it("never returns a side smaller than one pixel", () => {
    expect(scaledSize(10_000, 10, 100)).toMatchObject({ width: 100, height: 1 });
  });

  it("returns the scale it used", () => {
    expect(scaledSize(6000, 4000, 1500).scale).toBe(0.25);
  });
});
