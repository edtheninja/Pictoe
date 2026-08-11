import { Eye } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";

/** Hold to see the original; also toggleable by keyboard for accessibility. */
export function BeforeAfter() {
  const { state, setShowOriginal, isEdited } = useEditor();

  return (
    <button
      type="button"
      disabled={!isEdited}
      aria-pressed={state.showOriginal}
      aria-label="Compare with original — hold to view, or press to toggle"
      onPointerDown={() => setShowOriginal(true)}
      onPointerUp={() => setShowOriginal(false)}
      onPointerLeave={() => setShowOriginal(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setShowOriginal(!state.showOriginal);
      }}
      className={`flex items-center gap-xs rounded-md border border-border px-md py-1.5 text-[12px] transition-colors duration-150 disabled:opacity-40 ${
        state.showOriginal
          ? "border-accent text-accent"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      <Eye className="h-3.5 w-3.5" />
      Before
    </button>
  );
}
