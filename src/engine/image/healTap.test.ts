import { describe, expect, it } from "vitest";
import { autoSourceWindow, findAutoSource } from "./autoSource";
import { autoSourceFor, type ReadPixels } from "./healTap";
import type { Rect } from "./cloneStamp";
import { applyStrokes, type Surface } from "./healedSource";
import type { HealStroke } from "@/types/editor";

/** A picture as an array, with a reader that records every rectangle asked for. */
function picture(w: number, h: number, fill: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data.set([fill(x, y), fill(x, y), fill(x, y), 255], (y * w + x) * 4);
  const asked: Rect[] = [];
  const read: ReadPixels = (r) => {
    asked.push(r);
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    for (let j = 0; j < r.h; j++)
      out.set(
        data.subarray(((r.y + j) * w + r.x) * 4, ((r.y + j) * w + r.x + r.w) * 4),
        j * r.w * 4,
      );
    return out;
  };
  return { read, asked, w, h };
}

describe("autoSourceFor", () => {
  const W = 400;
  const H = 300;
  const blemish = (x: number, y: number) => Math.hypot(x + 0.5 - 200, y + 0.5 - 150) < 6;
  const flat = () => picture(W, H, (x, y) => (blemish(x, y) ? 230 : 100));

  it("returns the offset as fractions of the photo's width and height", () => {
    const p = flat();
    const found = autoSourceFor(p.read, W, H, { x: 0.5, y: 0.5 }, 0.03)!;
    expect(found).not.toBeNull();
    // In pixels it must be at least the brush radius plus its ring away.
    const px = Math.hypot(found.dx * W, found.dy * H);
    expect(px).toBeGreaterThan(9 + 12);
    // And it lands on plain ground: the picture there is 100.
    const sx = Math.floor(200 + found.dx * W);
    const sy = Math.floor(150 + found.dy * H);
    expect(p.read({ x: sx, y: sy, w: 1, h: 1 })[0]).toBe(100);
  });

  it("is exactly the search's own pixel offset divided by the photo's width and height", () => {
    // A non-square picture, so dividing dy by the wrong dimension would be visible.
    const p = picture(W, H, (x, y) => (blemish(x, y) ? 230 : 100 + ((x * 3 + y * 7) % 11)));
    const spot = { cx: 200, cy: 150, r: 0.03 * Math.min(W, H) };
    const window = autoSourceWindow(spot, W, H);
    const direct = findAutoSource({ ...window, data: p.read(window) }, W, H, spot)!;

    const found = autoSourceFor(p.read, W, H, { x: 0.5, y: 0.5 }, 0.03)!;
    expect(found.dx * W).toBeCloseTo(direct.dx, 9);
    expect(found.dy * H).toBeCloseTo(direct.dy, 9);
    expect(found.score).toBe(direct.score);
    expect(Math.abs(direct.dy)).toBeGreaterThan(1); // so the check above can tell W from H
  });

  it("reads one rectangle only: the window the search needs, not the whole photo", () => {
    const p = flat();
    autoSourceFor(p.read, W, H, { x: 0.5, y: 0.5 }, 0.03);
    expect(p.asked).toHaveLength(1);
    expect(p.asked[0]).toEqual(
      autoSourceWindow({ cx: 200, cy: 150, r: 0.03 * Math.min(W, H) }, W, H),
    );
  });

  it("converts the brush radius using the shorter side, as strokes do", () => {
    const asked = (radius: number) => {
      const p = picture(800, 200, () => 100);
      autoSourceFor(p.read, 800, 200, { x: 0.5, y: 0.5 }, radius);
      return p.asked[0]!;
    };
    // The same fraction on a wide picture means a small brush (shorter side 200), so a small window.
    expect(asked(0.05).w).toBeLessThan(asked(0.4).w);
  });

  it("returns null with nothing to look at: zero brush, a spot at the edge, or a tiny picture", () => {
    const p = flat();
    expect(autoSourceFor(p.read, W, H, { x: 0.5, y: 0.5 }, 0)).toBeNull();
    expect(autoSourceFor(p.read, W, H, { x: 0.0, y: 0.0 }, 0.03)).toBeNull();
    const tiny = picture(30, 30, () => 100);
    expect(autoSourceFor(tiny.read, 30, 30, { x: 0.5, y: 0.5 }, 0.15)).toBeNull();
  });

  it("is deterministic", () => {
    const a = autoSourceFor(flat().read, W, H, { x: 0.5, y: 0.5 }, 0.03);
    const b = autoSourceFor(flat().read, W, H, { x: 0.5, y: 0.5 }, 0.03);
    expect(a).toEqual(b);
  });
});

describe("a tap, end to end (search, stroke, render), on a non-square photo", () => {
  it("removes a blemish from a gradient, with no source chosen", () => {
    const w = 500;
    const h = 320;
    const ramp = (x: number, y: number) => 60 + 0.25 * x + 0.1 * y;
    const spotX = 0.62;
    const spotY = 0.4;
    const inBlemish = (x: number, y: number) =>
      Math.hypot(x + 0.5 - spotX * w, y + 0.5 - spotY * h) < 5;

    // The photo, as one RGBA array that both the reader and the renderer's surface share.
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = inBlemish(x, y) ? 255 : Math.round(ramp(x, y));
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    const read: ReadPixels = (r) => {
      const out = new Uint8ClampedArray(r.w * r.h * 4);
      for (let j = 0; j < r.h; j++)
        out.set(
          data.subarray(((r.y + j) * w + r.x) * 4, ((r.y + j) * w + r.x + r.w) * 4),
          j * r.w * 4,
        );
      return out;
    };
    const surface: Surface = {
      width: w,
      height: h,
      read: (x, y, rw, rh) => read({ x, y, w: rw, h: rh }),
      write: (src, x, y, rw, rh) => {
        for (let j = 0; j < rh; j++)
          data.set(src.subarray(j * rw * 4, (j + 1) * rw * 4), ((y + j) * w + x) * 4);
      },
    };

    // What the overlay does on a tap in Heal mode.
    const radius = 8 / Math.min(w, h); // a brush of 8 px
    const found = autoSourceFor(read, w, h, { x: spotX, y: spotY }, radius)!;
    expect(found).not.toBeNull();
    const stroke: HealStroke = {
      x: spotX,
      y: spotY,
      dx: found.dx,
      dy: found.dy,
      radius,
      softness: 30,
      mode: "heal",
    };
    applyStrokes(surface, [stroke]);

    let worst = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (inBlemish(x, y))
          worst = Math.max(worst, Math.abs(data[(y * w + x) * 4]! - ramp(x + 0.5, y + 0.5)));
    expect(worst).toBeLessThan(1.5);
  });
});
