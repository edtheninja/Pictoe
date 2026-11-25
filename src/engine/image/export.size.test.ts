import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EDIT_STATE, type EditState } from "@/types/editor";
import { fakeCanvas } from "./fakeCanvas.testutil";
import { exportImageSafely, outputSize, renderImage } from "./render";
import { resolveExportSize, type SizeSetting } from "./exportSize";

/**
 * The export path end to end, in Node, with a fake canvas: the size the panel promises (from
 * resolveExportSize) must be the size the renderer draws at and the size of the file that comes
 * back, through crop, rotation and a browser that refuses large images. Pixels are not computed;
 * only sizes, which is what is being promised.
 */

const edit = (patch: Partial<EditState> = {}): EditState => ({ ...DEFAULT_EDIT_STATE, ...patch });
const percent = (p: number): SizeSetting => ({ mode: "percent", percent: p });
const edge = (pixels: number): SizeSetting => ({ mode: "longEdge", pixels });

describe("renderImage draws at exactly the size the export settings promise", () => {
  it("for awkward sizes where rounding matters", () => {
    // 5472 x 3648 at 1999 is 1332.66 on the short side: nearest is 1333, rounding down would be 1332.
    for (const [w, h, max] of [
      [5472, 3648, 1999],
      [6000, 4000, 2047],
      [4000, 6000, 1111],
      [3024, 4032, 777],
      [999, 1001, 333],
    ] as const) {
      const wanted = resolveExportSize(edge(max), w, h);
      const drew = renderImage(
        {} as CanvasImageSource,
        w,
        h,
        edit(),
        fakeCanvas() as never,
        wanted.longEdge,
      );
      expect({ width: drew.width, height: drew.height }).toEqual({
        width: wanted.width,
        height: wanted.height,
      });
    }
  });

  it("through rotation and crop, which change the size before scaling", () => {
    const rotated = edit({ rotation: 90 });
    const cropped = edit({ crop: { x: 0.1, y: 0.2, width: 0.55, height: 0.45 } });
    for (const e of [rotated, cropped]) {
      const full = outputSize(6000, 4000, e);
      for (const setting of [percent(50), percent(33), edge(1000), edge(2048)]) {
        const wanted = resolveExportSize(setting, full.width, full.height);
        const drew = renderImage(
          {} as CanvasImageSource,
          6000,
          4000,
          e,
          fakeCanvas() as never,
          wanted.longEdge,
        );
        expect({ width: drew.width, height: drew.height }).toEqual({
          width: wanted.width,
          height: wanted.height,
        });
      }
    }
  });
});

describe("exportImageSafely with a chosen size", () => {
  /** A document whose canvases save a file unless they are bigger than `maxPixels`. */
  let saved: { width: number; height: number }[] = [];
  function stubBrowser(maxPixels = Infinity) {
    saved = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = fakeCanvas() as ReturnType<typeof fakeCanvas> & {
          toBlob: (cb: (b: Blob | null) => void) => void;
        };
        canvas.toBlob = (cb) => {
          saved.push({ width: canvas.width, height: canvas.height });
          cb(canvas.width * canvas.height <= maxPixels ? new Blob([new Uint8Array(8)]) : null);
        };
        return canvas;
      },
    });
  }
  beforeEach(() => stubBrowser());
  afterEach(() => vi.unstubAllGlobals());

  const run = (e: EditState, size?: SizeSetting) =>
    size
      ? exportImageSafely({} as CanvasImageSource, 6000, 4000, e, "image/png", 0.9, undefined, size)
      : exportImageSafely({} as CanvasImageSource, 6000, 4000, e, "image/png", 0.9);

  it("saves at the original size when no size is given, as before", async () => {
    const r = await run(edit());
    expect(r).toMatchObject({
      width: 6000,
      height: 4000,
      scaled: false,
      full: { width: 6000, height: 4000 },
    });
    expect(r.requested).toMatchObject({ width: 6000, height: 4000, note: null });
    expect(saved).toEqual([{ width: 6000, height: 4000 }]);
  });

  it("saves at the size asked for: a percent, or a longest side", async () => {
    const half = await run(edit(), percent(50));
    expect(half).toMatchObject({ width: 3000, height: 2000, scaled: false });
    expect(half.full).toEqual({ width: 6000, height: 4000 }); // the photo itself is unchanged
    expect(half.requested).toMatchObject({ width: 3000, height: 2000 });

    const web = await run(edit(), edge(2048));
    expect(web).toMatchObject({ width: 2048, height: 1365, scaled: false });
    // The file is the only one made: no attempt at the full size first.
    expect(saved).toEqual([
      { width: 3000, height: 2000 },
      { width: 2048, height: 1365 },
    ]);
  });

  it("measures the size from the photo as cropped and rotated", async () => {
    const turned = await run(edit({ rotation: 90 }), edge(2048));
    expect(turned).toMatchObject({ width: 1365, height: 2048 });
    const cropped = await run(edit({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }), percent(50));
    expect(cropped).toMatchObject({ width: 1500, height: 1000 });
  });

  it("is never larger than the photo, however large it is asked", async () => {
    const r = await run(edit(), edge(50_000));
    expect(r).toMatchObject({ width: 6000, height: 4000 });
    expect(r.requested.note).toBe("not-upscaled");
  });

  it("steps down from the size asked for, and says it came out smaller than asked", async () => {
    stubBrowser(5_000_000); // a browser that cannot save more than 5 megapixels
    const r = await run(edit(), edge(4000)); // asked for 4000 x 2667 (10.7 MP)
    expect(r.scaled).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(5_000_000);
    expect(r.requested).toMatchObject({ width: 4000, height: 2667 });
    // The first attempt was at the size asked for, not at the photo's full 6000.
    expect(saved[0]).toEqual({ width: 4000, height: 2667 });
  });

  it("does not report 'scaled' just because the photo was made smaller on purpose", async () => {
    const r = await run(edit(), percent(25));
    expect(r.scaled).toBe(false);
    expect(r).toMatchObject({ width: 1500, height: 1000 });
  });
});
