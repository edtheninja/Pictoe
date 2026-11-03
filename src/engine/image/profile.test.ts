import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profileSummary, resetProfile, setProfiling, timed } from "./profile";

beforeEach(() => resetProfile());
afterEach(() => {
  setProfiling(false);
  vi.unstubAllGlobals();
});

describe("profiling harness", () => {
  it("returns the function's result and records nothing while off", () => {
    setProfiling(false);
    expect(timed("stage", () => 42)).toBe(42);
    expect(profileSummary()).toEqual([]);
  });

  it("records samples per stage while on, and still returns the result", () => {
    setProfiling(true);
    expect(timed("a", () => "x")).toBe("x");
    timed("a", () => undefined);
    timed("b", () => undefined);
    const rows = Object.fromEntries(profileSummary().map((r) => [r.stage, r]));
    expect(rows["a"]?.samples).toBe(2);
    expect(rows["b"]?.samples).toBe(1);
  });

  it("still records the time when the timed function throws, and rethrows", () => {
    setProfiling(true);
    expect(() =>
      timed("boom", () => {
        throw new Error("nope");
      }),
    ).toThrow("nope");
    expect(profileSummary().find((r) => r.stage === "boom")?.samples).toBe(1);
  });

  it("reports median and 95th percentile from the recorded times", () => {
    setProfiling(true);
    const times = [10, 20, 30, 40, 100];
    let call = 0;
    vi.stubGlobal("performance", {
      now: () => {
        // timed() reads the clock twice per call: start, then end.
        const n = call++;
        const index = Math.floor(n / 2);
        return n % 2 === 0 ? 0 : times[index]!;
      },
    });
    for (let i = 0; i < times.length; i++) timed("s", () => undefined);
    const row = profileSummary().find((r) => r.stage === "s")!;
    expect(row.median).toBe(30);
    expect(row.p95).toBe(100);
    expect(row.samples).toBe(5);
  });

  it("keeps only the most recent samples", () => {
    setProfiling(true);
    for (let i = 0; i < 350; i++) timed("many", () => undefined);
    expect(profileSummary().find((r) => r.stage === "many")?.samples).toBe(300);
  });
});
