import { describe, expect, it } from "vitest";
import { cloneDab, dabRects, dabReach, type Dab, type Patch } from "./cloneStamp";
import { RING_BINS, healDab, membraneAt, membraneFor, paintDab, ringOffsets } from "./healBlend";

/** A whole-image patch, so the same patch serves as the "source" and "target" snapshot. */
function image(w: number, h: number, fill: (x: number, y: number) => number[]): Patch {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r = 0, g = r, b = r, a = 255] = fill(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  return { x: 0, y: 0, w, h, data };
}
const copy = (p: Patch): Patch => ({ ...p, data: new Uint8ClampedArray(p.data) });
const pixel = (p: Patch, x: number, y: number) =>
  Array.from(p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4));

/** Paints one dab the way applyStrokes does: separate snapshots, then returns the result. */
function paint(img: Patch, d: Dab, how: typeof healDab = healDab): Patch {
  const dst = copy(img);
  how(copy(img), dst, d, img.w, img.h);
  return dst;
}

// A 120 × 60 picture. The target is the disc at (30, 30); the source is the disc at (90, 30).
const W = 120;
const H = 60;
const dab: Dab = { cx: 30, cy: 30, dx: 60, dy: 0, r: 12, softness: 0, mode: "heal" };
/** The same dab with no mode at all, as a stroke saved before modes would give. */
const withoutMode = (d: Dab): Dab => {
  const copied = { ...d };
  delete copied.mode;
  return copied;
};
const inDisc = (x: number, y: number, d: Dab = dab) =>
  Math.hypot(x + 0.5 - d.cx, y + 0.5 - d.cy) < d.r;

describe("heal: colour comes from the surroundings, texture from the source", () => {
  it("matches a brighter source to the darker target and covers a blemish completely", () => {
    // Target area is grey 100 with a bright blemish; the source area is plain grey 130.
    const img = image(W, H, (x, y) =>
      x < 60 ? [Math.hypot(x - 30, y - 30) < 6 ? 220 : 100] : [130],
    );

    const healed = paint(img, dab);
    const cloned = paint(img, dab, cloneDab);

    for (const [x, y] of [
      [30, 30],
      [27, 31],
      [36, 28],
      [24, 30],
      [30, 20],
    ] as const) {
      expect(pixel(healed, x, y)[0]).toBeCloseTo(100, 0); // the surroundings' brightness
      expect(pixel(cloned, x, y)[0]).toBe(130); // a plain clone leaves a visible 30-level patch
    }
  });

  it("reproduces a smooth gradient in the surroundings, not just their average", () => {
    // The target's surroundings ramp with x; the source is flat. A heal should follow the ramp.
    const ramp = (x: number) => 40 + 2 * x;
    const img = image(W, H, (x) => (x < 60 ? [ramp(x)] : [128]));

    const healed = paint(img, dab);
    let worst = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < 60; x++) {
        if (!inDisc(x, y)) continue;
        worst = Math.max(worst, Math.abs(pixel(healed, x, y)[0]! - ramp(x + 0.5)));
      }
    expect(worst).toBeLessThan(2.5);
    // And it really is a ramp across the patch (left darker than right by about 2 per pixel).
    expect(pixel(healed, 36, 30)[0]! - pixel(healed, 24, 30)[0]!).toBeGreaterThan(20);
  });

  it("keeps the source's texture: neighbouring pixels differ as they do in the source", () => {
    // Target is flat 100; the source is a fine checkerboard of 130 and 170.
    const img = image(W, H, (x, y) =>
      x < 60 ? [100] : [(Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 170 : 130],
    );
    const healed = paint(img, dab);

    let compared = 0;
    for (let y = 22; y < 38; y++)
      for (let x = 22; x < 38; x++) {
        if (!inDisc(x, y) || !inDisc(x + 1, y)) continue;
        const heal = pixel(healed, x + 1, y)[0]! - pixel(healed, x, y)[0]!;
        const source = pixel(img, x + 61, y)[0]! - pixel(img, x + 60, y)[0]!;
        // The shift is smooth, so a step between neighbours is the source's step (±1 for rounding).
        expect(Math.abs(heal - source)).toBeLessThanOrEqual(1);
        compared++;
      }
    expect(compared).toBeGreaterThan(100);
    // The patch sits at the target's brightness: the checkerboard's own mean (150) is moved to 100,
    // and its ±20 swing stays.
    const values: number[] = [];
    for (let y = 22; y < 38; y++)
      for (let x = 22; x < 38; x++) if (inDisc(x, y)) values.push(pixel(healed, x, y)[0]!);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean - 100)).toBeLessThan(6);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(30);
  });

  it("matches each colour channel separately, so a colour cast is corrected too", () => {
    // Target surroundings are warm (200, 150, 100); the source is cool (100, 150, 220).
    const img = image(W, H, (x) => (x < 60 ? [200, 150, 100] : [100, 150, 220]));
    const healed = paint(img, dab);
    for (const [x, y] of [
      [30, 30],
      [25, 33],
      [34, 26],
    ] as const) {
      const [r, g, b, a] = pixel(healed, x, y);
      expect(r).toBeCloseTo(200, 0);
      expect(g).toBeCloseTo(150, 0);
      expect(b).toBeCloseTo(100, 0);
      expect(a).toBe(255);
    }
  });

  it("is a no-op correction when source and target surroundings already match", () => {
    // Same flat colour both sides: a heal must come out the same as a clone.
    const img = image(W, H, (x, y) => (x < 60 ? [120] : [120 + ((x + y) % 3) * 4]));
    const healed = paint(img, dab);
    const cloned = paint(img, dab, cloneDab);
    // The textured source's mean is a little above 120, so allow its small bias; the point is
    // the heal does not wander off.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < 60; x++) {
        if (inDisc(x, y))
          expect(Math.abs(pixel(healed, x, y)[0]! - pixel(cloned, x, y)[0]!)).toBeLessThan(6);
      }
  });
});

