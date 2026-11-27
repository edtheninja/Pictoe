import { describe, expect, it } from "vitest";
import {
  FALLBACK_PRESET_NAME,
  MAX_PRESETS_PER_FILE,
  MAX_PRESET_FILE_BYTES,
  MAX_PRESET_NAME_LENGTH,
  PRESET_FILE_FORMAT,
  PRESET_FILE_VERSION,
  cleanPresetName,
  describeImport,
  freeName,
  parsePresetFile,
  planImport,
  presetFileName,
  serializePresets,
  type PresetDraft,
} from "./presetFile";
import { DEFAULT_ADJUSTMENTS, identityCurves, type CurvesState } from "@/types/editor";
import type { StoredPreset } from "./presets";

const stored = (
  name: string,
  adjustments: StoredPreset["adjustments"],
  id = name,
): StoredPreset => ({
  id,
  name,
  adjustments,
});
const draft = (name: string, over: Partial<typeof DEFAULT_ADJUSTMENTS> = {}): PresetDraft => ({
  name,
  adjustments: { ...DEFAULT_ADJUSTMENTS, ...over },
});
const file = (presets: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, presets, ...extra });
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe("serializePresets / parsePresetFile", () => {
  it("round-trips presets", () => {
    const text = serializePresets([
      stored("Warm", { temperature: 20, contrast: -5 }),
      stored("Flat", { exposure: 10 }),
    ]);
    const parsed = parsePresetFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.presets.map((p) => p.name)).toEqual(["Warm", "Flat"]);
    expect(parsed.presets[0]!.adjustments.temperature).toBe(20);
    expect(parsed.presets[0]!.adjustments.contrast).toBe(-5);
    expect(parsed.presets[0]!.adjustments.exposure).toBe(0);
    expect(parsed.skipped).toBe(0);
    expect(parsed.fromNewerVersion).toBe(false);
  });

  it("writes only what differs from untouched, and no ids", () => {
    const full = { ...DEFAULT_ADJUSTMENTS, exposure: 12 };
    const out = JSON.parse(serializePresets([stored("A", full, "secret-id")]));
    expect(out.format).toBe(PRESET_FILE_FORMAT);
    expect(out.version).toBe(PRESET_FILE_VERSION);
    expect(out.presets[0].adjustments).toEqual({ exposure: 12 });
    expect(JSON.stringify(out)).not.toContain("secret-id");
  });

  it("repairs values: unknown keys dropped, ranges clamped, bad numbers untouched", () => {
    const parsed = parsePresetFile(
      file([{ name: "X", adjustments: { exposure: 1e9, contrast: "loud", bogus: 5, tint: NaN } }]),
    );
    if (!parsed.ok) throw new Error("expected ok");
    const a = parsed.presets[0]!.adjustments;
    expect(a.exposure).toBeLessThanOrEqual(100);
    expect(a.exposure).toBeGreaterThan(0);
    expect(a.contrast).toBe(0);
    expect(a.tint).toBe(0);
    expect(a).not.toHaveProperty("bogus");
  });

  it("drops any id the file carries, so an import can never reuse one", () => {
    const parsed = parsePresetFile(
      file([{ id: "existing-id", name: "A", adjustments: { exposure: 1 } }]),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(Object.keys(parsed.presets[0]!)).toEqual(["name", "adjustments"]);
  });

  it("skips entries that are not presets and counts them", () => {
    const parsed = parsePresetFile(
      file([
        { name: "Ok", adjustments: { exposure: 1 } },
        5,
        null,
        "x",
        { name: "No adjustments" },
      ]),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.skipped).toBe(4);
  });

  it("limits how many presets one file can bring in", () => {
    const many = Array.from({ length: MAX_PRESETS_PER_FILE + 5 }, (_, i) => ({
      name: `P${i}`,
      adjustments: { exposure: 1 },
    }));
    const parsed = parsePresetFile(file(many));
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets).toHaveLength(MAX_PRESETS_PER_FILE);
    expect(parsed.skipped).toBe(5);
  });

  it("flags a file from a newer version but still reads it", () => {
    const parsed = parsePresetFile(
      file([{ name: "A", adjustments: { exposure: 3 } }], { version: 99 }),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.fromNewerVersion).toBe(true);
    expect(parsed.presets).toHaveLength(1);
  });

  it("says why a file can't be used", () => {
    expect(parsePresetFile("not json")).toEqual({ ok: false, reason: "not-json" });
    expect(parsePresetFile("[1,2]")).toEqual({ ok: false, reason: "not-a-preset-file" });
    expect(parsePresetFile(JSON.stringify({ format: "other", presets: [] }))).toEqual({
      ok: false,
      reason: "not-a-preset-file",
    });
    expect(parsePresetFile(file({ not: "a list" }))).toEqual({
      ok: false,
      reason: "not-a-preset-file",
    });
    expect(parsePresetFile(file([]))).toEqual({ ok: false, reason: "empty" });
    expect(parsePresetFile("x".repeat(MAX_PRESET_FILE_BYTES + 1))).toEqual({
      ok: false,
      reason: "too-big",
    });
  });

  it("is not fooled by __proto__ keys", () => {
    const parsed = parsePresetFile(
      '{"format":"pictoe-presets","presets":[{"name":"P","adjustments":{"__proto__":{"exposure":50},"constructor":1}}]}',
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets[0]!.adjustments.exposure).toBe(0);
    expect(({} as Record<string, unknown>)["exposure"]).toBeUndefined();
  });
});

