import { describe, expect, it } from "vitest";
import { EXPORT_SCALES, describeScaledExport, exportWithFallback } from "./exportFallback";

const blob = (n = 10) => new Blob([new Uint8Array(n)]);
/** A fake browser that can only make images up to `maxArea` pixels. */
const browserLimitedTo = (maxArea: number, fullW: number, fullH: number) => {
  const tried: number[] = [];
  const attempt = async (maxDimension: number) => {
    tried.push(maxDimension);
    const scale = Math.min(1, maxDimension / Math.max(fullW, fullH));
    const width = Math.round(fullW * scale);
    const height = Math.round(fullH * scale);
    return { blob: width * height <= maxArea ? blob() : null, width, height };
  };
  return { attempt, tried };
};

describe("exportWithFallback", () => {
  it("saves at full size when the browser can", async () => {
    const { attempt, tried } = browserLimitedTo(Infinity, 6000, 4000);
    const result = await exportWithFallback(6000, 4000, attempt);
    expect(result).toMatchObject({ width: 6000, height: 4000, scaled: false });
    expect(tried).toEqual([6000]);
  });

  it("steps down until the browser produces a file, and says it was scaled", async () => {
    // Like an iPhone: about 16.7 megapixels at most. A 24 MP photo (6000×4000) must be reduced.
    const { attempt, tried } = browserLimitedTo(16_777_216, 6000, 4000);
    const result = await exportWithFallback(6000, 4000, attempt);
    expect(result.scaled).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(16_777_216);
    expect(result.width).toBe(4500); // the first step, 75%, already fits (18 MP is too big, 13.5 MP isn't)
    expect(tried).toEqual([6000, 4500]);
  });

  it("keeps the proportions of the photo", async () => {
    const { attempt } = browserLimitedTo(1_000_000, 6000, 4000);
    const result = await exportWithFallback(6000, 4000, attempt);
    expect(result.width / result.height).toBeCloseTo(1.5, 1);
  });

  it("treats a thrown error (out of memory) like a null result and carries on", async () => {
    let calls = 0;
    const result = await exportWithFallback(1000, 800, async (maxDimension) => {
      if (++calls === 1) throw new RangeError("Array buffer allocation failed");
      return { blob: blob(), width: maxDimension, height: Math.round(maxDimension * 0.8) };
    });
    expect(calls).toBe(2);
    expect(result.scaled).toBe(true);
  });

  it("treats an empty file as a failure", async () => {
    let calls = 0;
    const result = await exportWithFallback(1000, 800, async (maxDimension) => ({
      blob: ++calls === 1 ? blob(0) : blob(),
      width: maxDimension,
      height: 1,
    }));
    expect(calls).toBe(2);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("gives up with an error only after every size has failed", async () => {
    let calls = 0;
    await expect(
      exportWithFallback(4000, 3000, async () => {
        calls++;
        return { blob: null, width: 1, height: 1 };
      }),
    ).rejects.toThrow("encode-failed");
    expect(calls).toBe(EXPORT_SCALES.length);
  });

  it("skips sizes whose longest side no canvas can have", async () => {
    const tried: number[] = [];
    await exportWithFallback(40000, 100, async (maxDimension) => {
      tried.push(maxDimension);
      return { blob: blob(), width: maxDimension, height: 1 };
    });
    expect(tried[0]).toBe(30000); // 40000 and its 75% (30000) — only sizes ≤ 32,767 are tried
    expect(tried.every((d) => d <= 32767)).toBe(true);
  });
});

describe("describeScaledExport", () => {
  it("says what was saved and what the full size was", () => {
    expect(describeScaledExport({ width: 6000, height: 4000 }, { width: 4500, height: 3000 })).toBe(
      "Saved at 4,500 × 3,000 instead of 6,000 × 4,000, because this browser couldn't make a larger image.",
    );
  });
});
