import { describe, expect, it } from "vitest";
import {
  LOOK_STORAGE_KEY,
  changedAdjustmentCount,
  copyLook,
  describeLook,
  hasCurves,
  isPlainLook,
  loadLook,
  normalizeLook,
  pasteLook,
  sameLook,
  saveLook,
} from "./editClipboard";
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_EDIT_STATE,
  identityCurves,
  type EditState,
} from "@/types/editor";

const edit = (over: Partial<EditState> = {}): EditState => ({
  ...DEFAULT_EDIT_STATE,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  curves: identityCurves(),
  ...over,
});

const warm = () =>
  edit({
    adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 20, temperature: 15, satRed: -30 },
    curves: {
      rgb: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
      luma: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  });

describe("copyLook / pasteLook", () => {
  it("copies every adjustment and both curves", () => {
    const look = copyLook(warm());
    expect(look.adjustments.exposure).toBe(20);
    expect(look.adjustments.satRed).toBe(-30);
    expect(look.curves.rgb).toHaveLength(3);
  });

  it("copies the look only, never crop, rotation, flip or healing", () => {
    const source = edit({
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      rotation: 90,
      flipH: true,
      healStrokes: [{ x: 0.5, y: 0.5, dx: 0.1, dy: 0, radius: 0.05, softness: 30 }],
    });
    expect(Object.keys(copyLook(source)).sort()).toEqual(["adjustments", "curves"]);
    expect(Object.keys(pasteLook(copyLook(source))).sort()).toEqual(["adjustments", "curves"]);
  });

  it("shares nothing with the edit it came from, or with the paste", () => {
    const source = warm();
    const look = copyLook(source);
    source.adjustments.exposure = 99;
    source.curves.rgb[1]!.y = 0.9;
    expect(look.adjustments.exposure).toBe(20);
    expect(look.curves.rgb[1]!.y).toBe(0.6);

    const pasted = pasteLook(look);
    pasted.adjustments.exposure = -50;
    pasted.curves.rgb[1]!.y = 0.1;
    expect(look.adjustments.exposure).toBe(20);
    expect(look.curves.rgb[1]!.y).toBe(0.6);
  });

  it("a paste replaces the target's look: values the source left alone reset", () => {
    const target = edit({ adjustments: { ...DEFAULT_ADJUSTMENTS, contrast: 40 } });
    const merged = { ...target, ...pasteLook(copyLook(warm())) };
    expect(merged.adjustments.contrast).toBe(0);
    expect(merged.adjustments.exposure).toBe(20);
  });
});

describe("describing a look", () => {
  it("counts adjustments that moved and notices curves", () => {
    expect(changedAdjustmentCount(copyLook(warm()))).toBe(3);
    expect(hasCurves(copyLook(warm()))).toBe(true);
    expect(describeLook(copyLook(warm()))).toBe("3 adjustments and curves");
  });
  it("uses the singular, and says so when only curves moved", () => {
    expect(describeLook(copyLook(edit({ adjustments: { ...DEFAULT_ADJUSTMENTS, blur: 5 } })))).toBe(
      "1 adjustment",
    );
    expect(describeLook({ adjustments: { ...DEFAULT_ADJUSTMENTS }, curves: warm().curves })).toBe(
      "curves",
    );
  });
  it("recognises a plain look, and says there is nothing in it", () => {
    expect(isPlainLook(copyLook(edit()))).toBe(true);
    expect(describeLook(copyLook(edit()))).toBe("no changes");
    expect(isPlainLook(copyLook(warm()))).toBe(false);
  });
  it("does not call a look with only curves plain", () => {
    const curvesOnly = { adjustments: { ...DEFAULT_ADJUSTMENTS }, curves: warm().curves };
    expect(isPlainLook(curvesOnly)).toBe(false);
  });
  it("compares looks by value", () => {
    expect(sameLook(copyLook(warm()), copyLook(warm()))).toBe(true);
    expect(sameLook(copyLook(warm()), copyLook(edit()))).toBe(false);
  });
});

describe("normalizeLook", () => {
  it("repairs a damaged look instead of trusting it", () => {
    const look = normalizeLook({
      adjustments: { exposure: "loud", contrast: 9999, temperature: NaN },
      curves: { rgb: "nope" },
    })!;
    expect(look.adjustments.exposure).toBe(0);
    expect(look.adjustments.contrast).toBeLessThanOrEqual(100);
    expect(look.adjustments.temperature).toBe(0);
    expect(hasCurves(look)).toBe(false);
  });
  it("fills in adjustments an older save lacks", () => {
    const look = normalizeLook({ adjustments: { exposure: 10 } })!;
    expect(look.adjustments.exposure).toBe(10);
    expect(look.adjustments.gradeBalance).toBe(0);
  });
  it("refuses things that are not a look", () => {
    for (const bad of [null, undefined, 5, "x", [1, 2]]) expect(normalizeLook(bad)).toBeNull();
  });
  it("is idempotent", () => {
    const once = normalizeLook({ adjustments: { exposure: 10, contrast: 1e9 } })!;
    expect(normalizeLook(once)).toEqual(once);
  });
});

describe("remembering the copied look", () => {
  const fake = (initial?: string) => {
    const data = new Map<string, string>();
    if (initial !== undefined) data.set(LOOK_STORAGE_KEY, initial);
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("round-trips a look", () => {
    const s = fake();
    saveLook(copyLook(warm()), s);
    expect(loadLook(s)).toEqual(copyLook(warm()));
  });
  it("is null when nothing is saved, or what is saved is not a look", () => {
    expect(loadLook(fake())).toBeNull();
    expect(loadLook(fake("not json"))).toBeNull();
    expect(loadLook(fake("[1,2]"))).toBeNull();
  });
  it("copes with storage that is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadLook(broken)).toBeNull();
    expect(() => saveLook(copyLook(warm()), broken)).not.toThrow();
    expect(loadLook(null)).toBeNull();
    expect(() => saveLook(copyLook(warm()), null)).not.toThrow();
  });
});
