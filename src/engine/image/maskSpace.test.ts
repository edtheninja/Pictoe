import { describe, expect, it } from "vitest";
import {
  frameOf,
  frameOutputSize,
  maskFrameKey,
  migrateLegacyLayers,
  outputToSource,
  radiusToPixels,
  radiusToSource,
  sourceToOutput,
  strokeToSource,
} from "./maskSpace";
import { outputSize } from "./render";
import { DEFAULT_EDIT_STATE, type EditState, type MaskLayer } from "@/types/editor";

const SRC_W = 1200;
const SRC_H = 800;

const crops = [
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
  { x: 0.4, y: 0, width: 0.6, height: 1 },
];
const points = [
  { x: 0.5, y: 0.5 },
  { x: 0.1, y: 0.9 },
  { x: 0.8, y: 0.25 },
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const allEdits = (): EditState[] =>
  [0, 90, 180, 270].flatMap((rotation) =>
    [false, true].flatMap((flipH) =>
      crops.map((crop) => ({ ...DEFAULT_EDIT_STATE, rotation, flipH, crop })),
    ),
  );

// --- An independent re-creation of renderImage's canvas transform ---------------------
// Canvas calls post-multiply the current matrix: [a b c d e f] → x' = ax + cy + e, y' = bx + dy + f.
type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const rotate = (deg: number): M => {
  const t = (deg * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
};
const scale = (sx: number, sy: number): M => [sx, 0, 0, sy, 0, 0];

/** Where renderImage actually puts a source point, as 0–1 within the output (scale 1). */
function renderedPosition(p: { x: number; y: number }, edit: EditState) {
  const out = outputSize(SRC_W, SRC_H, edit);
  const rot = ((edit.rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const rotW = swap ? SRC_H : SRC_W;
  const rotH = swap ? SRC_W : SRC_H;

  let m = translate(-edit.crop.x * rotW, -edit.crop.y * rotH);
  m = mul(m, translate(rotW / 2, rotH / 2));
  m = mul(m, rotate(rot));
  if (edit.flipH) m = mul(m, scale(-1, 1));

  const dw = swap ? rotH : rotW;
  const dh = swap ? rotW : rotH;
  const lx = -dw / 2 + p.x * dw;
  const ly = -dh / 2 + p.y * dh;
  return {
    x: (m[0] * lx + m[2] * ly + m[4]) / out.width,
    y: (m[1] * lx + m[3] * ly + m[5]) / out.height,
  };
}

describe("source ↔ output mapping", () => {
  it("round-trips for every rotation, flip and crop", () => {
    for (const edit of allEdits()) {
      const f = frameOf(SRC_W, SRC_H, edit);
      for (const p of points) {
        const back = outputToSource(sourceToOutput(p, f), f);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
        const there = sourceToOutput(outputToSource(p, f), f);
        expect(there.x).toBeCloseTo(p.x, 9);
        expect(there.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it("agrees with the renderer's own canvas transform", () => {
    for (const edit of allEdits()) {
      const f = frameOf(SRC_W, SRC_H, edit);
      for (const p of points) {
        const mine = sourceToOutput(p, f);
        const actual = renderedPosition(p, edit);
        // Loose only because the renderer rounds the output size to whole pixels.
        expect(mine.x).toBeCloseTo(actual.x, 2);
        expect(mine.y).toBeCloseTo(actual.y, 2);
      }
    }
  });

  it("keeps a painted spot on the same part of the picture when the image is rotated", () => {
    // Paint on the left edge, halfway down, with no edits applied.
    const original = frameOf(SRC_W, SRC_H, DEFAULT_EDIT_STATE);
    const onPicture = outputToSource({ x: 0.1, y: 0.5 }, original);

    // Rotating 90° clockwise moves the left edge to the top.
    const rotated = frameOf(SRC_W, SRC_H, { ...DEFAULT_EDIT_STATE, rotation: 90 });
    const shown = sourceToOutput(onPicture, rotated);
    expect(shown.x).toBeCloseTo(0.5, 9);
    expect(shown.y).toBeCloseTo(0.1, 9);
  });

  it("keeps a painted spot on the same part of the picture when the crop changes", () => {
    const original = frameOf(SRC_W, SRC_H, DEFAULT_EDIT_STATE);
    const onPicture = outputToSource({ x: 0.5, y: 0.5 }, original);

    // Crop to the right half: the centre of the picture is now the left edge of the frame.
    const cropped = frameOf(SRC_W, SRC_H, {
      ...DEFAULT_EDIT_STATE,
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
    });
    const shown = sourceToOutput(onPicture, cropped);
    expect(shown.x).toBeCloseTo(0, 9);
    expect(shown.y).toBeCloseTo(0.5, 9);
  });

  it("flips horizontally", () => {
    const flipped = frameOf(SRC_W, SRC_H, { ...DEFAULT_EDIT_STATE, flipH: true });
    const shown = sourceToOutput({ x: 0.2, y: 0.3 }, flipped);
    expect(shown.x).toBeCloseTo(0.8, 9);
    expect(shown.y).toBeCloseTo(0.3, 9);
  });
});

describe("frame size and brush size", () => {
  it("matches the renderer's outputSize", () => {
    for (const edit of allEdits()) {
      expect(frameOutputSize(frameOf(SRC_W, SRC_H, edit))).toEqual(outputSize(SRC_W, SRC_H, edit));
    }
  });

  it("a brush keeps the size it had on screen when it was painted", () => {
    for (const edit of allEdits()) {
      const f = frameOf(SRC_W, SRC_H, edit);
      const out = frameOutputSize(f);
      const onScreen = 0.06; // fraction of the visible frame's shorter side
      const stored = radiusToSource(onScreen, f);
      expect(radiusToPixels(stored, f, 1)).toBeCloseTo(
        onScreen * Math.min(out.width, out.height),
        6,
      );
    }
  });

  it("scales with the preview size", () => {
    const f = frameOf(SRC_W, SRC_H, DEFAULT_EDIT_STATE);
    expect(radiusToPixels(0.05, f, 0.5)).toBeCloseTo(radiusToPixels(0.05, f, 1) / 2, 9);
  });
});

describe("migrating older saved masks", () => {
  const layer = (strokes: MaskLayer["strokes"]): MaskLayer => ({
    id: "a",
    name: "Area 1",
    strokes,
    adjustments: { exposure: 12, contrast: 0, saturation: 0, temperature: 0 },
  });

  it("converts strokes using the saved edit and keeps everything else", () => {
    const f = frameOf(SRC_W, SRC_H, { ...DEFAULT_EDIT_STATE, rotation: 90 });
    const old = { x: 0.3, y: 0.7, radius: 0.06, softness: 40, mode: "erase" as const };
    const [migrated] = migrateLegacyLayers([layer([old])], f);

    const expected = strokeToSource(old, f);
    expect(migrated!.strokes[0]).toEqual(expected);
    expect(migrated!.strokes[0]!.softness).toBe(40);
    expect(migrated!.strokes[0]!.mode).toBe("erase");
    expect(migrated!.adjustments.exposure).toBe(12);
    expect(migrated!.id).toBe("a");
  });

  it("leaves an unedited frame's strokes in place and layers without strokes untouched", () => {
    const f = frameOf(SRC_W, SRC_H, DEFAULT_EDIT_STATE);
    const empty = layer([]);
    expect(migrateLegacyLayers([empty], f)[0]).toBe(empty);

    const [kept] = migrateLegacyLayers([layer([{ x: 0.3, y: 0.7, radius: 0.06 }])], f);
    expect(kept!.strokes[0]!.x).toBeCloseTo(0.3, 9);
    expect(kept!.strokes[0]!.y).toBeCloseTo(0.7, 9);
    // radius is relative to the frame's shorter side (800) before and the source's (800) after.
    expect(kept!.strokes[0]!.radius).toBeCloseTo(0.06, 9);
  });
});

describe("maskFrameKey", () => {
  const base = frameOf(SRC_W, SRC_H, DEFAULT_EDIT_STATE);

  it("is stable for the same frame and changes with crop, rotation, flip or source", () => {
    expect(maskFrameKey(frameOf(SRC_W, SRC_H, DEFAULT_EDIT_STATE))).toBe(maskFrameKey(base));
    const changed = [
      frameOf(SRC_W, SRC_H, { ...DEFAULT_EDIT_STATE, rotation: 90 }),
      frameOf(SRC_W, SRC_H, { ...DEFAULT_EDIT_STATE, flipH: true }),
      frameOf(SRC_W, SRC_H, {
        ...DEFAULT_EDIT_STATE,
        crop: { x: 0.1, y: 0, width: 0.9, height: 1 },
      }),
      frameOf(SRC_W + 1, SRC_H, DEFAULT_EDIT_STATE),
    ];
    for (const f of changed) expect(maskFrameKey(f)).not.toBe(maskFrameKey(base));
  });

  it("treats 0° and 360° as the same frame", () => {
    expect(maskFrameKey(frameOf(SRC_W, SRC_H, { ...DEFAULT_EDIT_STATE, rotation: 360 }))).toBe(
      maskFrameKey(base),
    );
  });
});
