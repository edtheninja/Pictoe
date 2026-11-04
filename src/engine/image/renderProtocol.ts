import type { EditState, MaskLayer } from "@/types/editor";

/** Messages between the main thread and the preview render Worker. */

export type ToWorker =
  /** Replaces the Worker's source image. The bitmap is transferred, not copied. */
  | { type: "setSource"; sourceId: number; bitmap: ImageBitmap; width: number; height: number }
  /** Frees the Worker's source image (the editor was cleared). */
  | { type: "clearSource" }
  | {
      type: "render";
      requestId: number;
      sourceId: number;
      edit: EditState;
      maxDimension: number;
      maskLayers: MaskLayer[] | undefined;
    };

export type FromWorker =
  | { type: "rendered"; requestId: number; bitmap: ImageBitmap; width: number; height: number }
  | { type: "error"; requestId: number; message: string };
