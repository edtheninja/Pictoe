import { Redo2, Undo2, X } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { ExportControl } from "./ExportControl";

export function EditorHeader() {
  const { state, undo, redo, canUndo, canRedo, closeImage } = useEditor();

  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-md border-b border-border bg-surface px-lg py-sm">
      <div className="flex min-w-0 items-center gap-md">
        <span className="shrink-0 text-[15px] font-semibold tracking-tight text-text-primary">
          Pictoe
        </span>
        {state.source && (
          <span className="min-w-0 truncate text-[12px] text-text-muted">{state.source.name}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-xs">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Ctrl/Cmd + Z)"
          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary disabled:opacity-30"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl/Cmd + Shift + Z)"
          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary disabled:opacity-30"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        {state.source && (
          <button
            type="button"
            onClick={closeImage}
            aria-label="Close image"
            className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-danger"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="mx-xs h-5 w-px bg-border" />
        <ExportControl />
      </div>
    </header>
  );
}
