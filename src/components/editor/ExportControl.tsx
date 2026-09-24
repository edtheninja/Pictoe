import { useState } from "react";
import { Download } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useEditor } from "@/state/editor/EditorContext";
import { exportImage } from "@/engine/image/render";
import type { ExportFormat, ExportQuality } from "@/types/editor";

const FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "image/jpeg", label: "JPG", ext: "jpg" },
  { value: "image/png", label: "PNG", ext: "png" },
  { value: "image/webp", label: "WebP", ext: "webp" },
];

const QUALITY_PRESETS: { key: ExportQuality; label: string; value: number }[] = [
  { key: "high", label: "High", value: 0.92 },
  { key: "medium", label: "Medium", value: 0.75 },
  { key: "small", label: "Small", value: 0.6 },
];

export function ExportControl() {
  const { state, setProcessing, setError } = useEditor();
  const [format, setFormat] = useState<ExportFormat>("image/jpeg");
  const [qualityMode, setQualityMode] = useState<ExportQuality>("high");
  const [customQuality, setCustomQuality] = useState(80); // percent, 1–100
  const [open, setOpen] = useState(false);
  const busy = state.processing === "exporting";

  const quality =
    qualityMode === "custom"
      ? customQuality / 100
      : QUALITY_PRESETS.find((p) => p.key === qualityMode)!.value;

  const handleExport = async () => {
    if (!state.source) return;
    setProcessing("exporting");
    try {
      const blob = await exportImage(
        state.source.element,
        state.source.width,
        state.source.height,
        state.edit,
        format,
        quality,
      );
      const ext = FORMATS.find((f) => f.value === format)!.ext;
      const base = state.source.name.replace(/\.[^.]+$/, "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-pictoe.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setProcessing("idle");
      setOpen(false);
    } catch {
      setProcessing("error");
      setError("Pictoe couldn't save this image. Try a different format or a smaller size.");
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={!state.source}
          className="flex items-center gap-sm rounded-md bg-accent px-lg py-1.5 text-[13px] font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-strong disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          className="z-50 w-64 rounded-lg border border-border bg-surface-elevated p-lg shadow-strong"
        >
          <p className="mb-sm text-[12px] uppercase tracking-[0.14em] text-text-muted">Format</p>
          <div className="mb-lg flex gap-xs">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                aria-pressed={format === f.value}
                className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 ${format === f.value ? "border-accent text-accent" : "border-border text-text-secondary hover:text-text-primary"}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {format !== "image/png" && (
            <>
              <p className="mb-sm text-[12px] uppercase tracking-[0.14em] text-text-muted">
                Quality
              </p>
              <div className="mb-sm flex gap-xs">
                {QUALITY_PRESETS.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setQualityMode(q.key)}
                    aria-pressed={qualityMode === q.key}
                    className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 ${qualityMode === q.key ? "border-accent text-accent" : "border-border text-text-secondary hover:text-text-primary"}`}
                  >
                    {q.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setQualityMode("custom")}
                  aria-pressed={qualityMode === "custom"}
                  className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 ${qualityMode === "custom" ? "border-accent text-accent" : "border-border text-text-secondary hover:text-text-primary"}`}
                >
                  Custom
                </button>
              </div>

              {qualityMode === "custom" && (
                <div className="mb-lg flex items-center gap-sm">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={customQuality}
                    onChange={(e) => setCustomQuality(Number(e.target.value))}
                    aria-label="Custom export quality"
                    className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
                  />
                  <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-text-muted">
                    {customQuality}%
                  </span>
                </div>
              )}
              {qualityMode !== "custom" && <div className="mb-lg" />}
            </>
          )}

          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="w-full rounded-md bg-accent py-2 text-[13px] font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Save image"}
          </button>
          <p className="mt-sm text-[11px] text-text-muted">Your original file is never modified.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
