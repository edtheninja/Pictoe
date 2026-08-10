import { Contrast, Crop, Droplet, Focus, Sparkles, Stamp } from "lucide-react";
import type { ToolId } from "@/types/editor";
import { useEditor } from "@/state/editor/EditorContext";

const TOOLS: { id: ToolId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "adjust", label: "Adjust", icon: Contrast },
  { id: "color", label: "Color", icon: Droplet },
  { id: "detail", label: "Detail", icon: Focus },
  { id: "crop", label: "Crop", icon: Crop },
  { id: "heal", label: "Heal", icon: Stamp },
  { id: "intent", label: "Intent", icon: Sparkles },
];

export function ToolDock() {
  const { state, setTool } = useEditor();

  return (
    <nav
      aria-label="Editing tools"
      className="flex items-center gap-xs overflow-x-auto border-t border-border bg-surface px-md py-sm [scrollbar-width:none]"
    >
      {TOOLS.map(({ id, label, icon: Icon }) => {
        const active = state.activeTool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            aria-pressed={active}
            className={`flex shrink-0 items-center gap-sm rounded-md px-md py-2 text-[13px] transition-colors duration-150 ${
              active
                ? "bg-surface-elevated text-text-primary"
                : "text-text-muted hover:bg-surface-elevated/60 hover:text-text-secondary"
            }`}
          >
            <Icon className={`h-4 w-4 ${id === "intent" ? "text-accent" : ""}`} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
