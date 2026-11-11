import { describe, expect, it } from "vitest";
import { editorInitialState, editorReducer as reducer, type EditorState } from "./editorReducer";
import { DEFAULT_EDIT_STATE, type MaskStroke } from "@/types/editor";
import { defaultShape } from "@/engine/image/maskShapes";

const fresh = (): EditorState => ({ ...editorInitialState });

/** A committed exposure edit, as if a slider were moved and released. */
const withExposure = (state: EditorState, exposure: number): EditorState =>
  reducer(state, {
    type: "applyEdit",
    edit: { adjustments: { ...state.edit.adjustments, exposure } },
  });

const exposureOf = (state: EditorState) => state.edit.adjustments.exposure;
const stroke = (): MaskStroke => ({ x: 0.5, y: 0.5, radius: 0.06 });

describe("global history", () => {
  it("a committed edit records the previous state", () => {
    const s = withExposure(fresh(), 10);
    expect(exposureOf(s)).toBe(10);
    expect(s.past).toHaveLength(1);
    expect(s.past[0]).toEqual(DEFAULT_EDIT_STATE);
  });

  it("setAdjustment updates live without touching history", () => {
    const s = reducer(fresh(), { type: "setAdjustment", key: "contrast", value: 25 });
    expect(s.edit.adjustments.contrast).toBe(25);
    expect(s.past).toHaveLength(0);
  });

  it("commit records a snapshot only when something actually changed", () => {
    const base = fresh();
    expect(reducer(base, { type: "commit", snapshot: base.edit })).toBe(base);

    const live = reducer(base, { type: "setAdjustment", key: "exposure", value: 30 });
    const committed = reducer(live, { type: "commit", snapshot: base.edit });
    expect(committed.past).toHaveLength(1);
    expect(exposureOf(committed)).toBe(30);
  });

  it("undo and redo round-trip", () => {
    const s2 = withExposure(withExposure(fresh(), 10), 20);
    const undone = reducer(s2, { type: "undo" });
    expect(exposureOf(undone)).toBe(10);
    expect(undone.past).toHaveLength(1);
    expect(undone.future).toHaveLength(1);

    const redone = reducer(undone, { type: "redo" });
    expect(exposureOf(redone)).toBe(20);
    expect(redone.past).toHaveLength(2);
    expect(redone.future).toHaveLength(0);
  });

  it("a new edit after undo clears the redo stack", () => {
    const undone = reducer(withExposure(withExposure(fresh(), 10), 20), { type: "undo" });
    expect(withExposure(undone, 5).future).toHaveLength(0);
  });

  it("undo and redo with nothing to do leave the state untouched", () => {
    const base = fresh();
    expect(reducer(base, { type: "undo" })).toBe(base);
    expect(reducer(base, { type: "redo" })).toBe(base);
  });

  it("history is capped at 60 entries", () => {
    let s = fresh();
    for (let i = 1; i <= 70; i++) s = withExposure(s, i);
    expect(s.past).toHaveLength(60);
    expect(exposureOf(s)).toBe(70);
  });

  it("resetAll restores defaults but stays undoable", () => {
    const edited = withExposure(fresh(), 10);
    const reset = reducer(edited, { type: "resetAll" });
    expect(reset.edit).toEqual(DEFAULT_EDIT_STATE);
    expect(exposureOf(reducer(reset, { type: "undo" }))).toBe(10);
  });

  it("closeImage returns to the initial state", () => {
    expect(reducer(withExposure(fresh(), 10), { type: "closeImage" })).toEqual(editorInitialState);
  });
});

