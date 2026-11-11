import { describe, expect, it, vi } from "vitest";
import { createRenderHandler } from "./renderHandler";
import { planStrokeUpdate } from "./incremental";
import type { FromWorker } from "./renderProtocol";
import { DEFAULT_EDIT_STATE, type EditState, type MaskLayer } from "@/types/editor";

const bitmap = (w = 10, h = 10) =>
  ({ width: w, height: h, close: vi.fn() }) as unknown as ImageBitmap;

function setup() {
  const posted: { message: FromWorker; transfer: Transferable[] }[] = [];
  const out = bitmap(320, 200);
  const target = { transferToImageBitmap: vi.fn(() => out) };
  const createTarget = vi.fn(() => target);
  const render = vi.fn();
  const handle = createRenderHandler({
    post: (message, transfer) => posted.push({ message, transfer }),
    createTarget,
    render,
  });
  return { handle, posted, out, target, createTarget, render };
}

const heal = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i, dx: 1, dy: 1, radius: 2, softness: 30 }));
const editWith = (healStrokes = heal(0)): EditState => ({ ...DEFAULT_EDIT_STATE, healStrokes });
const layer = (id: string, n: number): MaskLayer => ({
  id,
  name: id,
  strokes: Array.from({ length: n }, (_, i) => ({ x: i / 10, y: 0.5, radius: 0.1 })),
  adjustments: { exposure: 5, contrast: 0, saturation: 0, temperature: 0 },
});
const send = (
  h: ReturnType<typeof setup>["handle"],
  requestId: number,
  edit: EditState,
  layers?: MaskLayer[],
  sourceId = 1,
) =>
  h({
    type: "render",
    requestId,
    sourceId,
    edit: structuredClone(edit),
    maxDimension: 800,
    maskLayers: structuredClone(layers),
  });

