import type { EditState, HealStroke, MaskLayer, MaskStroke } from "@/types/editor";
import type { FromWorker, ToWorker } from "./renderProtocol";
import { internStrokes } from "./strokeInterning";

/**
 * The Worker's message handler, kept free of `self` so it can be tested in plain Node: everything
 * that touches the real Worker (posting messages, making the canvas, calling renderImage) is
 * injected, and render.worker.ts wires in the real ones.
 */

type RenderTargetLike = { transferToImageBitmap(): ImageBitmap };

export type RenderHandlerDeps<T extends RenderTargetLike> = {
  post: (message: FromWorker, transfer: Transferable[]) => void;
  createTarget: () => T;
  render: (
    source: ImageBitmap,
    width: number,
    height: number,
    edit: EditState,
    target: T,
    maxDimension: number,
    maskLayers: MaskLayer[] | undefined,
  ) => void;
};

type Source = { id: number; bitmap: ImageBitmap; width: number; height: number };

export function createRenderHandler<T extends RenderTargetLike>(deps: RenderHandlerDeps<T>) {
  let source: Source | null = null;
  let target: T | null = null;
  let healCache: readonly HealStroke[] | undefined;
  const maskCache = new Map<string, readonly MaskStroke[]>();

  const dropSource = () => {
    source?.bitmap.close();
    source = null;
    healCache = undefined;
    maskCache.clear();
  };

  /** Gives structured-cloned stroke arrays their old identity back; see strokeInterning.ts. */
  function prepare(edit: EditState, layers: MaskLayer[] | undefined) {
    // An empty list means "hidden" (Show original) or "undone to nothing"; keep the last real
    // history so toggling back finds its cache again.
    let healStrokes = edit.healStrokes;
    if (healStrokes.length > 0) {
      healCache = internStrokes(healCache, healStrokes);
      healStrokes = healCache as HealStroke[];
    }

    let maskLayers = layers;
    if (layers) {
      const live = new Set<string>();
      maskLayers = layers.map((layer) => {
        live.add(layer.id);
        if (layer.strokes.length === 0) return layer;
        const strokes = internStrokes(maskCache.get(layer.id), layer.strokes);
        maskCache.set(layer.id, strokes);
        return { ...layer, strokes: strokes as MaskStroke[] };
      });
      for (const id of maskCache.keys()) if (!live.has(id)) maskCache.delete(id);
    }
    return { edit: { ...edit, healStrokes }, maskLayers };
  }

  return function handle(message: ToWorker): void {
    switch (message.type) {
      case "setSource": {
        dropSource();
        source = {
          id: message.sourceId,
          bitmap: message.bitmap,
          width: message.width,
          height: message.height,
        };
        return;
      }
      case "clearSource": {
        dropSource();
        return;
      }
      case "render": {
        if (!source || source.id !== message.sourceId) {
          deps.post({ type: "error", requestId: message.requestId, message: "unknown-source" }, []);
          return;
        }
        try {
          target ??= deps.createTarget();
          const prepared = prepare(message.edit, message.maskLayers);
          deps.render(
            source.bitmap,
            source.width,
            source.height,
            prepared.edit,
            target,
            message.maxDimension,
            prepared.maskLayers,
          );
          const bitmap = target.transferToImageBitmap();
          deps.post(
            {
              type: "rendered",
              requestId: message.requestId,
              bitmap,
              width: bitmap.width,
              height: bitmap.height,
            },
            [bitmap],
          );
        } catch (error) {
          deps.post(
            {
              type: "error",
              requestId: message.requestId,
              message: error instanceof Error ? error.message : "render-failed",
            },
            [],
          );
        }
        return;
      }
    }
  };
}
