import { useRef, useState } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import {
  frameOf,
  frameOutputSize,
  outputToSource,
  radiusToSource,
  sourceToOutput,
} from "@/engine/image/maskSpace";

/** A new dab every quarter of a brush radius keeps strokes smooth without piling up dabs. */
const SPACING = 0.25;

type Point = { x: number; y: number };

/**
 * The clone tool's canvas layer. First tap picks where to copy from; after that, dragging paints
 * a copy of that area over the spot under the brush. Strokes are stored relative to the source
 * image (like masks), and one drag is one undo step. A second finger means pinch-to-zoom, so it
 * stops painting.
 */
export function HealOverlay() {
  const { state, addHealStroke, setHealSource, setHealOffset, beginInteraction, endInteraction } =
    useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const paintingPointer = useRef<number | null>(null);
  const activePointers = useRef(new Set<number>());
  const lastDab = useRef<Point | null>(null);
  const offsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null); // in the visible frame, 0–1

  const source = state.source;
  if (!source) return null;

  const frame = frameOf(source.width, source.height, state.edit);
  const visible = frameOutputSize(frame);
  const brushRadius = radiusToSource(state.healBrushSize / 1000, frame); // fraction of source's shorter side
  const brushPx = brushRadius * Math.min(source.width, source.height);

  const locate = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { frame: { x, y }, src: outputToSource({ x, y }, frame) };
  };

  const paintAt = (at: Point) => {
    const offset = offsetRef.current;
    if (!offset) return;
    const last = lastDab.current;
    if (last) {
      const moved = Math.hypot((at.x - last.x) * source.width, (at.y - last.y) * source.height);
      if (moved < SPACING * brushPx) return;
    }
    lastDab.current = at;
    addHealStroke({
      x: at.x,
      y: at.y,
      dx: offset.dx,
      dy: offset.dy,
      radius: brushRadius,
      softness: state.healBrushSoftness,
    });
  };

  const finishPainting = () => {
    if (paintingPointer.current !== null) endInteraction();
    paintingPointer.current = null;
    lastDab.current = null;
  };

  // Where the brush is copying from right now, shown as a ring that follows the cursor.
  const offset = state.healOffset;
  const hover = cursor ? outputToSource(cursor, frame) : null;
  const copyingFrom: Point | null =
    hover && offset ? { x: hover.x + offset.dx, y: hover.y + offset.dy } : state.healSource;
  const ringAt = copyingFrom ? sourceToOutput(copyingFrom, frame) : null;
  const showRing = ringAt && ringAt.x >= 0 && ringAt.x <= 1 && ringAt.y >= 0 && ringAt.y <= 1;
  const shorter = Math.min(visible.width, visible.height);
  const ringW = ((2 * (state.healBrushSize / 1000) * shorter) / visible.width) * 100;
  const ringH = ((2 * (state.healBrushSize / 1000) * shorter) / visible.height) * 100;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 touch-none"
      style={{ cursor: "crosshair" }}
      onPointerDown={(e) => {
        activePointers.current.add(e.pointerId);
        if (activePointers.current.size > 1) {
          finishPainting();
          return;
        }
        const at = locate(e.clientX, e.clientY);
        if (!at) return;

        // The first tap only chooses where to copy from.
        if (!state.healSource) {
          setHealSource(at.src);
          return;
        }

        const chosen = state.healOffset ?? {
          dx: state.healSource.x - at.src.x,
          dy: state.healSource.y - at.src.y,
        };
        if (!state.healOffset) setHealOffset(chosen);
        offsetRef.current = chosen;

        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        paintingPointer.current = e.pointerId;
        lastDab.current = null;
        beginInteraction();
        paintAt(at.src);
      }}
      onPointerMove={(e) => {
        const at = locate(e.clientX, e.clientY);
        setCursor(at ? at.frame : null);
        if (at && paintingPointer.current === e.pointerId) paintAt(at.src);
      }}
      onPointerUp={(e) => {
        activePointers.current.delete(e.pointerId);
        if (paintingPointer.current === e.pointerId) finishPainting();
      }}
      onPointerCancel={(e) => {
        activePointers.current.delete(e.pointerId);
        if (paintingPointer.current === e.pointerId) finishPainting();
      }}
      onPointerLeave={() => setCursor(null)}
    >
      {showRing && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{
            left: `${ringAt.x * 100}%`,
            top: `${ringAt.y * 100}%`,
            width: `${ringW}%`,
            height: `${ringH}%`,
          }}
        />
      )}
      {!state.healSource && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-elevated/90 px-md py-sm text-[13px] text-text-secondary backdrop-blur">
          Tap a clean area to copy from
        </div>
      )}
    </div>
  );
}
