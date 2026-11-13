import { describe, expect, it } from "vitest";
import {
  SESSION_SCHEMA_VERSION,
  normalizeAdjustments,
  normalizeCrop,
  normalizeMaskLayers,
  normalizeSession,
  type NormalizedSession,
} from "./sessionSchema";
import {
  ADJUSTMENT_DEFS,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP,
  DEFAULT_EDIT_STATE,
  DEFAULT_LOCAL_ADJUSTMENTS,
} from "@/types/editor";

let counter = 0;
const makeId = () => `generated-${++counter}`;
const normalize = (raw: unknown) => normalizeSession(raw, makeId);
const must = (raw: unknown): NormalizedSession => {
  const result = normalize(raw);
  if (!result) throw new Error("expected a session");
  return result;
};

/** The oldest format: no schemaVersion, no maskSpace, no clone strokes, and only the first few adjustments. */
const oldestSave = () => ({
  imageBlob: "irrelevant",
  name: "a.jpg",
  type: "image/jpeg",
  edit: {
    adjustments: { exposure: 20, contrast: -10, saturation: 15, sharpness: 30 },
    crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
    rotation: 90,
    flipH: true,
  },
  maskLayers: [
    {
      id: "m1",
      name: "Sky",
      strokes: [{ x: 0.5, y: 0.4, radius: 0.2 }],
      adjustments: { exposure: -20, contrast: 0, saturation: 0, temperature: -30 },
    },
  ],
});

/** A save in today's format, written by the current app. */
const currentSave = () => ({
  imageBlob: "irrelevant",
  name: "b.png",
  type: "image/png",
  edit: {
    adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 12, satGreen: -40, sharpness: 55 },
    crop: { x: 0.05, y: 0.1, width: 0.8, height: 0.7 },
    rotation: 270,
    flipH: false,
    healStrokes: [{ x: 0.3, y: 0.3, dx: 0.1, dy: -0.05, radius: 0.04, softness: 60 }],
    curves: {
      rgb: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ],
      luma: [
        { x: 0, y: 0.05 },
        { x: 1, y: 1 },
      ],
    },
  },
  maskLayers: [
    {
      id: "layer-a",
      name: "Face",
      strokes: [
        { x: 0.5, y: 0.5, radius: 0.1, softness: 40, mode: "paint" as const },
        { x: 0.52, y: 0.5, radius: 0.05, mode: "erase" as const },
      ],
      adjustments: {
        ...DEFAULT_LOCAL_ADJUSTMENTS,
        exposure: 15,
        contrast: 5,
        saturation: -10,
        temperature: 8,
      },
    },
  ],
  maskSpace: "source" as const,
  schemaVersion: SESSION_SCHEMA_VERSION,
});

