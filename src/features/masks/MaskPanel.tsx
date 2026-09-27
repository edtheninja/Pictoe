import { Plus, Trash2 } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import type { LocalAdjustments } from "@/types/editor";

const PARAMS: { key: keyof LocalAdjustments; label: string }[] = [
    { key: "exposure", label: "Exposure" },
    { key: "contrast", label: "Contrast" },
    { key: "saturation", label: "Saturation" },
    { key: "temperature", label: "Temperature" },
];

export function MaskPanel() {
    const { state, addMaskLayer, deleteMaskLayer, setActiveMaskLayer, setMaskLayerAdjustment } =
        useEditor();
    const layers = state.maskLayers;
    const activeId = state.activeMaskLayerId;

    return (
        <div className="flex flex-col gap-md">
            <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Areas</p>
                <button
                    type="button"
                    onClick={addMaskLayer}
                    className="flex items-center gap-xs rounded-md border border-border px-sm py-1 text-[12px] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-accent"
                >
                    <Plus className="h-3 w-3" />
                    Add area
                </button>
            </div>

            {layers.length === 0 && (
                <p className="text-[12px] text-text-muted">
                    Add an area, then paint on the image to mark where it applies.
                </p>
            )}

            <div className="flex flex-col gap-sm">
                {layers.map((layer) => {
                    const active = layer.id === activeId;
                    return (
                        <div
                            key={layer.id}
                            className={`rounded-md border px-sm py-sm transition-colors duration-150 ${active ? "border-accent bg-accent/5" : "border-border"
                                }`}
                        >
                            <div className="flex items-center justify-between gap-sm">
                                <button
                                    type="button"
                                    onClick={() => setActiveMaskLayer(active ? null : layer.id)}
                                    className="min-w-0 flex-1 truncate text-left text-[13px] text-text-primary"
                                >
                                    {layer.name}
                                    {layer.strokes.length === 0 && (
                                        <span className="ml-xs text-[11px] text-text-muted">(not painted yet)</span>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => deleteMaskLayer(layer.id)}
                                    aria-label={`Delete ${layer.name}`}
                                    className="text-text-muted transition-colors duration-150 hover:text-danger"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            {active && (
                                <div className="mt-sm flex flex-col gap-sm">
                                    {PARAMS.map((p) => (
                                        <label key={p.key} className="flex items-center gap-sm text-[12px]">
                                            <span className="w-20 shrink-0 text-text-secondary">{p.label}</span>
                                            <input
                                                type="range"
                                                min={-100}
                                                max={100}
                                                step={1}
                                                value={layer.adjustments[p.key]}
                                                onChange={(e) =>
                                                    setMaskLayerAdjustment(layer.id, p.key, Number(e.target.value))
                                                }
                                                className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
                                            />
                                            <span className="w-8 shrink-0 text-right tabular-nums text-text-muted">
                                                {layer.adjustments[p.key]}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