describe("jumpTo (history panel)", () => {
  // timeline: 0 · 1 · 2 · 3, currently at 3
  const s3 = [1, 2, 3].reduce((s, v) => withExposure(s, v), fresh());

  it("jumps backward, rebuilding past and future", () => {
    const back = reducer(s3, { type: "jumpTo", index: 0 });
    expect(exposureOf(back)).toBe(0);
    expect(back.past).toHaveLength(0);
    expect(back.future.map((e) => e.adjustments.exposure)).toEqual([1, 2, 3]);

    const middle = reducer(s3, { type: "jumpTo", index: 1 });
    expect(exposureOf(middle)).toBe(1);
    expect(middle.past).toHaveLength(1);
    expect(middle.future.map((e) => e.adjustments.exposure)).toEqual([2, 3]);
  });

  it("jumps forward again", () => {
    const back = reducer(s3, { type: "jumpTo", index: 0 });
    const forward = reducer(back, { type: "jumpTo", index: 3 });
    expect(exposureOf(forward)).toBe(3);
    expect(forward.past).toHaveLength(3);
    expect(forward.future).toHaveLength(0);
  });

  it("does nothing when jumping to the current entry", () => {
    expect(reducer(s3, { type: "jumpTo", index: 3 })).toBe(s3);
  });

  it("clamps out-of-range indexes", () => {
    expect(exposureOf(reducer(s3, { type: "jumpTo", index: -5 }))).toBe(0);
    const back = reducer(s3, { type: "jumpTo", index: 0 });
    expect(exposureOf(reducer(back, { type: "jumpTo", index: 99 }))).toBe(3);
  });
});

describe("local areas", () => {
  const withLayer = () => reducer(fresh(), { type: "addMaskLayer" });

  it("addMaskLayer creates a named, active, empty layer", () => {
    const s = withLayer();
    const layer = s.maskLayers[0]!;
    expect(layer.name).toBe("Area 1");
    expect(layer.strokes).toEqual([]);
    expect(Object.values(layer.adjustments).every((v) => v === 0)).toBe(true);
    expect(s.activeMaskLayerId).toBe(layer.id);
  });

  it("names later layers sequentially", () => {
    const two = reducer(withLayer(), { type: "addMaskLayer" });
    expect(two.maskLayers.map((l) => l.name)).toEqual(["Area 1", "Area 2"]);
  });

  it("painting adds a stroke to the target layer only", () => {
    const two = reducer(withLayer(), { type: "addMaskLayer" });
    const painted = reducer(two, {
      type: "paintMaskStroke",
      id: two.maskLayers[0]!.id,
      stroke: stroke(),
    });
    expect(painted.maskLayers[0]!.strokes).toHaveLength(1);
    expect(painted.maskLayers[1]!.strokes).toHaveLength(0);
  });

  it("setMaskLayerAdjustment changes one value on one layer", () => {
    const two = reducer(withLayer(), { type: "addMaskLayer" });
    const s = reducer(two, {
      type: "setMaskLayerAdjustment",
      id: two.maskLayers[1]!.id,
      key: "exposure",
      value: 40,
    });
    expect(s.maskLayers[1]!.adjustments.exposure).toBe(40);
    expect(s.maskLayers[0]!.adjustments.exposure).toBe(0);
    expect(s.maskLayers[1]!.adjustments.contrast).toBe(0);
  });

  it("deleting the active layer clears the selection; unknown ids are ignored", () => {
    const s = withLayer();
    const deleted = reducer(s, { type: "deleteMaskLayer", id: s.maskLayers[0]!.id });
    expect(deleted.maskLayers).toHaveLength(0);
    expect(deleted.activeMaskLayerId).toBeNull();
    expect(reducer(s, { type: "deleteMaskLayer", id: "nope" })).toBe(s);
  });

  it("undoMask and redoMask step through layer changes", () => {
    const s = withLayer();
    const undone = reducer(s, { type: "undoMask" });
    expect(undone.maskLayers).toHaveLength(0);
    const redone = reducer(undone, { type: "redoMask" });
    expect(redone.maskLayers[0]!.id).toBe(s.maskLayers[0]!.id);
    expect(reducer(fresh(), { type: "undoMask" }).maskLayers).toHaveLength(0);
  });

  it("a stroke can be undone once its start was recorded", () => {
    let s = withLayer();
    s = reducer(s, { type: "recordMaskHistory" });
    s = reducer(s, { type: "paintMaskStroke", id: s.maskLayers[0]!.id, stroke: stroke() });
    expect(s.maskLayers[0]!.strokes).toHaveLength(1);
    s = reducer(s, { type: "undoMask" });
    expect(s.maskLayers[0]!.strokes).toHaveLength(0);
  });

  it("local-area edits never touch the global history", () => {
    const s = withLayer();
    expect(s.past).toHaveLength(0);
    expect(s.edit).toEqual(DEFAULT_EDIT_STATE);
  });
});

