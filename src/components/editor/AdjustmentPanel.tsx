import { WifiOff } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { AdjustmentGroup } from "@/features/adjustments/AdjustmentGroup";
import { CropTool } from "@/features/crop/CropTool";
import { IntentBar } from "@/features/intent/IntentBar";
import { BeforeAfter } from "./BeforeAfter";

const TITLES: Record<string, string> = {
  adjust: "Light",
  color: "Color",
  detail: "Detail",
  crop: "Crop & rotate",
  heal: "Heal",
  intent: "Intent",
};

/** Contextual panel — only visible while a tool is active. */
export function AdjustmentPanel() {
  const { state, resetAll, isEdited } = useEditor();
  const tool = state.activeTool;
  if (!tool) return null;

  return (
    <section
      aria-label={`${TITLES[tool]} controls`}
      className="animate-in fade-in slide-in-from-bottom-2 border-t border-border bg-surface px-lg py-md duration-200"
    >
      <header className="mb-sm grid grid-cols-[minmax(0,1fr)_auto] items-center gap-md">
        <h2 className="truncate text-[12px] font-medium uppercase tracking-[0.14em] text-text-muted">
          {TITLES[tool]}
        </h2>
        <div className="flex shrink-0 items-center gap-sm">
          <BeforeAfter />
          {isEdited && (
            <button
              type="button"
              onClick={resetAll}
              className="text-[12px] text-text-muted transition-colors duration-150 hover:text-danger"
            >
              Reset all
            </button>
          )}
        </div>
      </header>

      <div className="max-h-[38vh] overflow-y-auto pr-xs">
        {tool === "adjust" && <AdjustmentGroup group="light" />}
        {tool === "color" && <AdjustmentGroup group="color" />}
        {tool === "detail" && <AdjustmentGroup group="detail" />}
        {tool === "crop" && <CropTool />}
        {tool === "intent" && <IntentBar />}
        {tool === "heal" && (
          <div className="flex items-start gap-sm text-[13px] text-text-secondary">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            <p>
              Healing and object removal run on Pictoe's cloud engine and need an internet
              connection. They're coming next — your current edits remain safe.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
