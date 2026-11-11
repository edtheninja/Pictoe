import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderImage } from "./render";
import { DEFAULT_EDIT_STATE, type EditState, type MaskLayer } from "@/types/editor";
import { defaultShape } from "./maskShapes";

/**
 * Runs the real renderImage with a fake canvas that records every call and every property
 * that is set, then checks what the gradient, invert and visible settings turn into.
 */
type Call = { name: string; args: unknown[] };
type FakeCanvas = { width: number; height: number; calls: Call[]; getContext: () => unknown };

function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, prop: string) =>
      (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return prop.startsWith("create") && prop.endsWith("Gradient")
          ? { addColorStop: (...a: unknown[]) => calls.push({ name: "addColorStop", args: a }) }
          : undefined;
      },
    set: (_t, prop: string, value: unknown) => {
      calls.push({ name: `set:${prop}`, args: [value] });
      return true;
    },
  });
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

let made: FakeCanvas[] = [];

beforeEach(() => {
  made = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const c = fakeCanvas();
      made.push(c);
      return c;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const SRC_W = 1200;
const SRC_H = 800;
const adjustments = { exposure: 10, contrast: 0, saturation: 0, temperature: 0 };

const layer = (extra: Partial<MaskLayer>): MaskLayer => ({
  id: "layer",
  name: "Layer",
  strokes: [],
  adjustments,
  ...extra,
});

function render(edit: EditState, masks: MaskLayer[], maxDimension?: number) {
  made = [];
  renderImage(
    {} as CanvasImageSource,
    SRC_W,
    SRC_H,
    edit,
    fakeCanvas() as never,
    maxDimension,
    masks,
  );
  return made.flatMap((c) => c.calls);
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const nums = (c: Call | undefined) => (c ? (c.args as number[]) : null);

describe("gradient masks in the real renderer", () => {
  it("draws a linear gradient from the start point to the end point, filling the frame", () => {
    const shape = { kind: "linear", x1: 0.5, y1: 0.25, x2: 0.5, y2: 0.75 } as const;
    const calls = render(DEFAULT_EDIT_STATE, [layer({ shape })]);
    expect(nums(named(calls, "createLinearGradient")[0])).toEqual([600, 200, 600, 600]);
    expect(nums(named(calls, "fillRect").at(-1))).toEqual([0, 0, 1200, 800]);
    const stops = named(calls, "addColorStop").map((c) => c.args);
    expect(stops).toEqual([
      [0, "rgba(255,255,255,1)"],
      [1, "rgba(255,255,255,0)"],
    ]);
  });

  it("moves a linear gradient with the picture when it is rotated 90°", () => {
    // Source top-centre (0.5, 0) → right-centre of the 800 × 1200 output; bottom → left.
    const shape = { kind: "linear", x1: 0.5, y1: 0, x2: 0.5, y2: 1 } as const;
    const calls = render({ ...DEFAULT_EDIT_STATE, rotation: 90 }, [layer({ shape })]);
    const [x1, y1, x2, y2] = nums(named(calls, "createLinearGradient")[0])!;
    expect(x1).toBeCloseTo(800, 6);
    expect(y1).toBeCloseTo(600, 6);
    expect(x2).toBeCloseTo(0, 6);
    expect(y2).toBeCloseTo(600, 6);
  });

  it("draws a radial mask as a unit circle under a transform that makes it the ellipse", () => {
    const shape = { ...defaultShape("radial"), rx: 0.25, ry: 0.25, feather: 30 };
    const calls = render(DEFAULT_EDIT_STATE, [layer({ shape })]);
    const t = nums(named(calls, "setTransform")[0])!;
    // Radius 0.25 × shorter side (800) = 200 px, centre (600, 400).
    [200, 0, 0, 200, 600, 400].forEach((v, i) => expect(t[i]).toBeCloseTo(v, 6));
    expect(nums(named(calls, "createRadialGradient").at(-1))).toEqual([0, 0, 0, 0, 0, 1]);
    expect(nums(named(calls, "arc").at(-1))!.slice(0, 3)).toEqual([0, 0, 1]);
    // Feather 30 → the effect is solid out to 70% of the radius.
    expect(named(calls, "addColorStop").map((c) => c.args[0])).toEqual([0, 0.7, 1]);
  });

  it("turns the radial axes with the picture when it is rotated 90°", () => {
    const shape = { ...defaultShape("radial"), rx: 0.25, ry: 0.25 };
    const calls = render({ ...DEFAULT_EDIT_STATE, rotation: 90 }, [layer({ shape })]);
    const t = nums(named(calls, "setTransform")[0])!;
    // Source x axis → output down; source y axis → output left. Centre of 800 × 1200 is (400, 600).
    [0, 200, -200, 0, 400, 600].forEach((v, i) => expect(t[i]).toBeCloseTo(v, 6));
  });

  it("uses a solid fill, not a gradient, for a hard-edged radial mask", () => {
    const shape = { ...defaultShape("radial"), feather: 0 };
    const calls = render(DEFAULT_EDIT_STATE, [layer({ shape })]);
    expect(named(calls, "createRadialGradient")).toHaveLength(0);
  });

  it("scales a gradient to a smaller preview", () => {
    const shape = { kind: "linear", x1: 0.5, y1: 0.25, x2: 0.5, y2: 0.75 } as const;
    const calls = render(DEFAULT_EDIT_STATE, [layer({ shape })], 600);
    expect(nums(named(calls, "createLinearGradient")[0])).toEqual([300, 100, 300, 300]);
  });
});

describe("invert and visible in the real renderer", () => {
  const shape = defaultShape("radial");
  const ops = (calls: Call[]) =>
    named(calls, "set:globalCompositeOperation").map((c) => c.args[0] as string);

  it("keeps the masked area normally and removes it when inverted", () => {
    expect(ops(render(DEFAULT_EDIT_STATE, [layer({ shape })]))).toContain("destination-in");
    expect(ops(render(DEFAULT_EDIT_STATE, [layer({ shape })]))).not.toContain("destination-out");

    const inverted = ops(render(DEFAULT_EDIT_STATE, [layer({ shape, invert: true })]));
    expect(inverted).toContain("destination-out");
    expect(inverted).not.toContain("destination-in");
  });

  it("inverts a brush layer too, and an empty inverted brush layer covers everything", () => {
    const stroke = [{ x: 0.5, y: 0.5, radius: 0.05 }];
    expect(
      ops(render(DEFAULT_EDIT_STATE, [layer({ strokes: stroke, invert: true })], 600)),
    ).toContain("destination-out");
    const empty = render(DEFAULT_EDIT_STATE, [layer({ invert: true })]);
    expect(ops(empty)).toContain("destination-out");
    expect(named(empty, "drawImage").length).toBeGreaterThan(1);
  });

  it("renders nothing at all for a hidden layer, whatever its type", () => {
    const stroke = [{ x: 0.5, y: 0.5, radius: 0.05 }];
    const none = render(DEFAULT_EDIT_STATE, []);
    const baselineCanvases = made.length;
    for (const hidden of [
      layer({ shape, visible: false }),
      layer({ strokes: stroke, visible: false }),
      layer({ invert: true, visible: false }),
    ]) {
      const calls = render(DEFAULT_EDIT_STATE, [hidden]);
      expect(calls.length).toBe(none.length);
      expect(made.length).toBe(baselineCanvases); // not even a scratch canvas is made
    }
  });

  it("renders layers in array order, so the last is on top", () => {
    const a = layer({ id: "a", shape: { ...defaultShape("radial"), cx: 0.2 } });
    const b = layer({ id: "b", shape: { ...defaultShape("radial"), cx: 0.8 } });
    const centres = (masks: MaskLayer[]) =>
      named(render(DEFAULT_EDIT_STATE, masks), "setTransform").map((c) => (c.args as number[])[4]);
    expect(centres([a, b])).toEqual([240, 960]);
    expect(centres([b, a])).toEqual([960, 240]);
  });
});
