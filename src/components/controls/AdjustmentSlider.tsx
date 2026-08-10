import * as Slider from "@radix-ui/react-slider";
import { RotateCcw } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { DEFAULT_ADJUSTMENTS, type AdjustmentDef } from "@/types/editor";

export function AdjustmentSlider({ def }: { def: AdjustmentDef }) {
  const { state, setAdjustment, beginInteraction, endInteraction, resetAdjustment } = useEditor();
  const value = state.edit.adjustments[def.key];
  const defaultValue = DEFAULT_ADJUSTMENTS[def.key];
  const changed = value !== defaultValue;

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-md gap-y-xs py-xs sm:grid-cols-[7rem_minmax(0,1fr)_3.5rem]">
      <label
        htmlFor={`adj-${def.key}`}
        className="min-w-0 truncate text-[13px] text-text-secondary"
        onDoubleClick={() => resetAdjustment(def.key)}
      >
        {def.label}
      </label>

      <Slider.Root
        id={`adj-${def.key}`}
        className="relative col-span-2 flex h-5 w-full touch-none select-none items-center sm:col-span-1"
        min={def.min}
        max={def.max}
        step={def.step}
        value={[value]}
        aria-label={def.label}
        aria-valuetext={`${value}`}
        onPointerDown={beginInteraction}
        onPointerUp={endInteraction}
        onKeyDown={beginInteraction}
        onKeyUp={endInteraction}
        onValueChange={([v]) => setAdjustment(def.key, v ?? defaultValue)}
        onDoubleClick={() => resetAdjustment(def.key)}
      >
        <Slider.Track className="relative h-[3px] w-full grow rounded-full bg-border-strong">
          <Slider.Range className="absolute h-full rounded-full bg-accent/70" />
        </Slider.Track>
        <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border border-accent bg-surface-elevated shadow-subtle transition-transform duration-150 hover:scale-110 focus-visible:scale-110" />
      </Slider.Root>

      <div className="flex items-center justify-end gap-xs">
        <span className="w-8 text-right text-[12px] tabular-nums text-text-muted">{value}</span>
        <button
          type="button"
          aria-label={`Reset ${def.label}`}
          onClick={() => resetAdjustment(def.key)}
          className={`grid h-5 w-5 place-items-center rounded-sm text-text-muted transition-opacity duration-150 hover:text-text-primary ${
            changed ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
