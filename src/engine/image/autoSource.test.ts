import { describe, expect, it } from "vitest";
import { dabRects, dabReach, type Dab, type Patch } from "./cloneStamp";
import { healDab } from "./healBlend";
import {
  DIRECTIONS,
  DISTANCE_STEPS,
  MAX_EVALUATIONS,
  MAX_SEARCH_DISTANCE,
  REFINE_NEIGHBOURS,
  autoSourceWindow,
  defaultMaxDistance,
  findAutoSource,
  type Spot,
} from "./autoSource";

function image(w: number, h: number, fill: (x: number, y: number) => number[]): Patch {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r = 0, g = r, b = r] = fill(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { x: 0, y: 0, w, h, data };
}
const px = (p: Patch, x: number, y: number) => p.data[(Math.floor(y) * p.w + Math.floor(x)) * 4]!;
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r;

/** The values of every pixel in a disc, to check what the search picked. */
function discValues(p: Patch, cx: number, cy: number, r: number) {
  const inside = disc(cx, cy, r);
  const out: number[] = [];
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) if (inside(x, y)) out.push(px(p, x, y));
  return out;
}

const W = 240;
const H = 160;
const spot: Spot = { cx: 120, cy: 80, r: 8 };
const reach = dabReach({ cx: 0, cy: 0, dx: 0, dy: 0, r: spot.r, softness: 0, mode: "heal" });
const BLEMISH = disc(spot.cx, spot.cy, 6);

