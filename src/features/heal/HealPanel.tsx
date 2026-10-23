import { WifiOff } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";

export function HealPanel() {
  const { state, applyEdit, setHealSource, setHealBrushSize, setHealBrushSoftness } = useEditor();
  const strokes = state.edit.healStrokes.length;
  const hasSource = state.healSource !== null;

  return (
    <div className="flex flex-col gap-md">
      <p className="text-[13px] text-text-secondary">
        {hasSource
          ? "Now paint over the spot you want to remove. Pictoe copies from the area you chose."
          : "Tap a clean area of the photo to copy from, then paint over the spot to cover it."}
      </p>

      <div className="flex flex-col gap-sm rounded-md border border-border p-sm">
        <label className="flex items-center gap-sm text-[12px]">
          <span className="w-20 shrink-0 text-text-secondary">Brush size</span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={state.healBrushSize}
            onChange={(e) => setHealBrushSize(Number(e.target.value))}
            className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
          />
          <span className="w-8 text-right tabular-nums text-text-muted">{state.healBrushSize}</span>
        </label>
        <label className="flex items-center gap-sm text-[12px]">
          <span className="w-20 shrink-0 text-text-secondary">Softness</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={state.healBrushSoftness}
            onChange={(e) => setHealBrushSoftness(Number(e.target.value))}
            className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
          />
          <span className="w-8 text-right tabular-nums text-text-muted">
            {state.healBrushSoftness}
          </span>
        </label>
      </div>

      <div className="flex items-center gap-md text-[12px]">
        <button
          type="button"
          onClick={() => setHealSource(null)}
          disabled={!hasSource}
          className="text-accent transition-colors duration-150 hover:text-accent-strong disabled:cursor-not-allowed disabled:text-text-muted"
        >
          Choose a new source
        </button>
        <button
          type="button"
          onClick={() => applyEdit({ healStrokes: [] })}
          disabled={strokes === 0}
          className="text-text-muted transition-colors duration-150 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear clone edits
        </button>
      </div>

      <div className="flex items-start gap-sm text-[12px] text-text-muted">
        <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          This copies pixels from one place to another. Content-aware healing and object removal
          need Pictoe's cloud engine and aren't available yet. Your current edits remain safe.
        </p>
      </div>
    </div>
  );
}
