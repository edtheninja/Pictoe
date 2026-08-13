import { useRef } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import type { CropRect } from "@/types/editor";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_SIZE = 0.06;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

const HANDLE_POSITION: Record<Exclude<Handle, "move">, string> = {
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

/** Interactive crop selection — drag to reposition, drag handles to resize. */
export function CropOverlay() {
  const { state, applyEdit } = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: Handle;
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

  const beginDrag = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = getNormPoint(e.clientX, e.clientY);
    dragRef.current = { handle, startX: p.x, startY: p.y, startCrop: { ...crop } };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = getNormPoint(e.clientX, e.clientY);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    const s = d.startCrop;

    if (d.handle === "move") {
      const x = Math.min(Math.max(0, s.x + dx), 1 - s.width);
      const y = Math.min(Math.max(0, s.y + dy), 1 - s.height);
      applyEdit({ crop: { x, y, width: s.width, height: s.height } });
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;

    if (d.handle.includes("w")) left = clamp01(s.x + dx);
    if (d.handle.includes("e")) right = clamp01(s.x + s.width + dx);
    if (d.handle.includes("n")) top = clamp01(s.y + dy);
    if (d.handle.includes("s")) bottom = clamp01(s.y + s.height + dy);

    if (right - left < MIN_SIZE) {
      if (d.handle.includes("w")) left = right - MIN_SIZE;
      else right = left + MIN_SIZE;
    }
    if (bottom - top < MIN_SIZE) {
      if (d.handle.includes("n")) top = bottom - MIN_SIZE;
      else bottom = top + MIN_SIZE;
    }

    applyEdit({ crop: { x: left, y: top, width: right - left, height: bottom - top } });
  };

  const onUp = () => {
    dragRef.current = null;
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

      {/* Crop rectangle — drag inside to move */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Crop selection, drag to reposition"
        className="absolute cursor-move touch-none border-2 border-white/90"
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.width),
          height: pct(crop.height),
        }}
        onPointerDown={beginDrag("move")}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/25" />
          ))}
        </div>

        {(Object.keys(HANDLE_POSITION) as Exclude<Handle, "move">[]).map((h) => (
          <div
            key={h}
            role="button"
            tabIndex={-1}
            aria-label={`Resize crop from ${h}`}
            onPointerDown={beginDrag(h)}
            className={`absolute h-3.5 w-3.5 touch-none rounded-full border-2 border-white bg-accent ${HANDLE_POSITION[h]}`}
          />
        ))}
      </div>
    </div>
  );
}
