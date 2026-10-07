import { useRef } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import { frameOf, outputToSource, radiusToSource } from "@/engine/image/maskSpace";

const BRUSH_RADIUS = 0.06; // normalized to min(width, height) of the current output frame
const MIN_STROKE_SPACING = 0.015; // skip near-duplicate points during a fast drag

/**
 * Paints brush strokes onto the active mask layer.
 * Sits in the same zoom/pan-transformed wrapper as Canvas's own <canvas>,
 * so pointer coordinates map directly via this element's own bounding rect.
 */
export function MaskOverlay() {
  const { state, paintMaskStroke, recordMaskHistory } = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const paintingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  if (state.activeTool !== "mask") return null;

  const activeId = state.activeMaskLayerId;
  const mode = state.maskMode;

  const paintAt = (clientX: number, clientY: number) => {
    if (!activeId) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    const last = lastPointRef.current;

    if (last) {
      const dist = Math.hypot(x - last.x, y - last.y);
      if (dist < MIN_STROKE_SPACING) return;
    }

    lastPointRef.current = { x, y };

    // Strokes are stored relative to the source image, so they stay attached to the
    // picture if the crop, rotation or flip changes later.
    const source = state.source;
    if (!source) return;
    const frame = frameOf(source.width, source.height, state.edit);
    const at = outputToSource({ x, y }, frame);

    paintMaskStroke(activeId, {
      x: at.x,
      y: at.y,
      radius: radiusToSource(state.maskBrushSize / 1000, frame),
      softness: state.maskBrushSoftness,
      mode,
    });
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 touch-none"
      style={{
        cursor: activeId ? "crosshair" : "default",
      }}
      onPointerDown={(e) => {
        if (!activeId) return;

        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        recordMaskHistory();
        paintingRef.current = true;
        lastPointRef.current = null;

        paintAt(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!paintingRef.current) return;

        paintAt(e.clientX, e.clientY);
      }}
      onPointerUp={() => {
        paintingRef.current = false;
        lastPointRef.current = null;
      }}
      onPointerCancel={() => {
        paintingRef.current = false;
        lastPointRef.current = null;
      }}
    >
      {!activeId && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-elevated/90 px-md py-sm text-[13px] text-text-secondary backdrop-blur">
          Add an area to start painting
        </div>
      )}
    </div>
  );
}