const bent = (): CurvesState => ({
  rgb: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.7 },
    { x: 1, y: 1 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
});

describe("version 2: presets with curves", () => {
  it("is written as version 2", () => {
    expect(PRESET_FILE_VERSION).toBe(2);
    expect(JSON.parse(serializePresets([stored("A", {})])).version).toBe(2);
  });

  it("round-trips curves", () => {
    const parsed = parsePresetFile(
      serializePresets([{ ...stored("A", { exposure: 4 }), curves: bent() }]),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets[0]!.curves).toEqual(bent());
    expect(parsed.fromNewerVersion).toBe(false);
  });

  it("writes straight curves too: straight is not the same as no curves", () => {
    const text = serializePresets([{ ...stored("Flat", {}), curves: identityCurves() }]);
    expect(JSON.parse(text).presets[0].curves).toEqual(identityCurves());
    const parsed = parsePresetFile(text);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets[0]!.curves).toEqual(identityCurves());
  });

  it("writes no curves key for a preset that has none", () => {
    const out = JSON.parse(serializePresets([stored("A", { exposure: 1 })]));
    expect(out.presets[0]).not.toHaveProperty("curves");
    const parsed = parsePresetFile(serializePresets([stored("A", { exposure: 1 })]));
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets[0]).not.toHaveProperty("curves");
  });

  it("still reads a version 1 file: its presets have no curves", () => {
    const v1 = JSON.stringify({
      format: PRESET_FILE_FORMAT,
      version: 1,
      presets: [{ name: "Old", adjustments: { exposure: 5 } }],
    });
    const parsed = parsePresetFile(v1);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.presets[0]!.adjustments.exposure).toBe(5);
    expect(parsed.presets[0]).not.toHaveProperty("curves");
    expect(parsed.fromNewerVersion).toBe(false);
  });

  it("treats curves that are not an object as no curves, never as straight ones", () => {
    for (const bad of [5, "x", [1, 2], null, true]) {
      const parsed = parsePresetFile(file([{ name: "A", adjustments: {}, curves: bad }]));
      if (!parsed.ok) throw new Error("expected ok");
      expect(parsed.presets[0]).not.toHaveProperty("curves");
    }
  });

  it("repairs damaged curve points", () => {
    const parsed = parsePresetFile(
      file([
        { name: "A", adjustments: {}, curves: { rgb: [{ x: -3, y: 9 }, "x", { x: 4, y: -1 }] } },
      ]),
    );
    if (!parsed.ok) throw new Error("expected ok");
    for (const p of [...parsed.presets[0]!.curves!.rgb, ...parsed.presets[0]!.curves!.luma]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("carries curves through an import, and compares them when deduplicating", () => {
    const withCurves = { ...draft("A", { exposure: 1 }), curves: bent() };
    const first = planImport([], [withCurves], ids());
    expect(first.toAdd[0]!.curves).toEqual(bent());

    // identical, curves included: skipped
    expect(planImport(first.toAdd, [withCurves], ids()).duplicates).toBe(1);

    // same name and adjustments but different curves: a different preset, kept under a free name
    const other = { ...withCurves, curves: identityCurves() };
    const plan = planImport(first.toAdd, [other], ids());
    expect(plan.duplicates).toBe(0);
    expect(plan.toAdd.map((p) => p.name)).toEqual(["A 2"]);

    // no curves is not the same as straight curves
    const without = draft("A", { exposure: 1 });
    expect(planImport(first.toAdd, [without], ids()).duplicates).toBe(0);
    const straight = { ...without, curves: identityCurves() };
    const savedStraight = planImport([], [straight], ids()).toAdd;
    expect(planImport(savedStraight, [without], ids()).duplicates).toBe(0);
    expect(planImport(savedStraight, [straight], ids()).duplicates).toBe(1);
  });

  it("an old saved preset (no curves) and the same preset imported from a v1 file are duplicates", () => {
    const saved = [stored("Old", { exposure: 5 })];
    const v1 = parsePresetFile(
      JSON.stringify({
        format: PRESET_FILE_FORMAT,
        version: 1,
        presets: [{ name: "Old", adjustments: { exposure: 5 } }],
      }),
    );
    if (!v1.ok) throw new Error("expected ok");
    expect(planImport(saved, v1.presets, ids()).duplicates).toBe(1);
  });
});

describe("cleanPresetName", () => {
  it("cleans, trims and falls back", () => {
    expect(cleanPresetName("  Warm\u0000   film \n")).toBe("Warm film");
    expect(cleanPresetName("")).toBe(FALLBACK_PRESET_NAME);
    expect(cleanPresetName("   ")).toBe(FALLBACK_PRESET_NAME);
    expect(cleanPresetName(42)).toBe(FALLBACK_PRESET_NAME);
  });
  it("limits the length by whole characters", () => {
    expect(Array.from(cleanPresetName("😀".repeat(200)))).toHaveLength(MAX_PRESET_NAME_LENGTH);
  });
});

describe("freeName", () => {
  it("keeps a free name and numbers a taken one", () => {
    expect(freeName("A", new Set())).toBe("A");
    expect(freeName("A", new Set(["a"]))).toBe("A 2");
    expect(freeName("A", new Set(["a", "a 2", "a 3"]))).toBe("A 4");
  });
  it("stays within the length limit", () => {
    const long = "x".repeat(MAX_PRESET_NAME_LENGTH);
    const out = freeName(long, new Set([long.toLowerCase()]));
    expect(Array.from(out).length).toBeLessThanOrEqual(MAX_PRESET_NAME_LENGTH);
    expect(out.endsWith(" 2")).toBe(true);
  });
});

describe("planImport", () => {
  it("adds new presets with new ids", () => {
    const plan = planImport([], [draft("A", { exposure: 5 })], ids());
    expect(plan.toAdd).toEqual([{ id: "new-1", name: "A", adjustments: { exposure: 5 } }]);
    expect(plan.duplicates).toBe(0);
  });

  it("importing the same file twice adds nothing the second time", () => {
    const text = serializePresets([stored("A", { exposure: 5 }), stored("B", { contrast: 9 })]);
    const parsed = parsePresetFile(text);
    if (!parsed.ok) throw new Error("expected ok");
    const first = planImport([], parsed.presets, ids());
    expect(first.toAdd).toHaveLength(2);
    const second = planImport(first.toAdd, parsed.presets, ids());
    expect(second.toAdd).toHaveLength(0);
    expect(second.duplicates).toBe(2);
  });

  it("treats a full stored preset and a compact one as the same", () => {
    const existing = [stored("A", { ...DEFAULT_ADJUSTMENTS, exposure: 5 })];
    const plan = planImport(existing, [draft("a", { exposure: 5 })], ids());
    expect(plan.duplicates).toBe(1);
    expect(plan.toAdd).toHaveLength(0);
  });

  it("keeps a same-named preset that differs, under a free name", () => {
    const existing = [stored("A", { exposure: 5 })];
    const plan = planImport(existing, [draft("A", { exposure: 9 })], ids());
    expect(plan.toAdd.map((p) => p.name)).toEqual(["A 2"]);
    expect(plan.renamed).toBe(1);
  });

  it("copes with duplicates and clashes inside one file", () => {
    const plan = planImport(
      [],
      [draft("A", { exposure: 1 }), draft("A", { exposure: 1 }), draft("A", { exposure: 2 })],
      ids(),
    );
    expect(plan.toAdd.map((p) => p.name)).toEqual(["A", "A 2"]);
    expect(plan.duplicates).toBe(1);
  });

  it("never uses an id from the file", () => {
    const plan = planImport(
      [stored("A", { exposure: 1 }, "same-id")],
      [draft("B", { exposure: 2 })],
      ids(),
    );
    expect(plan.toAdd[0]!.id).toBe("new-1");
  });
});

describe("messages and file names", () => {
  it("describes an import", () => {
    expect(describeImport({ toAdd: [], duplicates: 2, renamed: 0 }, 0, false)).toBe(
      "No new presets. 2 you already had.",
    );
    const one = { toAdd: [stored("A", {})], duplicates: 0, renamed: 1 };
    expect(describeImport(one, 1, true)).toBe(
      "Added 1 preset. 1 got a new name because yours was taken. 1 couldn't be read and was skipped. This file is from a newer Pictoe, so some of it may be missing.",
    );
  });
  it("names the file after the local date", () => {
    expect(presetFileName(new Date(2026, 10, 5))).toBe("pictoe-presets-2026-11-05.json");
  });
});
