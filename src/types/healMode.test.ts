import { describe, expect, it } from "vitest";
import { HEAL_MODES, healModeOf } from "./editor";

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
