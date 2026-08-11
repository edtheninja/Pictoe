import { ArrowLeft, Redo2, Undo2 } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { ExportControl } from "@/components/editor/ExportControl";

export function EditorHeader() {
  const { state, undo, redo, closeImage, canUndo, canRedo } = useEditor();

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-canvas px-4 sm:px-6">
      <button
        type="button"
        onClick={closeImage}
        className="flex items-center gap-2 text-sm font-semibold tracking-wide text-text-primary transition-opacity hover:opacity-70"
        aria-label="Return to import screen"
      >
        <ArrowLeft className="h-4 w-4" />
        Pictoe
      </button>

      <div className="ml-5 hidden min-w-0 flex-1 sm:block">
        <p className="truncate text-xs text-text-muted">{state.source?.name ?? "Untitled image"}</p>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={undo}
          className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary disabled:opacity-30"
          aria-label="Undo"
          disabled={!canUndo}
        >
          <Undo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={redo}
          className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary disabled:opacity-30"
          aria-label="Redo"
          disabled={!canRedo}
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <ExportControl />
      </div>
    </header>
  );
}