describe("clone (heal) strokes", () => {
  const dab = (x = 0.3) => ({ x, y: 0.4, dx: 0.2, dy: 0, radius: 0.05, softness: 30 });

  it("addHealStroke appends live, without touching history", () => {
    const s = reducer(reducer(fresh(), { type: "addHealStroke", stroke: dab(0.1) }), {
      type: "addHealStroke",
      stroke: dab(0.2),
    });
    expect(s.edit.healStrokes.map((d) => d.x)).toEqual([0.1, 0.2]);
    expect(s.past).toHaveLength(0);
  });

  it("a whole drag is one undo step", () => {
    const base = fresh();
    const painted = [0.1, 0.2, 0.3].reduce(
      (st, x) => reducer(st, { type: "addHealStroke", stroke: dab(x) }),
      base,
    );
    const committed = reducer(painted, { type: "commit", snapshot: base.edit });
    expect(committed.past).toHaveLength(1);
    const undone = reducer(committed, { type: "undo" });
    expect(undone.edit.healStrokes).toEqual([]);
    expect(reducer(undone, { type: "redo" }).edit.healStrokes).toHaveLength(3);
  });

  it("choosing a new source clears the offset", () => {
    let s = reducer(fresh(), { type: "setHealSource", source: { x: 0.5, y: 0.5 } });
    s = reducer(s, { type: "setHealOffset", offset: { dx: 0.1, dy: 0.1 } });
    expect(s.healOffset).toEqual({ dx: 0.1, dy: 0.1 });
    s = reducer(s, { type: "setHealSource", source: { x: 0.2, y: 0.2 } });
    expect(s.healOffset).toBeNull();
  });

  it("resetAll removes clone strokes and can be undone", () => {
    const painted = reducer(fresh(), { type: "addHealStroke", stroke: dab() });
    const reset = reducer(painted, { type: "resetAll" });
    expect(reset.edit.healStrokes).toEqual([]);
    expect(reducer(reset, { type: "undo" }).edit.healStrokes).toHaveLength(1);
  });
});

describe("curves in history", () => {
  const bent = {
    rgb: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.7 },
      { x: 1, y: 1 },
    ],
    luma: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  };

  it("a committed curve edit is undoable", () => {
    const edited = reducer(fresh(), { type: "applyEdit", edit: { curves: bent } });
    expect(edited.edit.curves).toEqual(bent);
    expect(edited.past).toHaveLength(1);
    expect(reducer(edited, { type: "undo" }).edit.curves).toEqual(DEFAULT_EDIT_STATE.curves);
  });

  it("live curve updates record nothing until the gesture is committed as one step", () => {
    const start = fresh();
    const live = reducer(start, { type: "applyEdit", edit: { curves: bent }, commit: false });
    expect(live.past).toHaveLength(0);
    const committed = reducer(live, { type: "commit", snapshot: start.edit });
    expect(committed.past).toHaveLength(1);
    expect(committed.edit.curves).toEqual(bent);
  });

  it("resetAll straightens the curves and can be undone", () => {
    const edited = reducer(fresh(), { type: "applyEdit", edit: { curves: bent } });
    const reset = reducer(edited, { type: "resetAll" });
    expect(reset.edit.curves).toEqual(DEFAULT_EDIT_STATE.curves);
    expect(reducer(reset, { type: "undo" }).edit.curves).toEqual(bent);
  });
});

