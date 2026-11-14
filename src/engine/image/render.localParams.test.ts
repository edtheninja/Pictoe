import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import {
  createFakeDocument,
  fakeCanvas,
  type Call,
  type FakeDocument,
} from "./fakeCanvas.testutil";
import { DEFAULT_EDIT_STATE, DEFAULT_LOCAL_ADJUSTMENTS, type MaskLayer } from "@/types/editor";

/**
 * Runs the real renderImage with a fake canvas and checks which work a local area asks for.
 * Pixels are not computed here (the maths is tested in localAdjustments.test.ts and
 * colorStage tests); this proves each new slider reaches the right step of the area's chain,
 * and that a slider at zero costs nothing.
 */
let fake: FakeDocument;

beforeEach(() => {
  const created = createFakeDocument();
  fake = created.made;
  vi.stubGlobal("document", created.document);
  // The first render also creates a one-off probe canvas (and caches the answer); do it here so
  // the baseline below counts the same work as every later render.
  render({});
  base = render({});
});
afterEach(() => vi.unstubAllGlobals());

const layer = (adjustments: Partial<MaskLayer["adjustments"]>): MaskLayer => ({
  id: "a",
  name: "A",
  strokes: [{ x: 0.5, y: 0.5, radius: 0.2 }],
  adjustments: { ...DEFAULT_LOCAL_ADJUSTMENTS, exposure: 10, ...adjustments },
});

/** Everything the render did, after the local layer's scratch canvas was created. */
function render(adjustments: Partial<MaskLayer["adjustments"]>) {
  fake.canvases.length = 0;
  const target = fakeCanvas();
  renderImage({} as CanvasImageSource, 60, 40, DEFAULT_EDIT_STATE, target as never, undefined, [
    layer(adjustments),
  ]);
  const calls = [...fake.canvases.flatMap((c) => c.calls), ...target.calls];
  const count = (name: string) => calls.filter((c) => c.name === name).length;
  return { calls, count, canvases: fake.canvases.length };
}

let base: ReturnType<typeof render>;

describe("local areas: the new sliders reach the render", () => {
  it("a layer with only the original sliders reads and writes no pixels for the new ones", () => {
    // Same work as a layer with every new slider at zero (they are the same layer).
    const again = render({ highlights: 0, shadows: 0, tint: 0, clarity: 0, sharpness: 0 });
    expect(again.count("getImageData")).toBe(base.count("getImageData"));
    expect(again.count("putImageData")).toBe(base.count("putImageData"));
    expect(again.canvases).toBe(base.canvases);
  });

  it.each(["highlights", "shadows"] as const)(
    "%s runs the colour stage on the area's canvas (one read and one write more)",
    (key) => {
      const r = render({ [key]: 40 });
      expect(r.count("getImageData")).toBe(base.count("getImageData") + 1);
      expect(r.count("putImageData")).toBe(base.count("putImageData") + 1);
      // Highlights and shadows together are still one pass.
      const both = render({ highlights: 40, shadows: -30 });
      expect(both.count("getImageData")).toBe(base.count("getImageData") + 1);
    },
  );

  it("sharpness blurs a copy and reads both (an unsharp mask on the area's canvas)", () => {
    const r = render({ sharpness: 50 });
    expect(r.canvases).toBe(base.canvases + 1);
    expect(r.count("getImageData")).toBeGreaterThan(base.count("getImageData"));
    expect(r.count("putImageData")).toBe(base.count("putImageData") + 1);
  });

  it("tint adds a soft-light colour layer: magenta one way, green the other", () => {
    const fills = (calls: Call[]) =>
      calls.filter((c) => c.name === "set:fillStyle").map((c) => c.args[0]);
    expect(fills(render({ tint: 60 }).calls)).toContain("#ff3cf0");
    expect(fills(render({ tint: -60 }).calls)).toContain("#54ff3c");
    expect(fills(render({ tint: 60 }).calls)).not.toContain("#54ff3c");
    expect(fills(base.calls)).not.toContain("#ff3cf0");
    expect(fills(base.calls)).not.toContain("#54ff3c");
  });

  it("clarity changes only the area's filter (no extra pixel pass)", () => {
    const r = render({ clarity: 70 });
    expect(r.count("getImageData")).toBe(base.count("getImageData"));
    expect(r.canvases).toBe(base.canvases);
    const filters = (calls: Call[]) =>
      calls.filter((c) => c.name === "set:filter").map((c) => String(c.args[0]));
    expect(filters(r.calls)).not.toEqual(filters(base.calls));
  });
});