describe("heal: edges and limits", () => {
  const striped = () => image(W, H, (x) => (x < 60 ? [100] : [130]));

  it("leaves every pixel outside the dab's radius untouched, ring included", () => {
    const img = striped();
    const healed = paint(img, dab);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!inDisc(x, y)) expect(pixel(healed, x, y)).toEqual(pixel(img, x, y));
      }
  });

  it("blends a soft edge into the target, like the clone stamp", () => {
    const img = striped();
    const soft = paint(img, { ...dab, softness: 100 });
    // Centre fully healed (100); a pixel near the edge is mostly still the target (100) too, and
    // the source-vs-target brightness gap (30) is gone everywhere, so the whole disc reads 100.
    for (const [x, y] of [
      [30, 30],
      [38, 30],
      [30, 40],
    ] as const) {
      expect(pixel(soft, x, y)[0]).toBeCloseTo(100, 0);
    }
  });

  it("never offsets alpha, and clamps colour to 0-255", () => {
    // Target is nearly white, the source is nearly black: the offset would overshoot both ways.
    const img = image(W, H, (x) => (x < 60 ? [250, 250, 250, 200] : [5, 5, 5, 77]));
    const healed = paint(img, dab);
    const [r, g, b, a] = pixel(healed, 30, 30);
    for (const v of [r, g, b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
      expect(v).toBeCloseTo(250, 0);
    }
    expect(a).toBe(77); // the source's alpha, as a clone would paint it
  });

  it("clamps the healed colour before blending it in at a soft edge, not after", () => {
    // Target 250, source 5 with one bright spike (255) that lands on target pixel (35, 30). The
    // healed colour there is 255 + 245 = 500, clamped to 255. At partial strength the result must
    // be a mix of 250 and 255 (about 252.7), not of 250 and 500 (which would clip to 255).
    const img = image(W, H, (x, y) => (x < 60 ? [250] : [x === 95 && y === 30 ? 255 : 5]));
    const healed = paint(img, { ...dab, softness: 100 });
    const v = pixel(healed, 35, 30)[0]!;
    expect(v).toBeGreaterThan(250);
    expect(v).toBeLessThan(254);
  });

  it("does not change the source snapshot it reads from", () => {
    const img = striped();
    const src = copy(img);
    const dst = copy(img);
    healDab(src, dst, dab, W, H);
    expect(Array.from(src.data)).toEqual(Array.from(img.data));
  });

  it("falls back to an exact clone when the ring has nothing to measure", () => {
    // A dab as big as the picture: every ring pixel is off the image.
    const img = image(40, 40, (x, y) => [(x * 5) % 256, (y * 5) % 256, 60]);
    const big: Dab = { cx: 20, cy: 20, dx: 0.0001, dy: 0, r: 100, softness: 0, mode: "heal" };
    expect(ringOffsets(copy(img), copy(img), big, 40, 40)).toBeNull();
    expect(Array.from(paint(img, big).data)).toEqual(Array.from(paint(img, big, cloneDab).data));
  });

  it("copes with a ring that is only partly on the image (target near an edge)", () => {
    // Target disc touches the left edge; half its ring is off the picture.
    const edge: Dab = { cx: 6, cy: 30, dx: 70, dy: 0, r: 12, softness: 0, mode: "heal" };
    const img = image(W, H, (x) => (x < 60 ? [100] : [130]));
    const ring = ringOffsets(copy(img), copy(img), edge, W, H)!;
    expect(ring).not.toBeNull();
    // Missing sectors are filled from their neighbours, so every sector holds a real offset (-30).
    for (let j = 0; j < RING_BINS; j++) expect(ring.offsets[j * 3]).toBeCloseTo(-30, 6);
    expect(pixel(paint(img, edge), 6, 30)[0]).toBeCloseTo(100, 0);
  });

  it("skips pixels whose source is off the image, as a clone does", () => {
    const img = striped();
    const off: Dab = { ...dab, dx: 200 }; // source entirely outside the image
    expect(Array.from(paint(img, off).data)).toEqual(Array.from(img.data));
  });
});