describe("mask model v2", () => {
  const radial = defaultShape("radial");
  const linear = defaultShape("linear");
  const act = (s: EditorState, a: Parameters<typeof reducer>[1]) => reducer(s, a);
  /** Three brush layers named Area 1-3, with the middle one holding a stroke. */
  const three = (): EditorState => {
    let s = fresh();
    for (let i = 0; i < 3; i++) s = act(s, { type: "addMaskLayer" });
    return act(s, { type: "paintMaskStroke", id: s.maskLayers[1]!.id, stroke: stroke() });
  };
  const ids = (s: EditorState) => s.maskLayers.map((l) => l.name);

  describe("gradient layers", () => {
    it("addMaskLayer with a shape makes a named, active gradient layer with no strokes", () => {
      const a = act(fresh(), { type: "addMaskLayer", shape: linear });
      const b = act(a, { type: "addMaskLayer", shape: radial });
      expect(ids(b)).toEqual(["Gradient 1", "Radial 2"]);
      expect(b.maskLayers[0]!.shape).toEqual(linear);
      expect(b.maskLayers[1]!.shape).toEqual(radial);
      expect(b.maskLayers[1]!.strokes).toEqual([]);
      expect(b.activeMaskLayerId).toBe(b.maskLayers[1]!.id);
      expect(b.maskPast).toHaveLength(2);
    });

    it("refuses an unusable shape instead of making a brush layer", () => {
      const s = fresh();
      const bad = { kind: "linear", x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 } as const;
      expect(act(s, { type: "addMaskLayer", shape: bad })).toBe(s);
    });

    it("painting on a gradient layer does nothing", () => {
      const s = act(fresh(), { type: "addMaskLayer", shape: radial });
      const painted = act(s, {
        type: "paintMaskStroke",
        id: s.maskLayers[0]!.id,
        stroke: stroke(),
      });
      expect(painted.maskLayers[0]!.strokes).toEqual([]);
    });

    it("setMaskShape reshapes live, without a history entry", () => {
      const s = act(fresh(), { type: "addMaskLayer", shape: radial });
      const id = s.maskLayers[0]!.id;
      const moved = act(s, { type: "setMaskShape", id, shape: { ...radial, cx: 0.2, rx: 0.1 } });
      expect(moved.maskLayers[0]!.shape).toMatchObject({ cx: 0.2, rx: 0.1 });
      expect(moved.maskPast).toHaveLength(s.maskPast.length);
    });

    it("setMaskShape clamps what it is given", () => {
      const s = act(fresh(), { type: "addMaskLayer", shape: radial });
      const out = act(s, {
        type: "setMaskShape",
        id: s.maskLayers[0]!.id,
        shape: { ...radial, rx: 99, feather: -5 },
      });
      expect(out.maskLayers[0]!.shape).toMatchObject({ rx: 2, feather: 0 });
    });

    it("setMaskShape ignores brush layers, other kinds, bad shapes and unknown ids", () => {
      const brush = act(fresh(), { type: "addMaskLayer" });
      expect(act(brush, { type: "setMaskShape", id: brush.maskLayers[0]!.id, shape: radial })).toBe(
        brush,
      );

      const s = act(fresh(), { type: "addMaskLayer", shape: radial });
      const id = s.maskLayers[0]!.id;
      expect(act(s, { type: "setMaskShape", id, shape: linear })).toBe(s);
      expect(act(s, { type: "setMaskShape", id, shape: { ...radial, cx: NaN } })).toBe(s);
      expect(act(s, { type: "setMaskShape", id: "nope", shape: radial })).toBe(s);
    });

    it("a reshape bracketed by recordMaskHistory is one undo step", () => {
      const s = act(fresh(), { type: "addMaskLayer", shape: radial });
      const id = s.maskLayers[0]!.id;
      let d = act(s, { type: "recordMaskHistory" });
      for (const cx of [0.4, 0.3, 0.2])
        d = act(d, { type: "setMaskShape", id, shape: { ...radial, cx } });
      const undone = act(d, { type: "undoMask" });
      expect(undone.maskLayers[0]!.shape).toEqual(radial);
    });
  });

  describe("rename", () => {
    it("renames, trims and records an undo step", () => {
      const s = three();
      const id = s.maskLayers[0]!.id;
      const r = act(s, { type: "renameMaskLayer", id, name: "  Sky  " });
      expect(r.maskLayers[0]!.name).toBe("Sky");
      expect(act(r, { type: "undoMask" }).maskLayers[0]!.name).toBe("Area 1");
    });

    it("ignores an empty name, an unchanged name and an unknown id", () => {
      const s = three();
      const id = s.maskLayers[0]!.id;
      expect(act(s, { type: "renameMaskLayer", id, name: "   " })).toBe(s);
      expect(act(s, { type: "renameMaskLayer", id, name: "Area 1" })).toBe(s);
      expect(act(s, { type: "renameMaskLayer", id: "nope", name: "X" })).toBe(s);
    });

    it("caps the length of a name", () => {
      const s = three();
      const r = act(s, { type: "renameMaskLayer", id: s.maskLayers[0]!.id, name: "x".repeat(200) });
      expect(r.maskLayers[0]!.name).toHaveLength(60);
    });
  });

  describe("invert and visible", () => {
    it("stores the flag only when it differs from the default", () => {
      const s = three();
      const id = s.maskLayers[0]!.id;
      const inverted = act(s, { type: "setMaskLayerInverted", id, inverted: true });
      expect(inverted.maskLayers[0]!.invert).toBe(true);
      const back = act(inverted, { type: "setMaskLayerInverted", id, inverted: false });
      expect("invert" in back.maskLayers[0]!).toBe(false);

      const hidden = act(s, { type: "setMaskLayerVisible", id, visible: false });
      expect(hidden.maskLayers[0]!.visible).toBe(false);
      const shown = act(hidden, { type: "setMaskLayerVisible", id, visible: true });
      expect("visible" in shown.maskLayers[0]!).toBe(false);
    });

    it("does nothing (same state, no history) when the value is already set", () => {
      const s = three();
      const id = s.maskLayers[0]!.id;
      expect(act(s, { type: "setMaskLayerInverted", id, inverted: false })).toBe(s);
      expect(act(s, { type: "setMaskLayerVisible", id, visible: true })).toBe(s);
      expect(act(s, { type: "setMaskLayerInverted", id: "nope", inverted: true })).toBe(s);
    });

    it("both are undoable and leave other layers alone", () => {
      const s = three();
      const id = s.maskLayers[0]!.id;
      const a = act(act(s, { type: "setMaskLayerInverted", id, inverted: true }), {
        type: "setMaskLayerVisible",
        id,
        visible: false,
      });
      expect(a.maskLayers[1]).toBe(s.maskLayers[1]);
      const undone = act(act(a, { type: "undoMask" }), { type: "undoMask" });
      expect(undone.maskLayers[0]).toEqual(s.maskLayers[0]);
    });
  });

  describe("duplicate", () => {
    it("inserts an independent copy right after the original and selects it", () => {
      const s = three();
      const original = s.maskLayers[1]!;
      const d = act(s, { type: "duplicateMaskLayer", id: original.id });
      expect(ids(d)).toEqual(["Area 1", "Area 2", "Area 2 copy", "Area 3"]);
      const copy = d.maskLayers[2]!;
      expect(copy.id).not.toBe(original.id);
      expect(d.activeMaskLayerId).toBe(copy.id);
      expect(copy.strokes).toEqual(original.strokes);
      expect(copy.strokes).not.toBe(original.strokes);
      expect(copy.adjustments).toEqual(original.adjustments);
      expect(copy.adjustments).not.toBe(original.adjustments);
    });

    it("painting on the copy leaves the original alone", () => {
      const s = three();
      const d = act(s, { type: "duplicateMaskLayer", id: s.maskLayers[1]!.id });
      const p = act(d, { type: "paintMaskStroke", id: d.maskLayers[2]!.id, stroke: stroke() });
      expect(p.maskLayers[1]!.strokes).toHaveLength(1);
      expect(p.maskLayers[2]!.strokes).toHaveLength(2);
    });

    it("copies the shape, invert and visible flags", () => {
      let s = act(fresh(), { type: "addMaskLayer", shape: radial });
      const id = s.maskLayers[0]!.id;
      s = act(s, { type: "setMaskLayerInverted", id, inverted: true });
      s = act(s, { type: "setMaskLayerVisible", id, visible: false });
      const d = act(s, { type: "duplicateMaskLayer", id });
      const copy = d.maskLayers[1]!;
      expect(copy).toMatchObject({ invert: true, visible: false, shape: radial });
      expect(copy.shape).not.toBe(s.maskLayers[0]!.shape);
    });

    it("is undoable, and ignores an unknown id", () => {
      const s = three();
      const d = act(s, { type: "duplicateMaskLayer", id: s.maskLayers[0]!.id });
      expect(ids(act(d, { type: "undoMask" }))).toEqual(ids(s));
      expect(act(s, { type: "duplicateMaskLayer", id: "nope" })).toBe(s);
    });
  });

  describe("reorder", () => {
    it("moves a layer to an index (array order is render order)", () => {
      const s = three();
      const first = s.maskLayers[0]!.id;
      expect(ids(act(s, { type: "moveMaskLayer", id: first, toIndex: 2 }))).toEqual([
        "Area 2",
        "Area 3",
        "Area 1",
      ]);
      const last = s.maskLayers[2]!.id;
      expect(ids(act(s, { type: "moveMaskLayer", id: last, toIndex: 0 }))).toEqual([
        "Area 3",
        "Area 1",
        "Area 2",
      ]);
    });

    it("clamps the target index and ignores no-op moves, unknown ids and bad indexes", () => {
      const s = three();
      const first = s.maskLayers[0]!.id;
      expect(ids(act(s, { type: "moveMaskLayer", id: first, toIndex: 99 }))).toEqual([
        "Area 2",
        "Area 3",
        "Area 1",
      ]);
      expect(act(s, { type: "moveMaskLayer", id: first, toIndex: -4 })).toBe(s);
      expect(act(s, { type: "moveMaskLayer", id: first, toIndex: 0 })).toBe(s);
      expect(act(s, { type: "moveMaskLayer", id: "nope", toIndex: 1 })).toBe(s);
      expect(act(s, { type: "moveMaskLayer", id: first, toIndex: NaN })).toBe(s);
    });

    it("keeps the active layer and is undoable", () => {
      const s = act(three(), { type: "setActiveMaskLayer", id: null });
      const moved = act(s, { type: "moveMaskLayer", id: s.maskLayers[0]!.id, toIndex: 2 });
      expect(moved.activeMaskLayerId).toBeNull();
      expect(ids(act(moved, { type: "undoMask" }))).toEqual(ids(s));
    });
  });

  it("none of these touch the global history", () => {
    const s = three();
    const id = s.maskLayers[0]!.id;
    const out = [
      act(s, { type: "renameMaskLayer", id, name: "Sky" }),
      act(s, { type: "setMaskLayerInverted", id, inverted: true }),
      act(s, { type: "setMaskLayerVisible", id, visible: false }),
      act(s, { type: "duplicateMaskLayer", id }),
      act(s, { type: "moveMaskLayer", id, toIndex: 2 }),
    ];
    for (const o of out) {
      expect(o.past).toBe(s.past);
      expect(o.edit).toBe(s.edit);
    }
  });
});
