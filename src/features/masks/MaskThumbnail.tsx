import { useEffect, useMemo, useRef } from "react";
import { maskThumbnail } from "@/engine/image/maskHandles";
import { frameOutputSize, type MaskFrame } from "@/engine/image/maskSpace";
import type { MaskLayer } from "@/types/editor";

const THUMB_W = 40;
const THUMB_MIN_H = 24;
const THUMB_MAX_H = 56;

/**
 * What a layer covers, white on dark, over the visible frame (so it follows crop, rotation and
 * flip). Redrawn only when the layer's shape, strokes or invert flag change or the frame does.
 */
export function MaskThumbnail({ layer, frame }: { layer: MaskLayer; frame: MaskFrame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const out = frameOutputSize(frame);
  const h = Math.round(
    Math.min(THUMB_MAX_H, Math.max(THUMB_MIN_H, (THUMB_W * out.height) / out.width)),
  );

  const coverage = useMemo(
    () => maskThumbnail(layer, frame, THUMB_W, h),
    // The reducer replaces strokes / shape objects when they change, so identity is a safe key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      layer.strokes,
      layer.shape,
      layer.invert,
      frame.srcW,
      frame.srcH,
      frame.crop,
      frame.rotation,
      frame.flipH,
      h,
    ],
  );

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(THUMB_W, h);
    for (let k = 0; k < coverage.length; k++) {
      const v = 28 + Math.round((coverage[k]! / 255) * (235 - 28));
      img.data[k * 4] = v;
      img.data[k * 4 + 1] = v;
      img.data[k * 4 + 2] = v;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [coverage, h]);

  return (
    <canvas
      ref={ref}
      width={THUMB_W}
      height={h}
      aria-hidden="true"
      className={`shrink-0 rounded-sm border border-border ${layer.visible === false ? "opacity-40" : ""}`}
      style={{ width: THUMB_W, height: h }}
    />
  );
}