describe("the offset field (membrane)", () => {
  const offsetsOf = (f: (theta: number) => number) => {
    const out = new Float64Array(RING_BINS * 3);
    for (let j = 0; j < RING_BINS; j++) {
      const theta = -Math.PI + ((j + 0.5) * 2 * Math.PI) / RING_BINS;
      out.set([f(theta), 2 * f(theta), -f(theta)], j * 3);
    }
    return out;
  };

  it("is the constant itself for a constant ring, everywhere inside", () => {
    const m = membraneFor(offsetsOf(() => 7));
    const out = new Float64Array(3);
    for (const [x, y] of [
      [0, 0],
      [0.3, -0.4],
      [0.7, 0.2],
    ] as const) {
      membraneAt(m, x, y, out);
      expect(Array.from(out)).toEqual([
        expect.closeTo(7, 9),
        expect.closeTo(14, 9),
        expect.closeTo(-7, 9),
      ]);
    }
  });

  it("matches the ring at the ring's own radius and sector centres", () => {
    const f = (t: number) => 10 * Math.cos(t) + 4 * Math.sin(2 * t) + 3;
    const m = membraneFor(offsetsOf(f));
    const out = new Float64Array(3);
    for (let j = 0; j < RING_BINS; j += 3) {
      const t = -Math.PI + ((j + 0.5) * 2 * Math.PI) / RING_BINS;
      membraneAt(m, Math.cos(t), Math.sin(t), out);
      expect(out[0]).toBeCloseTo(f(t), 6);
    }
  });

  it("is exactly the harmonic extension: a first-harmonic ring gives a straight ramp inside", () => {
    // f = 10 cos θ on the ring is the line 10 x on the disc; the membrane must be that line.
    const m = membraneFor(offsetsOf((t) => 10 * Math.cos(t)));
    const out = new Float64Array(3);
    for (const [x, y] of [
      [0.5, 0.1],
      [-0.3, 0.6],
      [0.2, -0.7],
    ] as const) {
      membraneAt(m, x, y, out);
      expect(out[0]).toBeCloseTo(10 * x, 6);
    }
  });

  it("lets fine detail on the ring die away towards the centre", () => {
    const m = membraneFor(offsetsOf((t) => 10 * Math.cos(12 * t)));
    const out = new Float64Array(3);
    membraneAt(m, 0.5, 0, out);
    expect(Math.abs(out[0]!)).toBeLessThan(0.01); // 10 × 0.5^12
    membraneAt(m, 0, 0, out);
    expect(out[0]).toBeCloseTo(0, 9);
  });
});

describe("reach, rects and dispatch", () => {
  it("a heal dab reads a ring beyond its radius; a clone dab reads only the disc", () => {
    expect(dabReach({ ...dab, mode: "clone" })).toBe(12);
    expect(dabReach(withoutMode(dab))).toBe(12);
    expect(dabReach(dab)).toBeCloseTo(12 + 12 * 0.4, 9);
    // A tiny brush still gets a usable ring.
    expect(dabReach({ ...dab, r: 2 })).toBe(5);
  });

  it("the areas read for a heal dab cover the whole ring, and are bigger than for a clone", () => {
    const heal = dabRects(dab, W, H)!;
    const clone = dabRects({ ...dab, mode: "clone" }, W, H)!;
    expect(heal.dst.w).toBeGreaterThan(clone.dst.w);
    const reach = dabReach(dab);
    expect(heal.dst.x).toBeLessThanOrEqual(Math.floor(dab.cx - reach));
    expect(heal.dst.x + heal.dst.w).toBeGreaterThanOrEqual(Math.ceil(dab.cx + reach));
  });

  it("works on patches cut to dabRects, giving the same pixels as on the whole image", () => {
    const img = image(W, H, (x, y) =>
      x < 60 ? [100 + (x % 5), 90, 80 + (y % 7)] : [130, 140 + (x % 3), 120],
    );
    const whole = paint(img, dab);

    const rects = dabRects(dab, W, H)!;
    const cut = (r: { x: number; y: number; w: number; h: number }): Patch => {
      const data = new Uint8ClampedArray(r.w * r.h * 4);
      for (let j = 0; j < r.h; j++)
        data.set(
          img.data.subarray(((r.y + j) * W + r.x) * 4, ((r.y + j) * W + r.x + r.w) * 4),
          j * r.w * 4,
        );
      return { ...r, data };
    };
    const src = cut(rects.src);
    const dst = cut(rects.dst);
    paintDab(src, dst, dab, W, H);
    for (let j = 0; j < dst.h; j++)
      for (let i = 0; i < dst.w; i++) {
        expect(pixel(dst, i, j)).toEqual(pixel(whole, dst.x + i, dst.y + j));
      }
  });

  it("paintDab heals a heal dab and clones anything else", () => {
    const img = image(W, H, (x) => (x < 60 ? [100] : [130]));
    const run = (mode?: Dab["mode"]) => {
      const dst = copy(img);
      paintDab(copy(img), dst, mode ? { ...dab, mode } : withoutMode(dab), W, H);
      return pixel(dst, 30, 30)[0];
    };
    expect(run("heal")).toBeCloseTo(100, 0);
    expect(run("clone")).toBe(130);
    expect(run()).toBe(130);
  });
});
