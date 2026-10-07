import type { MaskStroke } from "@/types/editor";

type Entry<C> = {
  w: number;
  h: number;
  frameKey: string;
  strokes: readonly MaskStroke[];
  canvas: C;
};

export type MaskCachePlan = "reuse" | "append" | "rebuild";

/**
 * Decides how to bring a cached mask up to date with the current strokes.
 * The reducer replaces a layer's `strokes` array whenever it paints and keeps
 * the same array when only a slider moves, so array identity is a safe key.
 * `frameKey` covers everything that moves strokes within the frame (crop,
 * rotation, flip), so changing any of them forces a rebuild.
 */
export function planMaskUpdate(
  entry: Pick<Entry<unknown>, "w" | "h" | "frameKey" | "strokes"> | undefined,
  strokes: readonly MaskStroke[],
  w: number,
  h: number,
  frameKey: string,
): MaskCachePlan {
  if (!entry || entry.w !== w || entry.h !== h || entry.frameKey !== frameKey) return "rebuild";
  if (entry.strokes === strokes) return "reuse";

  const cachedCount = entry.strokes.length;
  // Fewer (or the same number of) strokes but a different array means an undo
  // or redo swapped in another snapshot; start over rather than guess.
  if (strokes.length <= cachedCount) return "rebuild";
  for (let i = 0; i < cachedCount; i++) {
    if (strokes[i] !== entry.strokes[i]) return "rebuild";
  }
  return "append";
}

/**
 * One rasterised mask per layer. Painting appends only the new strokes onto
 * the existing canvas, which is equivalent to a full redraw because strokes are
 * composited in order. Generic over the canvas and frame types so it can be
 * tested without a DOM.
 */
export class MaskCache<C, F> {
  private entries = new Map<string, Entry<C>>();

  constructor(
    private readonly create: (w: number, h: number) => C,
    private readonly draw: (
      canvas: C,
      w: number,
      h: number,
      strokes: readonly MaskStroke[],
      frame: F,
    ) => void,
    private readonly keyOf: (frame: F) => string,
  ) {}

  get(layerId: string, strokes: readonly MaskStroke[], w: number, h: number, frame: F): C {
    const frameKey = this.keyOf(frame);
    const entry = this.entries.get(layerId);
    const plan = planMaskUpdate(entry, strokes, w, h, frameKey);

    if (plan === "reuse") return entry!.canvas;

    if (plan === "append") {
      this.draw(entry!.canvas, w, h, strokes.slice(entry!.strokes.length), frame);
      entry!.strokes = strokes;
      return entry!.canvas;
    }

    const canvas = this.create(w, h);
    this.draw(canvas, w, h, strokes, frame);
    this.entries.set(layerId, { w, h, frameKey, strokes, canvas });
    return canvas;
  }

  /** Drops masks for layers that no longer exist. */
  prune(liveLayerIds: Iterable<string>) {
    const live = new Set(liveLayerIds);
    for (const id of this.entries.keys()) {
      if (!live.has(id)) this.entries.delete(id);
    }
  }

  clear() {
    this.entries.clear();
  }
}
