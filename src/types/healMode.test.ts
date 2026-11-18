import { describe, expect, it } from "vitest";
import { HEAL_MODES, healChangeLabel, healModeOf } from "./editor";

describe("heal modes", () => {
  it("are clone and heal, and nothing else", () => {
    expect([...HEAL_MODES]).toEqual(["clone", "heal"]);
  });

  it("read a stroke with no mode as a clone, and any set mode as itself", () => {
    expect(healModeOf({})).toBe("clone");
    expect(healModeOf({ mode: "clone" })).toBe("clone");
    expect(healModeOf({ mode: "heal" })).toBe("heal");
  });
});

describe("healChangeLabel (what the history calls a change to the strokes)", () => {
  const clone = {};
  const heal = { mode: "heal" as const };

  it("names the mode of the stroke that was added", () => {
    expect(healChangeLabel([], [clone])).toBe("Clone");
    expect(healChangeLabel([], [heal])).toBe("Heal");
    expect(healChangeLabel([clone], [clone, heal])).toBe("Heal");
    expect(healChangeLabel([heal], [heal, clone])).toBe("Clone");
  });

  it("names the mode of the stroke that was undone", () => {
    expect(healChangeLabel([clone, heal], [clone])).toBe("Heal");
    expect(healChangeLabel([heal, clone], [heal])).toBe("Clone");
  });

  it("falls back to Clone when there are no strokes on either side", () => {
    expect(healChangeLabel([], [])).toBe("Clone");
  });
});
