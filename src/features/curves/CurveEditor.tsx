import { useEffect, useId, useRef, useState } from "react";
import { curveKeyAction, evalCurve, insertPoint, movePoint } from "@/engine/image/curves";
import type { CurvePoint } from "@/types/editor";

/**
 * A tone-curve graph you can drag, click and drive from the keyboard.
 *
 * - Click an empty spot to add a point (and drag it); drag a point to move it.
 * - With a point focused: arrow keys move it (hold Shift for bigger steps), Delete removes it.
 * - The end points only move up and down; the rules for moving, adding and removing points live
 *   in engine/image/curves.ts.
 *
 * A drag or a held arrow key is reported as begin -> live updates -> end, so the owner can record
 * the whole gesture as one undo step. Adding and removing a point is reported as a single change.
 */

type Props = {
  /** Names the graph for screen readers, e.g. "RGB curve". */
  label: string;
  points: CurvePoint[];
  onBegin: () => void;
  onLive: (points: CurvePoint[]) => void;
  onEnd: () => void;
  /** A one-step change: adding or removing a point. */
  onChange: (points: CurvePoint[]) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
};

const CURVE_SAMPLES = 64;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function CurveEditor({
  label,
  points,
  onBegin,
  onLive,
  onEnd,
  onChange,
  selected,
  onSelect,
}: Props) {
  const hintId = useId();
  const area = useRef<HTMLDivElement>(null);
  const pointRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragIndex = useRef<number | null>(null);
  const keyGesture = useRef(false);
  const [focusRequest, setFocusRequest] = useState<number | null>(null);

  // After the list changes shape (a point was added or removed), move focus to the point asked for.
  useEffect(() => {
    if (focusRequest === null) return;
    pointRefs.current[focusRequest]?.focus();
    setFocusRequest(null);
  }, [focusRequest, points]);

  const toCurveSpace = (e: { clientX: number; clientY: number }) => {
    const rect = area.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: 1 - (e.clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-point-index]");
    const { x, y } = toCurveSpace(e);

    if (hit) {
      dragIndex.current = Number(hit.dataset["pointIndex"]);
      onSelect(dragIndex.current);
      onBegin();
    } else {
      const inserted = insertPoint(points, x, y);
      if (!inserted) return;
      dragIndex.current = inserted.index;
      onSelect(inserted.index);
      onBegin();
      onLive(inserted.points);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragIndex.current === null) return;
    const { x, y } = toCurveSpace(e);
    onLive(movePoint(points, dragIndex.current, x, y));
  };

  const endDrag = () => {
    if (dragIndex.current === null) return;
    dragIndex.current = null;
    onEnd();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    const action = curveKeyAction(points, index, e.key, e.shiftKey);
    if (!action) {
      // Delete on an end point is swallowed too, so it doesn't navigate the page.
      if (e.key === "Delete" || e.key === "Backspace") e.preventDefault();
      return;
    }
    e.preventDefault();

    if (action.kind === "remove") {
      onChange(action.points);
      onSelect(action.focusIndex);
      setFocusRequest(action.focusIndex);
      return;
    }
    if (!keyGesture.current) {
      keyGesture.current = true;
      onBegin();
    }
    onLive(action.points);
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!keyGesture.current) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    keyGesture.current = false;
    onEnd();
  };

  const path = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
    const x = i / CURVE_SAMPLES;
    return `${i === 0 ? "M" : "L"}${(x * 100).toFixed(2)} ${((1 - evalCurve(points, x)) * 100).toFixed(2)}`;
  }).join(" ");

  return (
    <div className="flex flex-col gap-sm">
      <div
        ref={area}
        role="group"
        aria-label={`${label} editor`}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative mx-auto aspect-square w-full max-w-[280px] cursor-crosshair touch-none select-none rounded-md border border-border bg-surface"
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
          className="absolute inset-0 h-full w-full"
        >
          {[25, 50, 75].map((n) => (
            <g key={n} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke">
              <line x1={n} y1={0} x2={n} y2={100} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={n} x2={100} y2={n} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          <line
            x1={0}
            y1={100}
            x2={100}
            y2={0}
            className="stroke-border-strong"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={path}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {points.map((p, i) => {
          const isSelected = selected === i;
          return (
            <div
              key={i}
              ref={(el) => {
                pointRefs.current[i] = el;
              }}
              data-point-index={i}
              role="slider"
              tabIndex={0}
              aria-label={`${label} point ${i + 1} of ${points.length}`}
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p.y * 100)}
              aria-valuetext={`Input ${Math.round(p.x * 100)}%, output ${Math.round(p.y * 100)}%`}
              onFocus={() => onSelect(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onKeyUp={onKeyUp}
              style={{ left: pct(p.x), top: pct(1 - p.y) }}
              className={`absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing`}
            >
              <span
                className={`block h-3 w-3 rounded-full border-2 border-accent ${
                  isSelected ? "bg-accent" : "bg-surface-elevated"
                }`}
              />
            </div>
          );
        })}
      </div>
      <p id={hintId} className="text-[12px] text-text-muted">
        Click the graph to add a point, then drag it. With a point focused, arrow keys move it
        (Shift for bigger steps) and Delete removes it.
      </p>
    </div>
  );
}
