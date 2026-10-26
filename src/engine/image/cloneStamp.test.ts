import { describe, expect, it } from "vitest";
import { cloneDab, dabFromStroke, dabRects, type Dab, type Patch } from "./cloneStamp";
import type { HealStroke } from "@/types/editor";

/** A w×h image where every pixel's red channel encodes its own x, green its y. */
function gradient(w: number, h: number): Patch {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 10;
      data[i + 1] = y * 10;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  return { x: 0, y: 0, w, h, data };
}
const copy = (p: Patch): Patch => ({ ...p, data: new Uint8ClampedArray(p.data) });
/** A copy of one rectangle of an image, like Surface.read would return. */
function cut(img: Patch, r: { x: number; y: number; w: number; h: number }): Patch {
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * img.w + r.x) * 4;
    data.set(img.data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return { ...r, data };
}
const px = (p: Patch, x: number, y: number) => {
  const i = ((y - p.y) * p.w + (x - p.x)) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
};

describe("dabFromStroke", () => {
  it("converts 0–1 stroke fields to source pixels, radius against the shorter side", () => {
    const s: HealStroke = { x: 0.5, y: 0.25, dx: 0.1, dy: -0.2, radius: 0.1, softness: 30 };
    expect(dabFromStroke(s, 200, 100)).toEqual({
      cx: 100,
      cy: 25,
      dx: 20,
      dy: -20,
      r: 10,
      softness: 30,
    });
  });

  it("clamps softness to 0–100", () => {
    const base = { x: 0, y: 0, dx: 0, dy: 0, radius: 0.1 };
    expect(dabFromStroke({ ...base, softness: 250 }, 10, 10).softness).toBe(100);
    expect(dabFromStroke({ ...base, softness: -5 }, 10, 10).softness).toBe(0);
  });
});

describe("dabRects", () => {
  it("clips both areas to the image", () => {
    const d: Dab = { cx: 1, cy: 1, dx: 5, dy: 5, r: 4, softness: 0 };
    const r = dabRects(d, 20, 20)!;
    expect(r.dst.x).toBe(0);
    expect(r.dst.y).toBe(0);
    expect(r.src.x + r.src.w).toBeLessThanOrEqual(20);
  });

  it("returns null when either area is completely outside the image", () => {
    expect(dabRects({ cx: 5, cy: 5, dx: 500, dy: 0, r: 3, softness: 0 }, 20, 20)).toBeNull();
    expect(dabRects({ cx: -50, cy: 5, dx: 0, dy: 0, r: 3, softness: 0 }, 20, 20)).toBeNull();
  });
});

describe("cloneDab", () => {
  const W = 30;
  const H = 30;

  it("copies source pixels into the dab centre with a hard edge", () => {
    const img = gradient(W, H);
    const d: Dab = { cx: 8.5, cy: 8.5, dx: 10, dy: 0, r: 4, softness: 0 };
    const rects = dabRects(d, W, H)!;
    const t = cut(img, rects.dst);
    cloneDab(cut(img, rects.src), t, d, W, H);

    // Pixel (8,8) is the centre: it must now hold what was at (18,8).
    expect(px(t, 8, 8)).toEqual(px(img, 18, 8));
    // A pixel outside the radius is untouched.
    expect(px(t, 12, 8)).toEqual(px(img, 12, 8));
  });

  it("feathers: a soft dab blends towards the edge instead of cutting off", () => {
    const img = gradient(W, H);
    const rect = { x: 0, y: 0, w: W, h: H };
    const hard: Dab = { cx: 10.5, cy: 10.5, dx: 12, dy: 0, r: 8, softness: 0 };
    const soft: Dab = { ...hard, softness: 100 };
    const a = copy({ ...rect, data: img.data });
    const b = copy({ ...rect, data: img.data });
    cloneDab(copy(img), a, hard, W, H);
    cloneDab(copy(img), b, soft, W, H);
    // Near the rim the hard dab has fully replaced the pixel; the soft one only partly.
    const orig = px(img, 17, 10)[0]!;
    const hardVal = px(a, 17, 10)[0]!;
    const softVal = px(b, 17, 10)[0]!;
    expect(hardVal).not.toBe(orig);
    expect(Math.abs(softVal - orig)).toBeLessThan(Math.abs(hardVal - orig));
  });

  it("skips pixels whose source falls outside the image instead of smearing", () => {
    const img = gradient(W, H);
    const dst = copy(img);
    // Copies from 20px to the left of the dab: the dab is at x≈5, so the source is off-image.
    cloneDab(copy(img), dst, { cx: 5.5, cy: 15.5, dx: -20, dy: 0, r: 4, softness: 0 }, W, H);
    expect(dst.data).toEqual(img.data);
  });

  it("reads from the pre-dab snapshot, so overlapping source and target don't smear", () => {
    const img = gradient(W, H);
    const snapshot = copy(img);
    const target = copy(img);
    // Source overlaps the target (offset smaller than the radius).
    const d: Dab = { cx: 15.5, cy: 15.5, dx: 2, dy: 0, r: 6, softness: 0 };
    cloneDab(snapshot, target, d, W, H);
    // Centre pixel (15,15) takes the value from (17,15) as it was BEFORE painting.
    expect(px(target, 15, 15)).toEqual(px(img, 17, 15));
  });
});
