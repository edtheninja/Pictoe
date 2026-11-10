import { useState } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import { AdjustmentSlider } from "@/components/controls/AdjustmentSlider";
import {
  ADJUSTMENT_DEFS,
  GRADE_CHANNELS,
  GRADE_RANGES,
  gradeKey,
  type GradeChannel,
  type GradeRange,
} from "@/types/editor";

const CAPTION: Record<GradeChannel, string> = {
  hue: "Hue",
  sat: "Saturation",
  lum: "Luminance",
};

const defOf = (key: string) => ADJUSTMENT_DEFS.find((d) => d.key === key)!;

/**
 * Colour grading: pick a tonal range (shadows, mid-tones or highlights), then choose the colour it
 * is tinted with and how much, and lift or lower its luminance. One balance slider moves the split
 * between the shadows and the highlights.
 */
export function ColorGrading() {
  const { state } = useEditor();
  const [range, setRange] = useState<GradeRange>("Shadows");
  const a = state.edit.adjustments;

  const touched = (r: GradeRange) => a[gradeKey(r, "sat")] !== 0 || a[gradeKey(r, "lum")] !== 0;
  const swatch = (r: GradeRange) => {
    const sat = a[gradeKey(r, "sat")];
    return sat > 0 ? `hsl(${a[gradeKey(r, "hue")]} ${Math.max(35, sat)}% 50%)` : undefined;
  };

  return (
    <div role="group" aria-label="Colour grading" className="mt-md min-w-0">
      <h3 className="mb-xs text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
        Colour grading
      </h3>
      <div role="group" aria-label="Tonal range" className="mb-sm grid grid-cols-3 gap-xs">
        {GRADE_RANGES.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={range === name}
            aria-label={touched(name) ? `${name} (adjusted)` : name}
            onClick={() => setRange(name)}
            className={`flex items-center justify-center gap-xs rounded-md border px-xs py-1 text-[12px] transition-colors duration-150 ${
              range === name
                ? "border-accent bg-surface-elevated text-text-primary"
                : "border-border text-text-muted hover:border-border-strong hover:text-text-secondary"
            }`}
          >
            <span
              aria-hidden="true"
              className="block h-3 w-3 shrink-0 rounded-full border border-border-strong bg-surface-elevated"
              style={{ backgroundColor: swatch(name) }}
            />
            <span aria-hidden="true">{name}</span>
          </button>
        ))}
      </div>
      <div role="group" aria-label={`${range} grading`}>
        {GRADE_CHANNELS.map((channel) => (
          <AdjustmentSlider
            key={channel}
            def={defOf(gradeKey(range, channel))}
            caption={CAPTION[channel]}
          />
        ))}
      </div>
      <AdjustmentSlider def={defOf("gradeBalance")} caption="Balance" />
    </div>
  );
}