describe("opening saves from older builds", () => {
  it("fills in adjustments an old save never had (the M8 failure mode: undefined -> NaN)", () => {
    const { edit } = must(oldestSave());
    expect(Object.keys(edit.adjustments).sort()).toEqual(Object.keys(DEFAULT_ADJUSTMENTS).sort());
    expect(edit.adjustments.exposure).toBe(20);
    expect(edit.adjustments.sharpness).toBe(30);
    expect(edit.adjustments.satGreen).toBe(0);
    expect(edit.adjustments.highlights).toBe(0);
    for (const value of Object.values(edit.adjustments)) expect(Number.isFinite(value)).toBe(true);
  });

  it("gives an old save with no clone strokes an empty list and keeps its crop and rotation", () => {
    const { edit } = must(oldestSave());
    expect(edit.healStrokes).toEqual([]);
    expect(edit.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    expect(edit.rotation).toBe(90);
    expect(edit.flipH).toBe(true);
  });

  it("flags the oldest masks as frame-relative so they still get migrated", () => {
    expect(must(oldestSave()).maskSpace).toBe("frame");
  });

  it("treats source-space masks as current, by the old flag or by the version", () => {
    expect(must({ ...oldestSave(), maskSpace: "source" }).maskSpace).toBe("source");
    expect(must({ ...oldestSave(), schemaVersion: 1 }).maskSpace).toBe("source");
  });

  it("keeps the layers of an old save intact", () => {
    const { maskLayers } = must(oldestSave());
    // The save predates the newer local sliders, so they read as 0; everything else is untouched.
    expect(maskLayers).toEqual(
      oldestSave().maskLayers.map((l) => ({
        ...l,
        adjustments: { ...DEFAULT_LOCAL_ADJUSTMENTS, ...l.adjustments },
      })),
    );
  });
});

describe("local sliders added after a save was written", () => {
  const layerWith = (adjustments: unknown) =>
    normalizeMaskLayers([{ id: "a", name: "A", strokes: [], adjustments }], makeId)[0]!.adjustments;

  it("read as 0 when the save has none of them", () => {
    expect(layerWith({ exposure: 10 })).toEqual({ ...DEFAULT_LOCAL_ADJUSTMENTS, exposure: 10 });
  });

  it("keep their values, each clamped to its own slider's range", () => {
    expect(
      layerWith({ highlights: -40, shadows: 500, tint: -500, clarity: 25, sharpness: 60 }),
    ).toEqual({
      ...DEFAULT_LOCAL_ADJUSTMENTS,
      highlights: -40,
      shadows: 100,
      tint: -100,
      clarity: 25,
      sharpness: 60,
    });
  });

  it("have no negative sharpness (the slider starts at 0), and repair non-numbers", () => {
    expect(layerWith({ sharpness: -30 }).sharpness).toBe(0);
    expect(layerWith({ sharpness: 400 }).sharpness).toBe(100);
    expect(layerWith({ highlights: "lots", tint: null, clarity: Number.NaN })).toEqual(
      DEFAULT_LOCAL_ADJUSTMENTS,
    );
  });
});

describe("opening a save from today's build", () => {
  it("round-trips unchanged", () => {
    const saved = currentSave();
    const result = must(saved);
    expect(result.edit).toEqual(saved.edit);
    expect(result.maskLayers).toEqual(saved.maskLayers);
    expect(result.maskSpace).toBe("source");
    expect(result.fromNewerVersion).toBe(false);
  });

  it("is idempotent: normalising its own output changes nothing", () => {
    const once = must(oldestSave());
    const again = must({ edit: once.edit, maskLayers: once.maskLayers, schemaVersion: 1 });
    expect(again.edit).toEqual(once.edit);
    expect(again.maskLayers).toEqual(once.maskLayers);
  });

  it("does not add optional stroke fields that weren't saved", () => {
    const { maskLayers } = must(currentSave());
    expect(Object.keys(maskLayers[0]!.strokes[1]!).sort()).toEqual(["mode", "radius", "x", "y"]);
  });
});

describe("saves from before tone curves existed", () => {
  it("get straight curves, with everything else intact", () => {
    const { curves, ...withoutCurves } = currentSave().edit;
    expect(curves).toBeDefined();
    const result = must({ ...currentSave(), edit: withoutCurves });
    expect(result.edit.curves).toEqual({
      rgb: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      luma: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    expect(result.edit.adjustments.exposure).toBe(12);
    expect(result.edit.healStrokes).toHaveLength(1);
  });

  it("the oldest saves get straight curves too", () => {
    expect(must(oldestSave()).edit.curves).toEqual(DEFAULT_EDIT_STATE.curves);
  });

  it("repairs damaged curves instead of failing", () => {
    const result = must({
      edit: {
        curves: {
          rgb: [{ x: 0.9, y: 0.2 }, { x: "a", y: 1 }, { x: 0.1, y: 0.8 }, null],
          luma: "nonsense",
        },
      },
    });
    expect(result.edit.curves.rgb).toEqual([
      { x: 0, y: 0.8 },
      { x: 1, y: 0.2 },
    ]);
    expect(result.edit.curves.luma).toEqual(DEFAULT_EDIT_STATE.curves.luma);
  });
});

describe("opening a save from a newer build", () => {
  it("restores what it understands and reports the version gap", () => {
    const saved = {
      ...currentSave(),
      schemaVersion: SESSION_SCHEMA_VERSION + 5,
      edit: {
        ...currentSave().edit,
        adjustments: { ...currentSave().edit.adjustments, futureKnob: 30, curves: [1, 2] },
        somethingNew: { a: 1 },
      },
    };
    const result = must(saved);
    expect(result.fromNewerVersion).toBe(true);
    expect(result.edit.adjustments.exposure).toBe(12);
    expect(result.edit.adjustments).not.toHaveProperty("futureKnob");
    expect(result.edit).not.toHaveProperty("somethingNew");
  });
});

describe("damaged or hand-edited saves", () => {
  it("rejects things that aren't a session at all", () => {
    for (const junk of [null, undefined, 42, "text", [], true]) expect(normalize(junk)).toBeNull();
  });

  it("falls back to a default edit when the edit is missing or wrong", () => {
    for (const edit of [undefined, null, "x", 5, []]) {
      const result = must({ imageBlob: "b", edit });
      expect(result.edit).toEqual(DEFAULT_EDIT_STATE);
    }
  });

  it("replaces non-numbers and non-finite numbers with defaults, and clamps to slider ranges", () => {
    const adjustments = normalizeAdjustments({
      exposure: "50",
      contrast: Number.NaN,
      saturation: Number.POSITIVE_INFINITY,
      brightness: 9999,
      shadows: -9999,
      blur: -5,
      highlights: null,
    });
    expect(adjustments.exposure).toBe(0);
    expect(adjustments.contrast).toBe(0);
    expect(adjustments.saturation).toBe(0);
    expect(adjustments.highlights).toBe(0);
    const range = (key: string) => ADJUSTMENT_DEFS.find((d) => d.key === key)!;
    expect(adjustments.brightness).toBe(range("brightness").max);
    expect(adjustments.shadows).toBe(range("shadows").min);
    expect(adjustments.blur).toBe(range("blur").min);
  });

  it("keeps colour grading values inside their own ranges (hue 0-360, saturation 0-100)", () => {
    const adjustments = normalizeAdjustments({
      gradeShadowsHue: 500,
      gradeMidtonesHue: -20,
      gradeHighlightsSat: 250,
      gradeShadowsSat: -5,
      gradeMidtonesLum: 140,
      gradeBalance: -300,
      gradeHighlightsHue: 215,
    });
    expect(adjustments.gradeShadowsHue).toBe(360);
    expect(adjustments.gradeMidtonesHue).toBe(0);
    expect(adjustments.gradeHighlightsSat).toBe(100);
    expect(adjustments.gradeShadowsSat).toBe(0);
    expect(adjustments.gradeMidtonesLum).toBe(100);
    expect(adjustments.gradeBalance).toBe(-100);
    expect(adjustments.gradeHighlightsHue).toBe(215);
  });

  it("repairs an out-of-bounds crop and resets an unusable one", () => {
    expect(normalizeCrop({ x: 0.8, y: -1, width: 0.5, height: 2 })).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(normalizeCrop({ x: 0, y: 0, width: 0, height: 0 }).width).toBe(0.01);
    expect(normalizeCrop({ x: "a", y: 0, width: 1, height: 1 })).toEqual(DEFAULT_CROP);
    expect(normalizeCrop(undefined)).toEqual(DEFAULT_CROP);
  });

  it("brings rotation back to a quarter turn between 0 and 270", () => {
    const rotationOf = (rotation: unknown) => must({ edit: { rotation } }).edit.rotation;
    expect(rotationOf(-90)).toBe(270);
    expect(rotationOf(450)).toBe(90);
    expect(rotationOf(180)).toBe(180);
    expect(rotationOf("x")).toBe(0);
    expect(rotationOf(Number.NaN)).toBe(0);
  });

  it("drops clone strokes it can't repair and defaults a missing softness", () => {
    const { edit } = must({
      edit: {
        healStrokes: [
          { x: 0.1, y: 0.1, dx: 0.1, dy: 0.1, radius: 0.05 },
          { x: "a", y: 0.1, dx: 0.1, dy: 0.1, radius: 0.05, softness: 10 },
          { x: 0.1, y: 0.1, dx: 0.1, dy: 0.1, radius: 0, softness: 10 },
          null,
          "stroke",
        ],
      },
    });
    expect(edit.healStrokes).toHaveLength(1);
    expect(edit.healStrokes[0]!.softness).toBe(30);
  });

  it("repairs layers: unique ids, default names, only usable strokes, numeric adjustments", () => {
    const { maskLayers } = must({
      maskLayers: [
        {
          id: "same",
          name: "One",
          strokes: [{ x: 0.1, y: 0.1, radius: 0.1 }, { x: 1 }, 7],
          adjustments: { exposure: "x", contrast: 500 },
        },
        { id: "same", strokes: "nope", adjustments: null },
        { name: "No id", strokes: [] },
        null,
        "layer",
      ],
    });
    expect(maskLayers).toHaveLength(3);
    expect(new Set(maskLayers.map((l) => l.id)).size).toBe(3);
    expect(maskLayers[0]!.strokes).toHaveLength(1);
    expect(maskLayers[0]!.adjustments).toEqual({ ...DEFAULT_LOCAL_ADJUSTMENTS, contrast: 100 });
    expect(maskLayers[1]!.name).toBe("Area 2");
    expect(maskLayers[1]!.strokes).toEqual([]);
    expect(maskLayers[2]!.name).toBe("No id");
  });

  it("treats a non-array maskLayers as none", () => {
    expect(must({ maskLayers: "x" }).maskLayers).toEqual([]);
    expect(must({}).maskLayers).toEqual([]);
  });
});

describe("fuzzing a valid save with junk", () => {
  const JUNK: unknown[] = [
    Number.NaN,
    Infinity,
    -Infinity,
    "abc",
    "5",
    null,
    undefined,
    {},
    [],
    true,
    -1e9,
    1e9,
    { x: "a" },
    [1, 2, 3],
    0,
    -0.5,
  ];

  let seed = 20261106;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;

  /** Replaces one random value, anywhere in the structure, with junk. */
  function corrupt(root: Record<string, unknown>) {
    let node: unknown = root;
    for (;;) {
      if (typeof node !== "object" || node === null) return;
      const keys = Object.keys(node);
      if (keys.length === 0) return;
      const key = pick(keys);
      const child = (node as Record<string, unknown>)[key];
      if (typeof child !== "object" || child === null || rnd() < 0.35) {
        (node as Record<string, unknown>)[key] = pick(JUNK);
        return;
      }
      node = child;
    }
  }

  function assertUsable(n: NormalizedSession) {
    for (const [key, value] of Object.entries(n.edit.adjustments)) {
      const range = ADJUSTMENT_DEFS.find((d) => d.key === key)!;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(range.min);
      expect(value).toBeLessThanOrEqual(range.max);
    }
    const c = n.edit.crop;
    expect(c.width).toBeGreaterThanOrEqual(0.01);
    expect(c.height).toBeGreaterThanOrEqual(0.01);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.height).toBeLessThanOrEqual(1 + 1e-9);
    expect([0, 90, 180, 270]).toContain(n.edit.rotation);
    expect(typeof n.edit.flipH).toBe("boolean");
    for (const curve of [n.edit.curves.rgb, n.edit.curves.luma]) {
      expect(curve.length).toBeGreaterThanOrEqual(2);
      expect(curve[0]!.x).toBe(0);
      expect(curve[curve.length - 1]!.x).toBe(1);
      for (let i = 0; i < curve.length; i++) {
        expect(Number.isFinite(curve[i]!.y)).toBe(true);
        expect(curve[i]!.y).toBeGreaterThanOrEqual(0);
        expect(curve[i]!.y).toBeLessThanOrEqual(1);
        if (i > 0) expect(curve[i]!.x).toBeGreaterThan(curve[i - 1]!.x);
      }
    }
    for (const s of n.edit.healStrokes) {
      for (const v of [s.x, s.y, s.dx, s.dy, s.radius, s.softness])
        expect(Number.isFinite(v)).toBe(true);
      expect(s.radius).toBeGreaterThan(0);
    }
    expect(new Set(n.maskLayers.map((l) => l.id)).size).toBe(n.maskLayers.length);
    for (const layer of n.maskLayers) {
      expect(typeof layer.name).toBe("string");
      for (const v of Object.values(layer.adjustments)) expect(Number.isFinite(v)).toBe(true);
      for (const s of layer.strokes) {
        for (const v of [s.x, s.y, s.radius]) expect(Number.isFinite(v)).toBe(true);
        expect(s.radius).toBeGreaterThan(0);
      }
    }
  }

  it("never throws, always returns something the editor can use, and is stable when repeated", () => {
    for (let i = 0; i < 400; i++) {
      const save = structuredClone(currentSave()) as Record<string, unknown>;
      for (let k = 0, n = 1 + Math.floor(rnd() * 4); k < n; k++) corrupt(save);
      const result = normalize(save);
      if (!result) continue; // the whole save was replaced by junk
      assertUsable(result);
      const again = must({ edit: result.edit, maskLayers: result.maskLayers, schemaVersion: 1 });
      expect(again.edit).toEqual(result.edit);
      expect(again.maskLayers).toEqual(result.maskLayers);
    }
  });
});

describe("mask model v2 in saved sessions", () => {
  const adjustments = { ...DEFAULT_LOCAL_ADJUSTMENTS, exposure: 5 };
  const radial = { kind: "radial", cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.1, angle: 45, feather: 20 };
  const linear = { kind: "linear", x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 };
  const layers = (raw: unknown) => normalizeMaskLayers(raw, makeId);

  it("round-trips gradient layers, invert and visible", () => {
    const saved = [
      { id: "a", name: "Sky", strokes: [], adjustments, shape: linear, invert: true },
      { id: "b", name: "Face", strokes: [], adjustments, shape: radial, visible: false },
    ];
    expect(layers(saved)).toEqual(saved);
    expect(layers(layers(saved))).toEqual(layers(saved));
  });

  it("reads layers without the new fields exactly as before (no invert/visible keys added)", () => {
    const old = [{ id: "a", name: "A", strokes: [{ x: 0.5, y: 0.5, radius: 0.05 }], adjustments }];
    const out = layers(old);
    expect(out).toEqual(old);
    expect("invert" in out[0]!).toBe(false);
    expect("visible" in out[0]!).toBe(false);
    expect("shape" in out[0]!).toBe(false);
  });

  it("stores invert and visible only when they differ from the default", () => {
    const out = layers([
      { id: "a", name: "A", strokes: [], adjustments, invert: false, visible: true },
      { id: "b", name: "B", strokes: [], adjustments, invert: "yes", visible: "no" },
    ]);
    for (const l of out) {
      expect("invert" in l).toBe(false);
      expect("visible" in l).toBe(false);
    }
  });

  it("clamps a damaged shape and drops one that cannot be repaired, keeping the layer", () => {
    const out = layers([
      { id: "a", name: "A", strokes: [], adjustments, shape: { ...radial, rx: 50, feather: 900 } },
      {
        id: "b",
        name: "B",
        strokes: [{ x: 0.5, y: 0.5, radius: 0.05 }],
        adjustments,
        shape: { kind: "linear", x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 },
      },
      { id: "c", name: "C", strokes: [], adjustments, shape: "oval" },
    ]);
    expect(out[0]!.shape).toMatchObject({ kind: "radial", rx: 2, feather: 100 });
    // Unrepairable: the layer stays (with its adjustments) as a brush layer and keeps its strokes.
    expect("shape" in out[1]!).toBe(false);
    expect(out[1]!.strokes).toHaveLength(1);
    expect(out[1]!.adjustments.exposure).toBe(5);
    expect("shape" in out[2]!).toBe(false);
  });

  it("gives a gradient layer no strokes, even if the save has some", () => {
    const [layer] = layers([
      {
        id: "a",
        name: "A",
        strokes: [{ x: 0.5, y: 0.5, radius: 0.05 }],
        adjustments,
        shape: radial,
      },
    ]);
    expect(layer!.shape).toBeDefined();
    expect(layer!.strokes).toEqual([]);
  });
});
