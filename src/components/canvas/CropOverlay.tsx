import { useId, useRef } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import type { CropRect } from "@/types/editor";
import {
  clamp01,
  describeCrop,
  isArrowKey,
  moveCrop,
  nudgeCrop,
  resizeCrop,
  type CropHandle,
} from "./cropMath";

const HANDLE_POSITION: Record<Exclude<CropHandle, "move">, string> = {
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

/**
 * Interactive crop selection. With a pointer: drag inside to move, drag a handle to resize.
 * With a keyboard: focus the selection, then arrow keys move it, Alt (Option) + arrows resize it,
 * and Shift makes the steps bigger. Each gesture (a drag, or a run of key presses) is one undo step.
 */
export function CropOverlay() {
  const { state, applyEditLive, beginInteraction, endInteraction } = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const keyGestureRef = useRef(false);
  const dragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  if (state.activeTool !== "crop") return null;
  const crop = state.edit.crop;

  const getNormPoint = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  };

  const beginDrag = (handle: CropHandle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = getNormPoint(e.clientX, e.clientY);
    dragRef.current = { handle, startX: p.x, startY: p.y, startCrop: { ...crop } };
    beginInteraction();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = getNormPoint(e.clientX, e.clientY);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    applyEditLive({
      crop:
        d.handle === "move"
          ? moveCrop(d.startCrop, dx, dy)
          : resizeCrop(d.startCrop, d.handle, dx, dy),
    });
  };

  const onUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    endInteraction(); // the whole drag becomes one undo step
  };

  const endKeyGesture = () => {
    if (!keyGestureRef.current) return;
    keyGestureRef.current = false;
    endInteraction();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isArrowKey(e.key)) return;
    e.preventDefault(); // don't scroll the page, or (with Alt) go back in history
    if (!keyGestureRef.current) {
      keyGestureRef.current = true;
      beginInteraction();
    }
    applyEditLive({ crop: nudgeCrop(crop, e.key, { resize: e.altKey, big: e.shiftKey }) });
  };

  const pct = (v: number) => `${v * 100}%`;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* Darkened mask outside the selection, as four rectangles around it */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 bg-black/60"
        style={{ height: pct(crop.y) }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60"
        style={{ height: pct(1 - crop.y - crop.height) }}
      />
      <div
        className="pointer-events-none absolute left-0 bg-black/60"
        style={{ top: pct(crop.y), width: pct(crop.x), height: pct(crop.height) }}
      />
      <div
        className="pointer-events-none absolute right-0 bg-black/60"
        style={{ top: pct(crop.y), width: pct(1 - crop.x - crop.width), height: pct(crop.height) }}
      />

      {/* Crop rectangle: drag inside to move; focus it to use the arrow keys */}
      <div
        role="group"
        tabIndex={0}
        aria-label="Crop selection"
        aria-describedby={hintId}
        className="absolute cursor-move touch-none border-2 border-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.width),
          height: pct(crop.height),
        }}
        onPointerDown={beginDrag("move")}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => isArrowKey(e.key) && endKeyGesture()}
        onBlur={endKeyGesture}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/25" />
          ))}
        </div>

        {/* Resize handles are for pointers; the keyboard resizes with Alt + arrows on the selection. */}
        {(Object.keys(HANDLE_POSITION) as Exclude<CropHandle, "move">[]).map((h) => (
          <div
            key={h}
            aria-hidden="true"
            onPointerDown={beginDrag(h)}
            className={`absolute h-3.5 w-3.5 touch-none rounded-full border-2 border-white bg-accent ${HANDLE_POSITION[h]}`}
          />
        ))}
      </div>

      <p id={hintId} className="sr-only">
        Arrow keys move the crop. Hold Alt, or Option on a Mac, to resize it. Hold Shift for larger
        steps.
      </p>
      <p className="sr-only" aria-live="polite">
        {describeCrop(crop)}
      </p>
    </div>
  );
}
