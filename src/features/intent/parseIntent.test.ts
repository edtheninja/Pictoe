import { describe, expect, it } from "vitest";
import { analysisSuggestion, parseIntent } from "./parseIntent";
import type { ImageAnalysis } from "@/types/editor";

const analysis = (over: Partial<ImageAnalysis> = {}): ImageAnalysis => ({
  avgLuminance: 128,
  shadowClipPct: 0,
  highlightClipPct: 0,
  contrastRange: 200,
  warmthBias: 0,
  ...over,
});

const suggestion = (text: string, label: string, a: ImageAnalysis | null = null) =>
  parseIntent(text, a).suggestions.find((s) => s.label === label)!;

describe("parseIntent", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(parseIntent("")).toEqual({ suggestions: [], cloudOnly: null });
    expect(parseIntent("   ")).toEqual({ suggestions: [], cloudOnly: null });
  });

  it("recognises basic intents", () => {
    const up = suggestion("make it brighter", "Brighten");
    expect(up.patch.exposure).toBeGreaterThan(0);
    expect(up.patch.shadows).toBeGreaterThan(0);

    expect(suggestion("make it darker", "Darken").patch.exposure).toBeLessThan(0);
    expect(suggestion("warm it up", "Warm it up").patch.temperature).toBeGreaterThan(0);
    expect(suggestion("cool it down", "Cool it down").patch.temperature).toBeLessThan(0);
  });

  it("scales strength with intensity words", () => {
    const slight = suggestion("slightly brighter", "Brighten").patch.exposure!;
    const normal = suggestion("brighter", "Brighten").patch.exposure!;
    const strong = suggestion("really brighter", "Brighten").patch.exposure!;
    expect(slight).toBeLessThan(normal);
    expect(normal).toBeLessThan(strong);
  });

  it("routes cloud-only requests to cloudOnly and proposes no local patch", () => {
    const removal = parseIntent("remove the person");
    expect(removal.cloudOnly?.label).toBe("Object removal");
    expect(removal.suggestions).toEqual([]);

    expect(parseIntent("replace the sky").cloudOnly?.label).toBe("Sky & background replacement");
  });

  it("returns no suggestions for unrecognised input", () => {
    expect(parseIntent("xyzzy")).toEqual({ suggestions: [], cloudOnly: null });
  });

  it("never proposes more than three suggestions", () => {
    const many = parseIntent("brighter warmer dramatic vivid sharper soft");
    expect(many.suggestions.length).toBeLessThanOrEqual(3);
    expect(many.suggestions.length).toBeGreaterThan(0);
  });

  it("only produces whole numbers within the slider range", () => {
    const { suggestions } = parseIntent("really dramatic punch contrast sharp warm vivid");
    for (const s of suggestions) {
      for (const value of Object.values(s.patch)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(100);
      }
    }
  });

  it("brightens a dark photo more than a neutral one, and a bright one less", () => {
    const dark = suggestion("brighter", "Brighten", analysis({ avgLuminance: 40 })).patch.exposure!;
    const neutral = suggestion("brighter", "Brighten").patch.exposure!;
    const bright = suggestion("brighter", "Brighten", analysis({ avgLuminance: 200 })).patch
      .exposure!;
    expect(dark).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(bright);
  });

  it("warms an already-warm photo less than a cool one", () => {
    const warm = suggestion("warmer", "Warm it up", analysis({ warmthBias: 0.4 })).patch
      .temperature!;
    const cool = suggestion("warmer", "Warm it up", analysis({ warmthBias: -0.4 })).patch
      .temperature!;
    expect(warm).toBeLessThan(cool);
  });
});

describe("analysisSuggestion", () => {
  it("suggests brightening a dark photo", () => {
    expect(analysisSuggestion(analysis({ avgLuminance: 30, shadowClipPct: 0.5 }))?.label).toBe(
      "Brighten",
    );
  });

  it("suggests recovering highlights on a blown-out photo", () => {
    expect(analysisSuggestion(analysis({ avgLuminance: 220, highlightClipPct: 0.3 }))?.label).toBe(
      "Recover highlights",
    );
  });

  it("stays quiet for a well-exposed photo", () => {
    expect(
      analysisSuggestion(analysis({ shadowClipPct: 0.01, highlightClipPct: 0.01 })),
    ).toBeNull();
  });
});
