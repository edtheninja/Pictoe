import { useState } from "react";
import {
  Brush,
  ChevronDown,
  ChevronUp,
  Circle,
  Contrast,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Pencil,
  Spline,
  Trash2,
} from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { defaultShape } from "@/engine/image/maskShapes";
import { frameOf } from "@/engine/image/maskSpace";
import { LOCAL_ADJUSTMENT_DEFS } from "@/types/editor";
import { MaskThumbnail } from "./MaskThumbnail";

const ICON_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30";

export function MaskPanel() {
  const {
    state,
    addMaskLayer,
    duplicateMaskLayer,
    renameMaskLayer,
    setMaskLayerInverted,
    setMaskLayerVisible,
    moveMaskLayer,
    setMaskShape,
    deleteMaskLayer,
    setActiveMaskLayer,
    setMaskMode,
    setMaskLayerAdjustment,
    recordMaskHistory,
    setMaskBrushSize,
    setMaskBrushSoftness,
  } = useEditor();

  const layers = state.maskLayers;
  const activeId = state.activeMaskLayerId;
  const maskMode = state.maskMode;
  const activeLayer = layers.find((l) => l.id === activeId);
  const activeShape = activeLayer?.shape;
  const frame = state.source ? frameOf(state.source.width, state.source.height, state.edit) : null;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const basicDefs = LOCAL_ADJUSTMENT_DEFS.filter((d) => d.level === "basic");
  const advancedDefs = LOCAL_ADJUSTMENT_DEFS.filter((d) => d.level === "advanced");

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-sm">
        <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Add area</p>

        <div className="grid grid-cols-3 gap-sm">
          {[
            { label: "Brush", icon: Brush, add: () => addMaskLayer() },
            { label: "Linear", icon: Spline, add: () => addMaskLayer(defaultShape("linear")) },
            { label: "Radial", icon: Circle, add: () => addMaskLayer(defaultShape("radial")) },
          ].map(({ label, icon: Icon, add }) => (
            <button
              key={label}
              type="button"
              onClick={add}
              className="flex items-center justify-center gap-xs rounded-md border border-border px-sm py-1.5 text-[12px] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {!activeShape && (
        <div className="flex flex-col gap-sm rounded-md border border-border p-sm">
          <label className="flex items-center gap-sm text-[12px]">
            <span className="w-20 shrink-0 text-text-secondary">Brush size</span>

            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={state.maskBrushSize}
              onChange={(e) => setMaskBrushSize(Number(e.target.value))}
              className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
            />

            <span className="w-8 text-right tabular-nums text-text-muted">
              {state.maskBrushSize}
            </span>
          </label>

          <label className="flex items-center gap-sm text-[12px]">
            <span className="w-20 shrink-0 text-text-secondary">Softness</span>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={state.maskBrushSoftness}
              onChange={(e) => setMaskBrushSoftness(Number(e.target.value))}
              className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
            />

            <span className="w-8 text-right tabular-nums text-text-muted">
              {state.maskBrushSoftness}
            </span>
          </label>
        </div>
      )}

      {activeId && !activeShape && (
        <div className="flex rounded-md border border-border bg-surface-elevated/40 p-1">
          <button
            type="button"
            onClick={() => setMaskMode("paint")}
            aria-pressed={maskMode === "paint"}
            className={`flex min-w-0 flex-1 items-center justify-center gap-xs rounded px-sm py-1.5 text-[12px] transition-colors duration-150 ${
              maskMode === "paint"
                ? "bg-surface text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <Brush className="h-3.5 w-3.5" />
            Paint
          </button>

          <button
            type="button"
            onClick={() => setMaskMode("erase")}
            aria-pressed={maskMode === "erase"}
            className={`flex min-w-0 flex-1 items-center justify-center gap-xs rounded px-sm py-1.5 text-[12px] transition-colors duration-150 ${
              maskMode === "erase"
                ? "bg-surface text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <Eraser className="h-3.5 w-3.5" />
            Eraser
          </button>
        </div>
      )}

      {activeId && !activeShape && (
        <p className="text-[11px] leading-relaxed text-text-muted">
          {maskMode === "paint"
            ? "Paint to add this area's effect."
            : "Erase painted regions to remove this area's effect."}
        </p>
      )}

      {activeLayer && activeShape && (
        <div className="flex flex-col gap-sm">
          <p className="text-[11px] leading-relaxed text-text-muted">
            {activeShape.kind === "linear"
              ? "Drag the two handles on the photo. The effect is full at the solid line and fades to none at the dashed one."
              : "Drag the handles on the photo to move, resize and rotate. Arrow keys nudge a focused handle."}
          </p>

          {activeShape.kind === "radial" && (
            <label className="flex items-center gap-sm text-[12px]">
              <span className="w-20 shrink-0 text-text-secondary">Feather</span>

              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(activeShape.feather)}
                onPointerDown={() => recordMaskHistory()}
                onChange={(e) =>
                  setMaskShape(activeLayer.id, { ...activeShape, feather: Number(e.target.value) })
                }
                className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
              />

              <span className="w-8 text-right tabular-nums text-text-muted">
                {Math.round(activeShape.feather)}
              </span>
            </label>
          )}
        </div>
      )}

      {layers.length === 0 && (
        <p className="text-[12px] text-text-muted">
          Add a brush, linear or radial area to choose where your edits apply.
        </p>
      )}

      <ul className="flex flex-col gap-sm" aria-label="Areas">
        {layers.map((layer, index) => {
          const active = layer.id === activeId;
          const hidden = layer.visible === false;
          const renaming = renamingId === layer.id;
          const empty = !layer.shape && layer.strokes.length === 0;

          return (
            <li
              key={layer.id}
              className={`rounded-md border px-sm py-sm transition-colors duration-150 ${
                active ? "border-accent bg-accent/5" : "border-border"
              }`}
            >
              <div className="flex items-center gap-sm">
                {frame && <MaskThumbnail layer={layer} frame={frame} />}

                {renaming ? (
                  <input
                    autoFocus
                    aria-label={`Rename ${layer.name}`}
                    defaultValue={layer.name}
                    maxLength={60}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        renameMaskLayer(layer.id, e.currentTarget.value);
                        setRenamingId(null);
                      } else if (e.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                    onBlur={(e) => {
                      renameMaskLayer(layer.id, e.currentTarget.value);
                      setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-accent bg-surface px-xs py-0.5 text-[13px] text-text-primary outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveMaskLayer(active ? null : layer.id)}
                    className={`min-w-0 flex-1 truncate rounded text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      hidden ? "text-text-muted" : "text-text-primary"
                    }`}
                  >
                    {layer.name}

                    {layer.invert && (
                      <span className="ml-xs text-[11px] text-text-muted">(inverted)</span>
                    )}

                    {empty && (
                      <span className="ml-xs text-[11px] text-text-muted">(not painted yet)</span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setMaskLayerVisible(layer.id, hidden)}
                  aria-label={hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
                  aria-pressed={!hidden}
                  className={ICON_BUTTON}
                >
                  {hidden ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => deleteMaskLayer(layer.id)}
                  aria-label={`Delete ${layer.name}`}
                  className={`${ICON_BUTTON} hover:!text-danger`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {active && (
                <div
                  className="mt-sm flex items-center gap-xs"
                  role="group"
                  aria-label={`${layer.name} actions`}
                >
                  <button
                    type="button"
                    onClick={() => setMaskLayerInverted(layer.id, layer.invert !== true)}
                    aria-pressed={layer.invert === true}
                    aria-label="Invert area"
                    title="Invert area"
                    className={`${ICON_BUTTON} ${layer.invert ? "bg-accent/15 !text-accent" : ""}`}
                  >
                    <Contrast className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={() => duplicateMaskLayer(layer.id)}
                    aria-label="Duplicate area"
                    title="Duplicate area"
                    className={ICON_BUTTON}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setRenamingId(layer.id)}
                    aria-label="Rename area"
                    title="Rename area"
                    className={ICON_BUTTON}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>

                  <span className="flex-1" />

                  <button
                    type="button"
                    onClick={() => moveMaskLayer(layer.id, index - 1)}
                    disabled={index === 0}
                    aria-label="Move area up"
                    title="Move up (earlier areas are applied first)"
                    className={ICON_BUTTON}
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={() => moveMaskLayer(layer.id, index + 1)}
                    disabled={index === layers.length - 1}
                    aria-label="Move area down"
                    title="Move down (later areas are applied on top)"
                    className={ICON_BUTTON}
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              {active && (
                <div className="mt-sm flex flex-col gap-sm">
                  {[...basicDefs, ...(showAdvanced ? advancedDefs : [])].map((def) => (
                    <label key={def.key} className="flex items-center gap-sm text-[12px]">
                      <span className="w-20 shrink-0 text-text-secondary">{def.label}</span>

                      <input
                        type="range"
                        min={def.min}
                        max={def.max}
                        step={1}
                        value={layer.adjustments[def.key]}
                        onPointerDown={() => recordMaskHistory()}
                        onChange={(e) =>
                          setMaskLayerAdjustment(layer.id, def.key, Number(e.target.value))
                        }
                        className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
                      />

                      <span className="w-8 shrink-0 text-right tabular-nums text-text-muted">
                        {layer.adjustments[def.key]}
                      </span>
                    </label>
                  ))}

                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    aria-expanded={showAdvanced}
                    className="self-start rounded text-[12px] text-text-muted transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {showAdvanced ? "Fewer controls" : `More controls (${advancedDefs.length})`}
                    {!showAdvanced && advancedDefs.some((d) => layer.adjustments[d.key] !== 0) && (
                      <span className="ml-xs text-accent" aria-label="(some are adjusted)">
                        •
                      </span>
                    )}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
