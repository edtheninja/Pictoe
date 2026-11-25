import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useEditor } from "@/state/editor/EditorContext";
import { exportImageSafely, outputSize } from "@/engine/image/render";
import { describeScaledExport } from "@/engine/image/exportFallback";
import { canEncode, resolveExportOutcome } from "@/engine/image/exportFormat";
import {
  ORIGINAL_SIZE,
  describeSizeNote,
  parseWholeNumber,
  resolveExportSize,
  type SizeSetting,
} from "@/engine/image/exportSize";
import { describeSize } from "@/engine/image/limits";
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

type SizeChoice = "original" | "75" | "50" | "25" | "custom";

const SIZE_CHOICES: { key: SizeChoice; label: string }[] = [
  { key: "original", label: "Original" },
  { key: "75", label: "75%" },
  { key: "50", label: "50%" },
  { key: "25", label: "25%" },
  { key: "custom", label: "Custom" },
];

export function ExportControl() {
  const { state, setProcessing, setError } = useEditor();
  const [format, setFormat] = useState<ExportFormat>("image/jpeg");
  const [qualityMode, setQualityMode] = useState<ExportQuality>("high");
  const [customQuality, setCustomQuality] = useState(80); // percent, 1–100
  const [sizeChoice, setSizeChoice] = useState<SizeChoice>("original");
  // The custom size is two views of one number: the longest side in pixels, or a percent of the
  // original. They are text so that a half-typed value ("2") is allowed; the one edited last wins.
  const [customPixels, setCustomPixels] = useState("");
  const [customPercent, setCustomPercent] = useState("");
  const [customLead, setCustomLead] = useState<"pixels" | "percent">("pixels");
  const [open, setOpen] = useState(false);
  // Which formats this browser can really save (Safari can't encode WebP). Unknown until probed.
  const [encodable, setEncodable] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const busy = state.processing === "exporting";

  const quality =
    qualityMode === "custom"
      ? customQuality / 100
      : QUALITY_PRESETS.find((p) => p.key === qualityMode)!.value;

  // The size of the photo as it would be saved at full size (after crop and rotation).
  const full = useMemo(
    () => (state.source ? outputSize(state.source.width, state.source.height, state.edit) : null),
    [state.source, state.edit],
  );
  const longest = full ? Math.max(full.width, full.height) : 0;

  /** The size the user has asked for, or null while a custom value is not a usable number. */
  const sizeSetting: SizeSetting | null = useMemo(() => {
    if (sizeChoice === "original") return ORIGINAL_SIZE;
    if (sizeChoice !== "custom") return { mode: "percent", percent: Number(sizeChoice) };
    if (customLead === "pixels") {
      const pixels = parseWholeNumber(customPixels);
      return pixels && pixels > 0 ? { mode: "longEdge", pixels } : null;
    }
    const percent = parseWholeNumber(customPercent);
    return percent && percent > 0 ? { mode: "percent", percent } : null;
  }, [sizeChoice, customLead, customPixels, customPercent]);
  const resolved =
    full && sizeSetting ? resolveExportSize(sizeSetting, full.width, full.height) : null;

  const chooseSize = (choice: SizeChoice) => {
    setSizeChoice(choice);
    setNotice(null);
    // Opening Custom starts from the size it would save at now, so the fields are never empty.
    if (choice === "custom" && customPixels === "" && customPercent === "" && longest > 0) {
      setCustomPixels(String(resolved?.longEdge ?? longest));
      setCustomPercent(String(Math.round(((resolved?.longEdge ?? longest) / longest) * 100)));
      setCustomLead("pixels");
    }
  };
  const typePixels = (text: string) => {
    setCustomPixels(text);
    setCustomLead("pixels");
    setNotice(null);
    const n = parseWholeNumber(text);
    setCustomPercent(n && longest > 0 ? String(Math.round((n / longest) * 100)) : "");
  };
  const typePercent = (text: string) => {
    setCustomPercent(text);
    setCustomLead("percent");
    setNotice(null);
    const n = parseWholeNumber(text);
    setCustomPixels(n && longest > 0 ? String(Math.round((longest * n) / 100)) : "");
  };

  useEffect(() => {
    let alive = true;
    Promise.all(FORMATS.map(async (f) => [f.value, await canEncode(f.value)] as const)).then(
      (results) => {
        if (!alive) return;
        const support: Record<string, boolean> = Object.fromEntries(results);
        setEncodable(support);
        setFormat((current) => (support[current] === false ? "image/jpeg" : current));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const handleExport = async () => {
    if (!state.source || !sizeSetting) return;
    setProcessing("exporting");
    try {
      const result = await exportImageSafely(
        state.source.element,
        state.source.width,
        state.source.height,
        state.edit,
        format,
        quality,
        state.maskLayers,
        sizeSetting,
      );
      const { blob } = result;
      // Name the file after what the browser actually produced, not just what was asked for.
      const outcome = resolveExportOutcome(format, blob);
      const base = state.source.name.replace(/\.[^.]+$/, "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-pictoe.${outcome.extension}`;
      a.click();
      URL.revokeObjectURL(url);
      setProcessing("idle");
      const notes = [
        outcome.message,
        result.scaled ? describeScaledExport(result.requested, result) : null,
      ].filter(Boolean);
      if (notes.length > 0) {
        setNotice(notes.join(" ")); // keep the popover open so the note is seen
      } else {
        setNotice(null);
        setOpen(false);
      }
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
          aria-label="Export options"
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
                onClick={() => {
                  setFormat(f.value);
                  setNotice(null);
                }}
                disabled={encodable[f.value] === false}
                title={
                  encodable[f.value] === false
                    ? `${f.label} isn't supported by this browser`
                    : undefined
                }
                aria-pressed={format === f.value}
                className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${format === f.value ? "border-accent text-accent" : "border-border text-text-secondary hover:text-text-primary"}`}
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

          <p className="mb-sm text-[12px] uppercase tracking-[0.14em] text-text-muted">Size</p>
          <div role="radiogroup" aria-label="Size" className="mb-sm flex flex-wrap gap-xs">
            {SIZE_CHOICES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={sizeChoice === c.key}
                onClick={() => chooseSize(c.key)}
                className={`flex-1 rounded-md border px-sm py-1.5 text-[12px] transition-colors duration-150 ${sizeChoice === c.key ? "border-accent text-accent" : "border-border text-text-secondary hover:text-text-primary"}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {sizeChoice === "custom" && (
            <div className="mb-sm grid grid-cols-2 gap-sm">
              <label className="flex flex-col gap-xs text-[11px] text-text-muted">
                Longest side (px)
                <input
                  type="text"
                  inputMode="numeric"
                  value={customPixels}
                  onChange={(e) => typePixels(e.target.value)}
                  aria-invalid={sizeSetting === null}
                  className="rounded-md border border-border bg-surface px-sm py-1.5 text-[13px] tabular-nums text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <label className="flex flex-col gap-xs text-[11px] text-text-muted">
                Percent of original
                <input
                  type="text"
                  inputMode="numeric"
                  value={customPercent}
                  onChange={(e) => typePercent(e.target.value)}
                  aria-invalid={sizeSetting === null}
                  className="rounded-md border border-border bg-surface px-sm py-1.5 text-[13px] tabular-nums text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
            </div>
          )}

          <p role="status" className="mb-lg text-[12px] text-text-secondary">
            {resolved
              ? `Saves at ${describeSize(resolved.width, resolved.height)}`
              : "Enter a whole number, like 2048."}
            {resolved && describeSizeNote(resolved.note) && (
              <span className="mt-xs block text-text-muted">{describeSizeNote(resolved.note)}</span>
            )}
          </p>

          <button
            type="button"
            onClick={handleExport}
            disabled={busy || sizeSetting === null}
            className="w-full rounded-md bg-accent py-2 text-[13px] font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Save image"}
          </button>
          {notice && (
            <p role="status" className="mt-sm text-[12px] text-text-secondary">
              {notice}
            </p>
          )}
          <p className="mt-sm text-[11px] text-text-muted">Your original file is never modified.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
