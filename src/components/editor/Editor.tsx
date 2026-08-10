import { Canvas } from "@/components/canvas/Canvas";
import { AdjustmentPanel } from "./AdjustmentPanel";
import { EditorHeader } from "./EditorHeader";
import { ImportScreen } from "./ImportScreen";
import { ToolDock } from "./ToolDock";
import { EditorProvider, useEditor } from "@/state/editor/EditorContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function EditorShell() {
  const { state, setError } = useEditor();
  useKeyboardShortcuts();

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <EditorHeader />

      {state.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-md border-b border-border bg-surface px-lg py-sm text-[13px] text-danger"
        >
          <span className="min-w-0">{state.error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-text-muted transition-colors hover:text-text-primary"
          >
            Dismiss
          </button>
        </div>
      )}

      {state.source ? (
        <>
          <Canvas />
          <AdjustmentPanel />
          <ToolDock />
        </>
      ) : (
        <ImportScreen />
      )}
    </main>
  );
}

export function Editor() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}
