import { useState } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import { AdjustmentSlider } from "@/components/controls/AdjustmentSlider";
import {
  ADJUSTMENT_DEFS,
  BAND_CHANNELS,
  BAND_NAMES,
  bandKey,
  type BandChannel,
  type BandName,
} from "@/types/editor";

/** Swatch colours for the band picker: roughly the middle of each band's hue range. */
const SWATCH: Record<BandName, string> = {
  Red: "#ef4444",
  Orange: "#f97316",
  Yellow: "#eab308",
  Green: "#22c55e",
  Blue: "#3b82f6",
  Purple: "#a855f7",
};

const CAPTION: Record<BandChannel, string> = {
  hue: "Hue",
  sat: "Saturation",
  lum: "Luminance",
};

/**
 * Colour mixer: pick a colour band, then adjust its hue, saturation and luminance. Six pickers and
 * three sliders instead of eighteen sliders, so the panel stays calm until you need the detail.
 */
export function ColorMixer() {
  const { state } = useEditor();
  const [band, setBand] = useState<BandName>("Red");
  const adjustments = state.edit.adjustments;

  const touched = (name: BandName) =>
    BAND_CHANNELS.some((ch) => adjustments[bandKey(ch, name)] !== 0);

  return (
    <div role="group" aria-label="Colour mixer" className="mt-sm min-w-0">
      <div
        role="group"
        aria-label="Colour band"
        className="mb-sm flex flex-wrap items-center gap-xs"
      >
        {BAND_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={band === name}
            aria-label={touched(name) ? `${name} (adjusted)` : name}
            title={name}
            onClick={() => setBand(name)}
            className={`relative grid h-7 w-7 place-items-center rounded-full border transition-colors duration-150 ${
              band === name ? "border-accent" : "border-border hover:border-border-strong"
            }`}
          >
            <span
              aria-hidden="true"
              className="block h-4 w-4 rounded-full"
              style={{ backgroundColor: SWATCH[name] }}
            />
            {touched(name) && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-surface bg-text-primary"
              />
            )}
          </button>
        ))}
      </div>
      <div role="group" aria-label={`${band} band`}>
        {BAND_CHANNELS.map((channel) => {
          const key = bandKey(channel, band);
          const def = ADJUSTMENT_DEFS.find((d) => d.key === key)!;
          return <AdjustmentSlider key={key} def={def} caption={CAPTION[channel]} />;
        })}
      </div>
    </div>
  );
}
