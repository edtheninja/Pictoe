import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import { createFakeDocument, fakeCanvas, type FakeDocument } from "./fakeCanvas.testutil";
import { defaultShape } from "./maskShapes";
import { DEFAULT_EDIT_STATE, DEFAULT_LOCAL_ADJUSTMENTS, type MaskLayer } from "@/types/editor";

/**
 * The per-frame cost of local areas, as work counts rather than milliseconds.
 *
 * Why counts: a local area's expensive parts are scratch canvases and full-frame pixel reads
 * (getImageData / putImageData), whose cost depends on the browser and the GPU, and Node cannot
 * time them. The counts are exact and do not depend on the machine, and they decide the cost:
 * each area redoes this work on every preview frame, at the full preview size.
 *
 * These tests pin the budget so it cannot grow unnoticed. If one fails after a deliberate
 * change, check the change is worth the extra frame cost, then update the number. The table in
 * ROADMAP.md (M7 / step 10) turns these counts into megabytes per frame.
 */

const W = 200;
const H = 100;

let fake: FakeDocument;
beforeEach(() => {
  const created = createFakeDocument();
  fake = created.made;
  vi.stubGlobal("document", created.document);
  // The first render creates a one-off filter-support probe canvas, and the first brush render
  // fills the mask cache. Do both here so every measurement below is a steady-state frame.
  measure([brush("warm-up", {})]);
  measure([]);
});
afterEach(() => vi.unstubAllGlobals());

const area = (
  id: string,
  shape: MaskLayer["shape"],
  adjustments: Partial<MaskLayer["adjustments"]>,
  extra: Partial<MaskLayer> = {},
): MaskLayer => ({
  id,
  name: id,
  strokes: shape ? [] : [{ x: 0.5, y: 0.5, radius: 0.2 }],
  ...(shape ? { shape } : {}),
  adjustments: { ...DEFAULT_LOCAL_ADJUSTMENTS, ...adjustments },
  ...extra,
});
const brush = (id: string, a: Partial<MaskLayer["adjustments"]>) => area(id, undefined, a);
const linear = (id: string, a: Partial<MaskLayer["adjustments"]>) =>
  area(id, defaultShape("linear"), a);
const radial = (id: string, a: Partial<MaskLayer["adjustments"]>) =>
  area(id, defaultShape("radial"), a);

/** Work done by one render of `layers`, counted over every canvas it touched. */
function measure(layers: MaskLayer[]) {
  fake.canvases.length = 0;
  const target = fakeCanvas();
  renderImage(
    {} as CanvasImageSource,
    W,
    H,
    DEFAULT_EDIT_STATE,
    target as never,
    undefined,
    layers,
  );
  const calls = [...fake.canvases.flatMap((c) => c.calls), ...target.calls];
  const count = (name: string) => calls.filter((c) => c.name === name).length;
  return {
    canvases: fake.canvases.length,
    reads: count("getImageData"),
    writes: count("putImageData"),
  };
}

/** What `layers` add to a frame that has no areas. */
function cost(layers: MaskLayer[]) {
  const none = measure([]);
  const m = measure(layers);
  return {
    canvases: m.canvases - none.canvases,
    reads: m.reads - none.reads,
    writes: m.writes - none.writes,
  };
}

const EVERYTHING = {
  exposure: 20,
  contrast: 10,
  saturation: 10,
  temperature: 10,
  tint: 10,
  clarity: 10,
  highlights: 30,
  shadows: 30,
  sharpness: 40,
};

describe("per-frame cost of local areas", () => {
  it("an area with only filter and colour-cast sliders reads and writes no pixels", () => {
    const filterOnly = {
      exposure: 20,
      contrast: 10,
      saturation: 10,
      temperature: 10,
      tint: 10,
      clarity: 10,
    };
    for (const make of [brush, linear, radial]) {
      const c = cost([make("a", filterOnly)]);
      expect(c.reads).toBe(0);
      expect(c.writes).toBe(0);
    }
  });

  it("highlights and shadows cost one full-frame read and one write, however many are set", () => {
    expect(cost([radial("a", { highlights: 30 })])).toMatchObject({ reads: 1, writes: 1 });
    expect(cost([radial("a", { shadows: -30 })])).toMatchObject({ reads: 1, writes: 1 });
    expect(cost([radial("a", { highlights: 30, shadows: -30 })])).toMatchObject({
      reads: 1,
      writes: 1,
    });
  });

  it("sharpness costs two reads, one write and one extra scratch canvas", () => {
    const plain = cost([radial("a", { exposure: 20 })]);
    const sharp = cost([radial("a", { exposure: 20, sharpness: 40 })]);
    expect(sharp.reads).toBe(2);
    expect(sharp.writes).toBe(1);
    expect(sharp.canvases).toBe(plain.canvases + 1);
  });

  it("an area with every slider moved costs three reads and two writes (the budget per area)", () => {
    expect(cost([radial("a", EVERYTHING)])).toMatchObject({ reads: 3, writes: 2 });
  });

  it("grows in a straight line with the number of areas", () => {
    const one = cost([radial("a", EVERYTHING)]);
    const three = cost([radial("a", EVERYTHING), linear("b", EVERYTHING), brush("c", EVERYTHING)]);
    expect(three).toEqual({
      canvases: one.canvases * 3,
      reads: one.reads * 3,
      writes: one.writes * 3,
    });
  });

  it("costs the same whatever kind of area it is (brush, linear gradient or radial)", () => {
    const costs = [brush, linear, radial].map((make) => cost([make("a", EVERYTHING)]));
    expect(costs[1]).toEqual(costs[0]);
    expect(costs[2]).toEqual(costs[0]);
  });

  it("an area that is switched off, or changes nothing, adds no work at all", () => {
    expect(cost([radial("a", EVERYTHING)].map((l) => ({ ...l, visible: false })))).toEqual({
      canvases: 0,
      reads: 0,
      writes: 0,
    });
    expect(cost([radial("a", {}), brush("b", {})])).toEqual({ canvases: 0, reads: 0, writes: 0 });
  });
});
