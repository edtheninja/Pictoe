import { Sparkles, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseIntent, type IntentSuggestion } from "./parseIntent";
import { useEditor } from "@/state/editor/EditorContext";
import type { AdjustmentKey } from "@/types/editor";

const EXAMPLES = ["Make the sky dramatic", "Warm the image slightly", "Make the subject stand out"];

export function IntentBar() {
  const { setAdjustment, beginInteraction, endInteraction, cancelInteraction } = useEditor();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<IntentSuggestion[] | null>(null);
  const [cloudOnly, setCloudOnly] = useState<{ label: string; description: string } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const isPreviewingRef = useRef(false);
  isPreviewingRef.current = previewing !== null;

  // Don't leave an uncommitted preview live if this panel closes mid-preview
  // (e.g. the user switches tools without hitting Apply or Dismiss).
  useEffect(() => {
    return () => {
      if (isPreviewingRef.current) cancelInteraction();
    };
  }, [cancelInteraction]);

  const run = (text: string) => {
    if (previewing) {
      cancelInteraction();
      setPreviewing(null);
    }
    const result = parseIntent(text);
    setSuggestions(result.suggestions);
    setCloudOnly(result.cloudOnly);
  };

  const togglePreview = (s: IntentSuggestion) => {
    if (previewing === s.label) {
      cancelInteraction();
      setPreviewing(null);
      return;
    }
    if (previewing) cancelInteraction();
    beginInteraction();
    for (const [key, val] of Object.entries(s.patch)) {
      setAdjustment(key as AdjustmentKey, val as number);
    }
    setPreviewing(s.label);
  };

  const apply = (s: IntentSuggestion) => {
    if (previewing !== s.label) {
      // Applied without previewing first — apply the patch in one step.
      beginInteraction();
      for (const [key, val] of Object.entries(s.patch)) {
        setAdjustment(key as AdjustmentKey, val as number);
      }
    }
    endInteraction();
    setPreviewing(null);
    setSuggestions(null);
    setValue("");
  };

  const dismiss = (s: IntentSuggestion) => {
    if (previewing === s.label) {
      cancelInteraction();
      setPreviewing(null);
    }
    setSuggestions((prev) => prev?.filter((x) => x !== s) ?? null);
  };

  return (
    <div className="min-w-0">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(value);
        }}
        className="flex items-center gap-sm rounded-lg border border-border bg-canvas px-md py-2 focus-within:border-accent/60"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What would you like to change?"
          aria-label="Describe the change you want"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md px-sm py-1 text-[12px] text-text-secondary transition-colors duration-150 hover:text-accent"
        >
          Suggest
        </button>
      </form>

      {!suggestions && !cloudOnly && (
        <div className="mt-sm flex flex-wrap gap-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setValue(ex);
                run(ex);
              }}
              className="rounded-full border border-border px-md py-1 text-[12px] text-text-muted transition-colors duration-150 hover:border-border-strong hover:text-text-secondary"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {cloudOnly && (
        <div className="mt-sm flex items-start gap-sm rounded-md border border-border bg-surface-elevated px-md py-sm">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <p className="text-[13px] text-text-secondary">
            <span className="text-text-primary">{cloudOnly.label}</span> runs online and isn't
            available yet. Your current edits remain safe.
          </p>
        </div>
      )}

      {suggestions && suggestions.length === 0 && (
        <p className="mt-sm text-[13px] text-text-muted">
          Pictoe didn't recognise that yet. Try words like brighter, warmer, dramatic or sharper.
        </p>
      )}

      {suggestions && suggestions.length > 0 && (
        <ul className="mt-sm flex flex-col gap-xs">
          {suggestions.map((s) => {
            const active = previewing === s.label;
            return (
              <li
                key={s.label}
                className={`flex flex-wrap items-center justify-between gap-sm rounded-md border px-md py-sm transition-colors duration-150 ${active ? "border-accent bg-accent/5" : "border-border bg-surface-elevated"}`}
              >
                <button
                  type="button"
                  onClick={() => togglePreview(s)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-[13px] text-text-primary">{s.label}</p>
                  <p className="text-[12px] text-text-muted">{s.description}</p>
                  {active && (
                    <p className="mt-1 text-[11px] text-accent">Previewing — tap again to stop</p>
                  )}
                </button>
                <div className="flex shrink-0 gap-xs">
                  <button
                    type="button"
                    onClick={() => dismiss(s)}
                    className="rounded-md px-sm py-1 text-[12px] text-text-muted transition-colors hover:text-text-secondary"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => apply(s)}
                    className="rounded-md bg-accent px-md py-1 text-[12px] font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-strong"
                  >
                    Apply
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
