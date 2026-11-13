import { useRef } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import {
  dragHandle,
  handlesOf,
  linearGuides,
  nudgeHandle,
  radialOutline,
  type HandleId,
} from "@/engine/image/maskHandles";
import { frameOf } from "@/engine/image/maskSpace";
import type { MaskLayer, MaskShape } from "@/types/editor";

const LABELS: Record<HandleId, string> = {
  start: "Gradient start (full effect)",
  end: "Gradient end (no effect)",
  centre: "Move area",
  radiusX: "Resize and rotate area",
  radiusY: "Resize area height",
  feather: "Feather",
};

const NUDGE = 0.005; // of the frame
const NUDGE_BIG = 0.03;
const HIT_PX = 28; // touch target; the visible dot is smaller

/**
 * Handles and guides for the active gradient layer. Sits in the same zoom/pan wrapper as the
 * canvas, so pointer positions map through this element's own bounding rect. Every handle is a
 * focusable button: pointer drags and arrow keys both go through the same maskHandles maths,
 * and one drag or one key press (not a held key) is one undo step.
 */
export function MaskShapeOverlay({ layer, shape }: { layer: MaskLayer; shape: MaskShape }) {
  const { state, setMaskShape, recordMaskHistory } = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ id: HandleId; pointerId: number } | null>(null);

  const source = state.source;
  if (!source) return null;
  const frame = frameOf(source.width, source.height, state.edit);
  const handles = handlesOf(shape, frame);
  // Handles are inside the zoomed wrapper; shrink them back so they keep their size.
  const counter = 1 / Math.max(state.viewport.zoom, 0.01);

  const pointerTo = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const pct = (v: number) => `${(v * 100).toFixed(3)}`;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {shape.kind === "radial" ? (
          <polygon
            points={radialOutline(shape, frame)
              .map((p) => `${pct(p.x)},${pct(p.y)}`)
              .join(" ")}
            fill="none"
            stroke="white"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.8))" }}
          />
        ) : (
          <>
            {linearGuides(shape, frame).map((s, i) => (
              <line
                key={i}
                x1={pct(s.a.x)}
                y1={pct(s.a.y)}
                x2={pct(s.b.x)}
                y2={pct(s.b.y)}
                stroke="white"
                strokeWidth={1.5}
                strokeDasharray={i === 0 ? undefined : "6 4"}
                vectorEffect="non-scaling-stroke"
                style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.8))" }}
              />
            ))}
            {handles.length === 2 && (
              <line
                x1={pct(handles[0]!.x)}
                y1={pct(handles[0]!.y)}
                x2={pct(handles[1]!.x)}
                y2={pct(handles[1]!.y)}
                stroke="white"
                strokeOpacity={0.6}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </>
        )}
      </svg>

      {handles.map((h) => (
        <button
          key={h.id}
          type="button"
          aria-label={LABELS[h.id]}
          data-handle={h.id}
          className="group pointer-events-auto absolute flex touch-none items-center justify-center rounded-full outline-none"
          style={{
            left: `${h.x * 100}%`,
            top: `${h.y * 100}%`,
            width: HIT_PX,
            height: HIT_PX,
            transform: `translate(-50%, -50%) scale(${counter})`,
            cursor: "grab",
          }}
          onPointerDown={(e) => {
            // A second finger is a pinch: let it bubble to the canvas and do not start a drag.
            if (draggingRef.current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            draggingRef.current = { id: h.id, pointerId: e.pointerId };
            recordMaskHistory();
          }}
          onPointerMove={(e) => {
            const drag = draggingRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;
            const to = pointerTo(e.clientX, e.clientY);
            if (!to) return;
            setMaskShape(layer.id, dragHandle(shape, drag.id, to, frame));
          }}
          onPointerUp={(e) => {
            if (draggingRef.current?.pointerId === e.pointerId) draggingRef.current = null;
          }}
          onPointerCancel={(e) => {
            if (draggingRef.current?.pointerId === e.pointerId) draggingRef.current = null;
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? NUDGE_BIG : NUDGE;
            const d =
              e.key === "ArrowLeft"
                ? [-step, 0]
                : e.key === "ArrowRight"
                  ? [step, 0]
                  : e.key === "ArrowUp"
                    ? [0, -step]
                    : e.key === "ArrowDown"
                      ? [0, step]
                      : null;
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) recordMaskHistory();
            setMaskShape(layer.id, nudgeHandle(shape, h.id, d[0]!, d[1]!, frame));
          }}
        >
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-white bg-accent shadow-md group-focus-visible:ring-2 group-focus-visible:ring-white" />
        </button>
      ))}
    </div>
  );
}
