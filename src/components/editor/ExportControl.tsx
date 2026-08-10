import { useState } from "react";
import { Download } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useEditor } from "@/state/editor/EditorContext";
import { exportImage } from "@/engine/image/render";
import type { ExportFormat } from "@/types/editor";

const FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "image/jpeg", label: "JPG", ext: "jpg" },
  { value: "image/png", label: "PNG", ext: "png" },
  { value: "image/webp", label: "WebP", ext: "webp" },
];

export function ExportControl() {
  const { state, setProcessing, setError } = useEditor();
  const [format, setFormat] = useState<ExportFormat>("image/jpeg");
  const [quality, setQuality] = useState(0.92);
  const [open, setOpen] = useState(false);
  const busy = state.processing === "exporting";

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
                className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 ${
                  format === f.value
                    ? "border-accent text-accent"
                    : "border-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {format !== "image/png" && (
            <>
              <p className="mb-sm text-[12px] uppercase tracking-[0.14em] text-text-muted">Quality</p>
              <div className="mb-lg flex gap-xs">
                {[
                  { label: "High", value: 0.92 },
                  { label: "Medium", value: 0.75 },
                  { label: "Small", value: 0.6 },
                ].map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setQuality(q.value)}
                    aria-pressed={quality === q.value}
                    className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 ${
                      quality === q.value
                        ? "border-accent text-accent"
                        : "border-border text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
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