describe("render handler", () => {
  it("renders from the stored source and posts the frame with the bitmap transferred", () => {
    const t = setup();
    const src = bitmap(4000, 3000);
    t.handle({ type: "setSource", sourceId: 1, bitmap: src, width: 4000, height: 3000 });
    send(t.handle, 7, editWith());
    expect(t.render).toHaveBeenCalledTimes(1);
    const args = t.render.mock.calls[0]!;
    expect(args[0]).toBe(src);
    expect([args[1], args[2], args[5]]).toEqual([4000, 3000, 800]);
    expect(args[4]).toBe(t.target);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]!.message).toMatchObject({
      type: "rendered",
      requestId: 7,
      width: 320,
      height: 200,
    });
    expect(t.posted[0]!.transfer).toEqual([t.out]);
  });

  it("creates the render target once and reuses it", () => {
    const t = setup();
    t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
    send(t.handle, 1, editWith());
    send(t.handle, 2, editWith());
    expect(t.createTarget).toHaveBeenCalledTimes(1);
  });

  it("answers with an error, without rendering, for an unknown or outdated source", () => {
    const t = setup();
    send(t.handle, 1, editWith());
    t.handle({ type: "setSource", sourceId: 2, bitmap: bitmap(), width: 10, height: 10 });
    send(t.handle, 2, editWith(), undefined, 1);
    expect(t.render).not.toHaveBeenCalled();
    expect(t.posted.map((p) => p.message)).toEqual([
      { type: "error", requestId: 1, message: "unknown-source" },
      { type: "error", requestId: 2, message: "unknown-source" },
    ]);
  });

  it("closes the previous bitmap when the source is replaced or cleared", () => {
    const t = setup();
    const first = bitmap();
    const second = bitmap();
    t.handle({ type: "setSource", sourceId: 1, bitmap: first, width: 10, height: 10 });
    t.handle({ type: "setSource", sourceId: 2, bitmap: second, width: 10, height: 10 });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    t.handle({ type: "clearSource" });
    expect(second.close).toHaveBeenCalledTimes(1);
    send(t.handle, 1, editWith(), undefined, 2);
    expect(t.posted[0]!.message).toMatchObject({ type: "error" });
  });

  it("reports a render failure and keeps working afterwards", () => {
    const t = setup();
    t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
    t.render.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    send(t.handle, 1, editWith());
    send(t.handle, 2, editWith());
    expect(t.posted[0]!.message).toEqual({ type: "error", requestId: 1, message: "boom" });
    expect(t.posted[1]!.message).toMatchObject({ type: "rendered", requestId: 2 });
  });

  describe("stroke identity across messages", () => {
    const strokesSeen = (t: ReturnType<typeof setup>) =>
      t.render.mock.calls.map((c) => (c[3] as EditState).healStrokes);

    it("hands the same heal array to the renderer when only a slider moved", () => {
      const t = setup();
      t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
      send(t.handle, 1, editWith(heal(3)));
      send(t.handle, 2, editWith(heal(3)));
      const [a, b] = strokesSeen(t);
      expect(b).toBe(a);
      expect(planStrokeUpdate(a, b!)).toBe("reuse");
    });

    it("lets heal caches append when one stroke is added", () => {
      const t = setup();
      t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
      send(t.handle, 1, editWith(heal(3)));
      send(t.handle, 2, editWith(heal(4)));
      const [a, b] = strokesSeen(t);
      expect(planStrokeUpdate(a, b!)).toBe("append");
    });

    it("keeps the heal history through a 'show original' toggle (empty strokes)", () => {
      const t = setup();
      t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
      send(t.handle, 1, editWith(heal(3)));
      send(t.handle, 2, editWith(heal(0)));
      send(t.handle, 3, editWith(heal(3)));
      const [a, , c] = strokesSeen(t);
      expect(c).toBe(a);
    });

    it("keeps mask strokes stable per layer, and through a hidden-layers toggle", () => {
      const t = setup();
      t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
      const layers = [layer("a", 2), layer("b", 3)];
      send(t.handle, 1, editWith(), layers);
      send(t.handle, 2, editWith(), undefined); // Show original
      send(t.handle, 3, editWith(), layers);
      const seen = t.render.mock.calls.map((c) => c[6] as MaskLayer[] | undefined);
      expect(seen[1]).toBeUndefined();
      expect(seen[2]![0]!.strokes).toBe(seen[0]![0]!.strokes);
      expect(seen[2]![1]!.strokes).toBe(seen[0]![1]!.strokes);
    });

    it("forgets a layer that was removed", () => {
      const t = setup();
      t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
      send(t.handle, 1, editWith(), [layer("a", 2)]);
      send(t.handle, 2, editWith(), [layer("other", 1)]);
      send(t.handle, 3, editWith(), [layer("a", 2)]);
      const seen = t.render.mock.calls.map((c) => c[6] as MaskLayer[]);
      expect(seen[2]![0]!.strokes).not.toBe(seen[0]![0]!.strokes);
    });

    it("starts fresh after the source changes", () => {
      const t = setup();
      t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 10, height: 10 });
      send(t.handle, 1, editWith(heal(3)));
      t.handle({ type: "setSource", sourceId: 2, bitmap: bitmap(), width: 10, height: 10 });
      send(t.handle, 2, editWith(heal(3)), undefined, 2);
      const [a, b] = strokesSeen(t);
      expect(b).not.toBe(a);
    });
  });

  it("passes gradient shapes, invert and visible through to the renderer after a structured clone", () => {
    const t = setup();
    t.handle({ type: "setSource", sourceId: 1, bitmap: bitmap(), width: 100, height: 100 });
    const gradient: MaskLayer = {
      ...layer("g", 0),
      shape: { kind: "radial", cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.1, angle: 30, feather: 20 },
      invert: true,
      visible: false,
    };
    send(t.handle, 1, editWith(), [gradient, layer("b", 2)]);
    const [first, second] = t.render.mock.calls[0]![6] as MaskLayer[];
    expect(first).toEqual(gradient);
    expect(second!.strokes).toHaveLength(2);
    expect("shape" in second!).toBe(false);
  });
});
