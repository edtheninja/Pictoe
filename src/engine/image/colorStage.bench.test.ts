import { describe, expect, it } from "vitest";
import { applyColorStage, planColorStage } from "./colorStage";
import {
  DEFAULT_ADJUSTMENTS,
  identityCurves,
  type Adjustments,
  type CurvesState,
} from "@/types/editor";

/**
 * How long the colour stage takes per frame, on this machine. Skipped in normal test runs; run it
 * with `npm run bench`.
 *
 * This times the pixel loop only (not getImageData/putImageData, which depend on the browser), so
 * read it as the stage's own cost. For scale: a 60 fps frame is about 16 ms, and about 150 ms is
 * where a slider drag starts to feel laggy when the work runs on the main thread.
 *
 * Sizes: a typical laptop preview, the largest preview Pictoe renders, and a 24 MP export.
 */

const enabled = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    "PICTOE_BENCH"
  ],
);

const SIZES: [string, number, number][] = [
  ["1.7 MP preview (1600x1067)", 1600, 1067],
  ["3.8 MP largest preview (2400x1600)", 2400, 1600],
  ["24 MP export (6000x4000)", 6000, 4000],
];

const TONAL = { highlights: -40, shadows: 50, whites: 20, blacks: -25 };

const S_CURVE = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.15 },
  { x: 0.75, y: 0.85 },
  { x: 1, y: 1 },
];
const SETTINGS: {
  label: string;
  adjustments: Partial<Adjustments>;
  curves?: Partial<CurvesState>;
}[] = [
  { label: "tonal (4 sliders)", adjustments: TONAL },
  { label: "RGB curve", adjustments: {}, curves: { rgb: S_CURVE } },
  { label: "RGB + luma curves", adjustments: {}, curves: { rgb: S_CURVE, luma: S_CURVE } },
  { label: "one band", adjustments: { satGreen: 30 } },
  {
    label: "tonal + curves + one band",
    adjustments: { ...TONAL, satGreen: 30 },
    curves: { rgb: S_CURVE, luma: S_CURVE },
  },
  {
    label: "all six bands",
    adjustments: {
      satRed: 20,
      satOrange: 20,
      satYellow: 20,
      satGreen: 20,
      satBlue: 20,
      satPurple: 20,
    },
  },
];

/** Photo-like pixels: smooth colour fields plus noise, so most pixels are saturated and in some band. */
function photo(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = 128 + 100 * Math.sin(x / 220) + (rnd() - 0.5) * 30;
      d[i + 1] = 128 + 100 * Math.sin(y / 180 + 1) + (rnd() - 0.5) * 30;
      d[i + 2] = 128 + 100 * Math.sin((x + y) / 300 + 2) + (rnd() - 0.5) * 30;
      d[i + 3] = 255;
    }
  }
  return d;
}

function medianMs(run: () => void, runs = 7): { median: number; best: number } {
  run(); // warm up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(runs / 2)]!, best: times[0]! };
}

describe.skipIf(!enabled)("colour stage timing (npm run bench)", () => {
  it("prints per-frame cost at preview and export sizes", { timeout: 300_000 }, () => {
    const rows: Record<string, string>[] = [];
    for (const [sizeLabel, w, h] of SIZES) {
      const base = photo(w, h);
      const work = new Uint8ClampedArray(base.length);
      const row: Record<string, string> = { size: sizeLabel };
      for (const { label, adjustments, curves } of SETTINGS) {
        const plan = planColorStage(
          { ...DEFAULT_ADJUSTMENTS, ...adjustments },
          { ...identityCurves(), ...curves },
        )!;
        const { median, best } = medianMs(() => {
          work.set(base); // each run starts from fresh pixels
          applyColorStage(work, plan);
        });
        row[label] = `${median.toFixed(0)} ms (best ${best.toFixed(0)})`;
      }
      rows.push(row);
    }
    console.table(rows);
    expect(rows).toHaveLength(SIZES.length);
  });
});
