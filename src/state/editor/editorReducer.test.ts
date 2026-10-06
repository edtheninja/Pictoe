import { describe, expect, it } from "vitest";
import { editorInitialState, editorReducer as reducer, type EditorState } from "./EditorContext";
import { DEFAULT_EDIT_STATE, type MaskStroke } from "@/types/editor";

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
