import { useState } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import {
  MAX_CURVE_POINTS,
  insertPoint,
  isIdentityCurve,
  removePoint,
  suggestInsertion,
} from "@/engine/image/curves";
import { identityCurve, type CurveChannel, type CurvePoint } from "@/types/editor";
import { CurveEditor } from "./CurveEditor";

const CHANNELS: { id: CurveChannel; label: string; hint: string }[] = [
  { id: "rgb", label: "RGB", hint: "Shapes brightness and contrast, and shifts colour with it." },
  { id: "luma", label: "Luminance", hint: "Shapes brightness only and leaves colour alone." },
];

export function CurvesPanel() {
  const { state, applyEdit, applyEditLive, beginInteraction, endInteraction } = useEditor();
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const [selected, setSelected] = useState<number | null>(null);
  const curves = state.edit.curves;
  const points = curves[channel];
  const current = CHANNELS.find((c) => c.id === channel)!;

  const withPoints = (next: CurvePoint[]) => ({ curves: { ...curves, [channel]: next } });
  const canRemove = selected !== null && selected > 0 && selected < points.length - 1;
  const canAdd = points.length < MAX_CURVE_POINTS;
  const isStraight = isIdentityCurve(points);

  const switchChannel = (next: CurveChannel) => {
    setChannel(next);
    setSelected(null);
  };

  const addPoint = () => {
    const spot = suggestInsertion(points);
    if (!spot) return;
    const inserted = insertPoint(points, spot.x, spot.y);
    if (!inserted) return;
    applyEdit(withPoints(inserted.points));
    setSelected(inserted.index);
  };

  return (
    <div className="flex flex-col gap-md">
      <div role="group" aria-label="Curve channel" className="grid grid-cols-2 gap-xs">
        {CHANNELS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={channel === id}
            onClick={() => switchChannel(id)}
            className={`rounded-md px-md py-1.5 text-[13px] transition-colors duration-150 ${
              channel === id
                ? "bg-surface-elevated text-text-primary"
                : "text-text-muted hover:bg-surface-elevated/60 hover:text-text-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-text-secondary">{current.hint}</p>

      <CurveEditor
        label={`${current.label} curve`}
        points={points}
        selected={selected}
        onSelect={setSelected}
        onBegin={beginInteraction}
        onLive={(next) => applyEditLive(withPoints(next))}
        onEnd={endInteraction}
        onChange={(next) => applyEdit(withPoints(next))}
      />

      <div className="flex flex-wrap items-center gap-md text-[12px]">
        <button
          type="button"
          onClick={addPoint}
          disabled={!canAdd}
          className="text-accent transition-colors duration-150 hover:text-accent-strong disabled:cursor-not-allowed disabled:text-text-muted"
        >
          Add point
        </button>
        <button
          type="button"
          onClick={() => {
            if (!canRemove) return;
            applyEdit(withPoints(removePoint(points, selected)));
            setSelected(selected - 1);
          }}
          disabled={!canRemove}
          className="text-accent transition-colors duration-150 hover:text-accent-strong disabled:cursor-not-allowed disabled:text-text-muted"
        >
          Remove point
        </button>
        <button
          type="button"
          onClick={() => {
            applyEdit(withPoints(identityCurve()));
            setSelected(null);
          }}
          disabled={isStraight}
          className="text-text-muted transition-colors duration-150 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-muted"
        >
          Reset curve
        </button>
      </div>
    </div>
  );
}