describe("findAutoSource: choosing a clean place with matching surroundings", () => {
  it("lands on plain background, not on the blemish, an odd patch or a textured area", () => {
    // Grey 100 everywhere, a bright blemish at the spot, a bright box and a checkerboard nearby.
    const img = image(W, H, (x, y) => {
      if (BLEMISH(x, y)) return [230];
      if (x >= 140 && x < 180 && y >= 60 && y < 100) return [200]; // a bright box to the right
      if (x >= 60 && x < 100 && y >= 60 && y < 100)
        return [(Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 160 : 40]; // texture to the left
      return [100];
    });
    const found = findAutoSource(img, W, H, spot)!;
    expect(found).not.toBeNull();

    const sx = spot.cx + found.dx;
    const sy = spot.cy + found.dy;
    const values = discValues(img, sx, sy, spot.r);
    expect(Math.min(...values)).toBe(100);
    expect(Math.max(...values)).toBe(100); // the whole disc is plain background
    // And it is not just next to the blemish: its ring is clean too.
    for (const v of discValues(img, sx, sy, reach)) expect(v).toBe(100);
  });

  it("prefers the side whose surroundings match the target's (a dark side next to a bright side)", () => {
    // Dark (60) left of x=100, bright (140) right of it; the spot is in the dark part, 20 px from the edge.
    const dark: Spot = { cx: 80, cy: 80, r: 6 };
    const img = image(W, H, (x, y) =>
      disc(dark.cx, dark.cy, 5)(x, y) ? [200] : x < 100 ? [60] : [140],
    );
    const found = findAutoSource(img, W, H, dark)!;
    expect(px(img, dark.cx + found.dx, dark.cy + found.dy)).toBe(60);
  });

  it("follows a gradient: the best source sits at the same brightness, straight above or below", () => {
    // Brightness depends on x only, so the same x means the same surroundings.
    const img = image(W, H, (x, y) => (BLEMISH(x, y) ? [250] : [40 + x]));
    const found = findAutoSource(img, W, H, spot)!;
    expect(Math.abs(found.dx)).toBeLessThanOrEqual(0.2 * Math.abs(found.dy));
  });

  it("avoids a nearer but busy area in favour of a farther clean one", () => {
    // Flat 100 with a noisy band hugging the spot's right side; plain ground is farther away.
    const img = image(W, H, (x, y) => {
      if (BLEMISH(x, y)) return [220];
      if (x >= 135 && x < 175) return [(x * 7 + y * 13) % 5 < 2 ? 40 : 170];
      return [100];
    });
    const found = findAutoSource(img, W, H, spot)!;
    const values = discValues(img, spot.cx + found.dx, spot.cy + found.dy, spot.r);
    expect(Math.max(...values) - Math.min(...values)).toBe(0);
  });

  it("rejects a flat patch that differs from its own surroundings, even when nothing else is wrong", () => {
    // Plain 100 ground with three flat 130 plateaus, well apart, at candidate positions on the
    // nearest ring: the first one is the first position the search tries. Each plateau has a
    // ring that matches the target's and no texture, so only "its own average differs from its
    // ring's" (the cleanliness term) can tell it from plain ground, and with ties on everything
    // else the nearest, first-tried candidate would be a plateau.
    const minD = spot.r + reach;
    const plateaus = [0, 5, 10].map((a) => ({
      cx: spot.cx + Math.cos((a / 16) * 2 * Math.PI) * minD,
      cy: spot.cy + Math.sin((a / 16) * 2 * Math.PI) * minD,
    }));
    const img = image(W, H, (x, y) => {
      if (BLEMISH(x, y)) return [230];
      return plateaus.some((p) => disc(p.cx, p.cy, spot.r * 0.95)(x, y)) ? [130] : [100];
    });
    const found = findAutoSource(img, W, H, spot)!;
    for (const v of discValues(img, spot.cx + found.dx, spot.cy + found.dy, spot.r))
      expect(v).toBe(100);
  });

  it("matches texture to texture: a grainy target prefers a grainy source over a smooth patch", () => {
    // Fine grain around 100 (steps of 4 levels) fills a disc of radius 42 around the spot, and
    // the rest of the picture is smooth, exactly 100. Smooth is the same average, so the ring
    // alone slightly prefers it (grain sector averages wobble), but a smooth patch pasted into a
    // grainy area would stand out; only the texture term makes the grainy neighbour win.
    // The grain's constants are chosen, not arbitrary: with texture ignored this scene picks the
    // smooth area, so a regression in that term is caught.
    const grain = (x: number, y: number) => 100 + (((x * 131 + y * 211 + x * y * 7) % 9) - 4) * 4;
    const img = image(W, H, (x, y) => {
      if (BLEMISH(x, y)) return [230];
      return Math.hypot(x + 0.5 - spot.cx, y + 0.5 - spot.cy) < 42 ? [grain(x, y)] : [100];
    });
    const found = findAutoSource(img, W, H, spot)!;
    const values = discValues(img, spot.cx + found.dx, spot.cy + found.dy, spot.r);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    expect(std).toBeGreaterThan(5);
  });

  it("looks past a busy neighbourhood to clean ground instead of taking the nearest candidate", () => {
    // Everything from 12 to 30 px around the spot is a harsh checkerboard; plain 100 beyond it.
    const near = (x: number, y: number) => Math.hypot(x + 0.5 - spot.cx, y + 0.5 - spot.cy);
    const img = image(W, H, (x, y) => {
      if (BLEMISH(x, y)) return [230];
      if (near(x, y) >= 12 && near(x, y) < 30) return [(x + y) % 2 ? 40 : 160];
      return [100];
    });
    const found = findAutoSource(img, W, H, spot)!;
    expect(Math.hypot(found.dx, found.dy)).toBeGreaterThan(30);
    const values = discValues(img, spot.cx + found.dx, spot.cy + found.dy, spot.r);
    expect(Math.max(...values) - Math.min(...values)).toBe(0);
  });

  it("refines past the coarse grid: on a tilted gradient it finds a source along the iso-line", () => {
    // Brightness is constant along a line tilted 10 degrees from horizontal (a slope of 0.5 per
    // pixel across it). The search's 16 directions are 22.5 degrees apart, so none lies on the
    // iso-line; the coarse winner is about 1.7 levels off, and only the refinement round gets close.
    const t = (10 * Math.PI) / 180;
    const level = (x: number, y: number) => 100 + 0.5 * (-Math.sin(t) * x + Math.cos(t) * y);
    const img = image(W, H, (x, y) => (BLEMISH(x, y) ? [250] : [Math.round(level(x, y) * 4) / 4]));
    const found = findAutoSource(img, W, H, spot)!;
    const difference = Math.abs(
      level(spot.cx + found.dx, spot.cy + found.dy) - level(spot.cx, spot.cy),
    );
    expect(difference).toBeLessThan(1);
  });

  it("is deterministic: the same picture and spot always give the same answer", () => {
    const img = image(W, H, (x, y) => [100 + ((x * 31 + y * 17) % 23), 90 + ((x * 5) % 11), 80]);
    const a = findAutoSource(img, W, H, spot);
    const b = findAutoSource(img, W, H, spot);
    expect(a).toEqual(b);
  });
});

describe("findAutoSource: limits", () => {
  const noisy = () =>
    image(W, H, (x, y) => [100 + ((x * 31 + y * 17) % 23), 90 + ((x * 5) % 11), 80]);

  it("never overlaps the spot, and the candidate and its ring stay on the picture", () => {
    for (const s of [spot, { cx: 40, cy: 30, r: 10 }, { cx: 200, cy: 130, r: 6 }]) {
      const found = findAutoSource(noisy(), W, H, s)!;
      expect(found).not.toBeNull();
      const d = Math.hypot(found.dx, found.dy);
      expect(d).toBeGreaterThanOrEqual(
        s.r + dabReach({ cx: 0, cy: 0, dx: 0, dy: 0, r: s.r, softness: 0, mode: "heal" }) - 1e-9,
      );
      const cx = s.cx + found.dx;
      const cy = s.cy + found.dy;
      const rr = dabReach({ cx: 0, cy: 0, dx: 0, dy: 0, r: s.r, softness: 0, mode: "heal" });
      expect(cx - rr).toBeGreaterThanOrEqual(0);
      expect(cy - rr).toBeGreaterThanOrEqual(0);
      expect(cx + rr).toBeLessThanOrEqual(W);
      expect(cy + rr).toBeLessThanOrEqual(H);
    }
  });

  it("keeps every chosen source, with its ring, on the picture, for spots all over a small picture", () => {
    // Plenty of spots near the edges and corners of a small picture, on a pseudo-random scene.
    const small = image(90, 70, (x, y) => [100 + ((x * 37 + y * 91 + x * y) % 41)]);
    let found = 0;
    for (let cy = 14; cy <= 56; cy += 7) {
      for (let cx = 14; cx <= 76; cx += 7) {
        const s: Spot = { cx, cy, r: 5 };
        const rr = dabReach({ cx: 0, cy: 0, dx: 0, dy: 0, r: s.r, softness: 0, mode: "heal" });
        const f = findAutoSource(small, 90, 70, s);
        if (!f) continue;
        found++;
        expect(cx + f.dx - rr).toBeGreaterThanOrEqual(0);
        expect(cy + f.dy - rr).toBeGreaterThanOrEqual(0);
        expect(cx + f.dx + rr).toBeLessThanOrEqual(90);
        expect(cy + f.dy + rr).toBeLessThanOrEqual(70);
      }
    }
    expect(found).toBeGreaterThan(40);
  });

  it("scores a bounded number of candidates, however big the spot or the picture", () => {
    // Pinned on purpose: 16 directions x 6 distances + 8 refinements. Growing the search means
    // changing this number, which is a decision about per-tap cost, not an accident.
    expect(MAX_EVALUATIONS).toBe(104);
    expect(DIRECTIONS * DISTANCE_STEPS + REFINE_NEIGHBOURS).toBe(104);
    const big = image(1200, 900, (x, y) => [100 + ((x * 31 + y * 17) % 23)]);
    for (const r of [3, 8, 40, 120]) {
      const found = findAutoSource(big, 1200, 900, { cx: 600, cy: 450, r })!;
      expect(found.evaluated).toBeGreaterThan(0);
      expect(found.evaluated).toBeLessThanOrEqual(MAX_EVALUATIONS);
    }
  });

  it("respects a search range", () => {
    const found = findAutoSource(noisy(), W, H, spot, 40)!;
    // 40 is below the minimum distance for this spot only if reach is large; here it allows ~40.
    expect(Math.hypot(found.dx, found.dy)).toBeLessThanOrEqual(40 * 1.2 + 1);
  });

  it("returns null when there is nowhere to look", () => {
    // A picture too small to hold a candidate away from the spot.
    const tiny = image(40, 40, () => [100]);
    expect(findAutoSource(tiny, 40, 40, { cx: 20, cy: 20, r: 10 })).toBeNull();
    // A spot whose own surroundings are mostly off the picture cannot be measured.
    expect(findAutoSource(noisy(), W, H, { cx: 1, cy: 1, r: 8 })).toBeNull();
  });
});

describe("autoSourceWindow", () => {
  it("covers every candidate and ring, clipped to the picture", () => {
    const w = autoSourceWindow(spot, W, H);
    const range = defaultMaxDistance(spot);
    expect(w.x).toBe(Math.max(0, Math.floor(spot.cx - range - reach) - 1));
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.x + w.w).toBeLessThanOrEqual(W);
    expect(w.y + w.h).toBeLessThanOrEqual(H);
    // Near a corner it is clipped, not negative.
    const corner = autoSourceWindow({ cx: 5, cy: 5, r: 4 }, W, H);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
  });

  it("keeps the window, and so the pixels read for one tap, bounded however big the brush", () => {
    // Without a cap the range is 10 reaches: a 120 px brush would read a 3,700 px square.
    expect(MAX_SEARCH_DISTANCE).toBe(600);
    for (const r of [4, 30, 120, 400]) {
      const s: Spot = { cx: 3000, cy: 2000, r };
      expect(defaultMaxDistance(s)).toBeLessThanOrEqual(MAX_SEARCH_DISTANCE);
      const w = autoSourceWindow(s, 6000, 4000);
      const reachR = dabReach({ cx: 0, cy: 0, dx: 0, dy: 0, r, softness: 0, mode: "heal" });
      expect(w.w).toBeLessThanOrEqual(2 * (MAX_SEARCH_DISTANCE + reachR) + 4);
    }
    // For everyday brushes the window is small: a 30 px brush reads under 2 megapixels.
    const w = autoSourceWindow({ cx: 3000, cy: 2000, r: 30 }, 6000, 4000);
    expect(w.w * w.h).toBeLessThan(2_000_000);
  });

  it("gives the same answer when the search reads only that window", () => {
    const img = image(W, H, (x, y) => [
      90 + ((x * 29 + y * 11) % 31),
      100 + ((x * 3) % 7),
      80 + ((y * 5) % 9),
    ]);
    const whole = findAutoSource(img, W, H, spot)!;

    const win = autoSourceWindow(spot, W, H);
    const data = new Uint8ClampedArray(win.w * win.h * 4);
    for (let j = 0; j < win.h; j++)
      data.set(
        img.data.subarray(((win.y + j) * W + win.x) * 4, ((win.y + j) * W + win.x + win.w) * 4),
        j * win.w * 4,
      );
    const cutOut = findAutoSource({ ...win, data }, W, H, spot)!;
    expect(cutOut).toEqual(whole);
  });

  it("a window of a narrower range is enough for that range", () => {
    const img = image(W, H, (x, y) => [100 + ((x * 31 + y * 17) % 23)]);
    const win = autoSourceWindow(spot, W, H, 50);
    expect(win.w).toBeLessThan(autoSourceWindow(spot, W, H).w);
    const data = new Uint8ClampedArray(win.w * win.h * 4);
    for (let j = 0; j < win.h; j++)
      data.set(
        img.data.subarray(((win.y + j) * W + win.x) * 4, ((win.y + j) * W + win.x + win.w) * 4),
        j * win.w * 4,
      );
    expect(findAutoSource({ ...win, data }, W, H, spot, 50)).toEqual(
      findAutoSource(img, W, H, spot, 50),
    );
  });
});

