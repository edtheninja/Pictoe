import { describe, expect, it } from "vitest";
import { dabFromStroke } from "./cloneStamp";
import {
  frameOf,
  frameOutputSize,
  outputToSource,
  radiusToSource,
  sourceToOutput,
} from "./maskSpace";
import { DEFAULT_EDIT_STATE, type EditState, type HealStroke } from "@/types/editor";

/**
 * Clone strokes live in source space and are applied BEFORE crop, rotation and flip, so the
 * tool only works if what HealOverlay records (taps on the visible frame, converted to source
 * space) lands where the user pointed — for every crop, rotation and flip.
 *
 * `strokeFromTaps` repeats the few lines of HealOverlay that build a stroke; the conversions
 * it calls (outputToSource, radiusToSource) are the real ones.
 */
type Pt = { x: number; y: number };
const SRC_W = 1200;
const SRC_H = 800;
const BRUSH = 40; // HealOverlay's default brush size, in thousandths of the visible shorter side
const SOFT = 30;

const crops = [
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
  { x: 0.4, y: 0, width: 0.6, height: 1 },
];
const edits = (): EditState[] =>
  [0, 90, 180, 270].flatMap((rotation) =>
    [false, true].flatMap((flipH) =>
      crops.map((crop) => ({ ...DEFAULT_EDIT_STATE, rotation, flipH, crop })),
    ),
  );
const label = (e: EditState) =>
  `rot ${e.rotation}, flip ${e.flipH}, crop ${JSON.stringify(e.crop)}`;

function setup(edit: EditState) {
  const frame = frameOf(SRC_W, SRC_H, edit);
  const out = frameOutputSize(frame);
  const radius = radiusToSource(BRUSH / 1000, frame);
  /** First tap chooses the source; the first paint tap fixes the offset (as in HealOverlay). */
  const offsetFor = (sourceTap: Pt, firstPaintTap: Pt) => {
    const s = outputToSource(sourceTap, frame);
    const p = outputToSource(firstPaintTap, frame);
    return { dx: s.x - p.x, dy: s.y - p.y };
  };
  const strokeFromTaps = (paintTap: Pt, offset: { dx: number; dy: number }): HealStroke => {
    const at = outputToSource(paintTap, frame);
    return { x: at.x, y: at.y, dx: offset.dx, dy: offset.dy, radius, softness: SOFT };
  };
  /** Where a dab's centre and copy-from point end up on the visible frame, in output pixels. */
  const onScreen = (s: HealStroke) => {
    const d = dabFromStroke(s, SRC_W, SRC_H);
    const to = (px: number, py: number) => {
      const p = sourceToOutput({ x: px / SRC_W, y: py / SRC_H }, frame);
      return { x: p.x * out.width, y: p.y * out.height };
    };
    return { paint: to(d.cx, d.cy), from: to(d.cx + d.dx, d.cy + d.dy), radius: d.r };
  };
  return { out, offsetFor, strokeFromTaps, onScreen };
}

const SOURCE_TAP = { x: 0.7, y: 0.3 };
const FIRST_PAINT = { x: 0.3, y: 0.6 };
const LATER_PAINTS = [
  { x: 0.5, y: 0.5 },
  { x: 0.2, y: 0.8 },
  { x: 0.9, y: 0.1 },
];

describe("clone strokes follow the visible frame (crop × rotation × flip)", () => {
  it("paints exactly where the user tapped", () => {
    for (const edit of edits()) {
      const { out, offsetFor, strokeFromTaps, onScreen } = setup(edit);
      const offset = offsetFor(SOURCE_TAP, FIRST_PAINT);
      for (const tap of [FIRST_PAINT, ...LATER_PAINTS]) {
        const { paint } = onScreen(strokeFromTaps(tap, offset));
        expect(paint.x, label(edit)).toBeCloseTo(tap.x * out.width, 4);
        expect(paint.y, label(edit)).toBeCloseTo(tap.y * out.height, 4);
      }
    }
  });

  it("copies from the tapped source point on the first dab", () => {
    for (const edit of edits()) {
      const { out, offsetFor, strokeFromTaps, onScreen } = setup(edit);
      const { from } = onScreen(strokeFromTaps(FIRST_PAINT, offsetFor(SOURCE_TAP, FIRST_PAINT)));
      expect(from.x, label(edit)).toBeCloseTo(SOURCE_TAP.x * out.width, 4);
      expect(from.y, label(edit)).toBeCloseTo(SOURCE_TAP.y * out.height, 4);
    }
  });

  it("keeps the same on-screen distance between paint point and source while dragging", () => {
    for (const edit of edits()) {
      const { offsetFor, strokeFromTaps, onScreen } = setup(edit);
      const offset = offsetFor(SOURCE_TAP, FIRST_PAINT);
      const first = onScreen(strokeFromTaps(FIRST_PAINT, offset));
      const gap = { x: first.from.x - first.paint.x, y: first.from.y - first.paint.y };
      for (const tap of LATER_PAINTS) {
        const d = onScreen(strokeFromTaps(tap, offset));
        expect(d.from.x - d.paint.x, label(edit)).toBeCloseTo(gap.x, 4);
        expect(d.from.y - d.paint.y, label(edit)).toBeCloseTo(gap.y, 4);
      }
    }
  });

  it("applies a dab as large as the brush ring HealOverlay draws", () => {
    for (const edit of edits()) {
      const { out, strokeFromTaps, onScreen } = setup(edit);
      const ringRadiusPx = (BRUSH / 1000) * Math.min(out.width, out.height);
      const { radius } = onScreen(strokeFromTaps(FIRST_PAINT, { dx: 0.1, dy: 0.1 }));
      expect(radius, label(edit)).toBeCloseTo(ringRadiusPx, 4);
    }
  });

  it("keeps the copy-from distance when the view is rotated or flipped after choosing it", () => {
    // The offset is stored in source space, so a rigid change of view must not stretch it.
    const before = setup({ ...DEFAULT_EDIT_STATE });
    const offset = before.offsetFor(SOURCE_TAP, FIRST_PAINT);
    const len = (e: EditState) => {
      const { out, strokeFromTaps, onScreen } = setup(e);
      const d = onScreen(strokeFromTaps({ x: 0.5, y: 0.5 }, offset));
      void out;
      return Math.hypot(d.from.x - d.paint.x, d.from.y - d.paint.y);
    };
    const base = len({ ...DEFAULT_EDIT_STATE });
    for (const rotation of [90, 180, 270]) {
      expect(len({ ...DEFAULT_EDIT_STATE, rotation })).toBeCloseTo(base, 4);
      expect(len({ ...DEFAULT_EDIT_STATE, rotation, flipH: true })).toBeCloseTo(base, 4);
    }
  });
});
