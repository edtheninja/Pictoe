import { describe, expect, it } from "vitest";
import { ADJUSTMENT_DEFS, BAND_CHANNELS, BAND_NAMES, DEFAULT_ADJUSTMENTS, bandKey } from "./editor";

describe("adjustment definitions", () => {
  it("define every adjustment exactly once, and nothing that isn't an adjustment", () => {
    const defined = ADJUSTMENT_DEFS.map((d) => d.key);
    expect(new Set(defined).size).toBe(defined.length);
    expect([...defined].sort()).toEqual(Object.keys(DEFAULT_ADJUSTMENTS).sort());
  });

  it("give every default a value inside its slider's range", () => {
    for (const def of ADJUSTMENT_DEFS) {
      const value = DEFAULT_ADJUSTMENTS[def.key];
      expect(value).toBeGreaterThanOrEqual(def.min);
      expect(value).toBeLessThanOrEqual(def.max);
    }
  });

  it("have a hue, saturation and luminance slider for each of the six colour bands", () => {
    for (const band of BAND_NAMES) {
      for (const channel of BAND_CHANNELS) {
        const def = ADJUSTMENT_DEFS.find((d) => d.key === bandKey(channel, band));
        expect(def, `${channel}${band}`).toBeDefined();
        expect(def!.group).toBe("bands");
        expect(def!.min).toBe(-100);
        expect(def!.max).toBe(100);
        expect(def!.label.toLowerCase()).toContain(band.toLowerCase());
      }
    }
    expect(BAND_NAMES).toHaveLength(6);
  });

  it("keep the colour mixer sliders out of the plain Color group list", () => {
    const colour = ADJUSTMENT_DEFS.filter((d) => d.group === "color").map((d) => d.key);
    for (const key of colour)
      expect(key).not.toMatch(/^(hue|sat|lum)(Red|Orange|Yellow|Green|Blue|Purple)$/);
  });
});