describe("auto source + heal blend together (a one-tap spot fix)", () => {
  // The blemish sits inside the brush's solid core (radius 5 of 8, with the soft edge starting at
  // 70%), as a user would aim it. Pixels in the soft edge are only partly replaced, by design.
  const blemish = disc(spot.cx, spot.cy, 5);
  const ramp = (x: number, y: number) => 60 + 0.5 * x + 0.2 * y;
  const scene = () => image(W, H, (x, y) => [blemish(x, y) ? 255 : Math.round(ramp(x, y))]);

  function healAt(img: Patch, found: { dx: number; dy: number }) {
    const dab: Dab = {
      cx: spot.cx,
      cy: spot.cy,
      dx: found.dx,
      dy: found.dy,
      r: spot.r,
      softness: 30,
      mode: "heal",
    };
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
    const dst = cut(rects.dst);
    healDab(cut(rects.src), dst, dab, W, H);
    return dst;
  }

  it("removes a blemish from a gradient: every blemish pixel ends within 1.5 levels of the ramp", () => {
    const img = scene();
    const found = findAutoSource(img, W, H, spot)!;
    const dst = healAt(img, found);

    let worst = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!blemish(x, y)) continue;
        const v = dst.data[((y - dst.y) * dst.w + (x - dst.x)) * 4]!;
        worst = Math.max(worst, Math.abs(v - ramp(x + 0.5, y + 0.5)));
      }
    expect(worst).toBeLessThan(1.5);
  });

  it("beats a source picked without looking when something is in the way (a wire 60 px to the right)", () => {
    // The same ramp, plus a dark stripe where a blind "copy from 60 px right" would land.
    const stripe = (x: number) => x >= 176 && x < 184;
    const img = image(W, H, (x, y) =>
      blemish(x, y) ? [255] : stripe(x) ? [20] : [Math.round(ramp(x, y))],
    );
    const found = findAutoSource(img, W, H, spot)!;
    const error = (d: Patch) => {
      let worst = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (blemish(x, y))
            worst = Math.max(
              worst,
              Math.abs(d.data[((y - d.y) * d.w + (x - d.x)) * 4]! - ramp(x + 0.5, y + 0.5)),
            );
      return worst;
    };
    expect(error(healAt(img, found))).toBeLessThan(1.5);
    expect(error(healAt(img, { dx: 60, dy: 0 }))).toBeGreaterThan(10);
    // And the search kept clear of the stripe.
    const sx = spot.cx + found.dx;
    for (let y = 0; y < H; y++) {
      for (let x = Math.floor(sx - reach); x <= Math.ceil(sx + reach); x++)
        expect(stripe(x) && Math.hypot(x - sx, y - (spot.cy + found.dy)) < reach).toBe(false);
    }
  });
});
