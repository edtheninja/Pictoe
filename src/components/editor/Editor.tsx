import { EditorProvider, useEditor } from "@/state/editor/EditorContext";
import { Canvas } from "@/components/canvas/Canvas";
import { AdjustmentPanel } from "@/components/editor/AdjustmentPanel";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { ImportScreen } from "@/components/editor/ImportScreen";
import { ToolDock } from "@/components/editor/ToolDock";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export function Editor() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}

function EditorShell() {
  const { state } = useEditor();
  useKeyboardShortcuts();

  if (!state.source) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas text-text-primary">
        <ImportScreen />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-text-primary">
      <EditorHeader />

      {state.error && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {state.error}
        </div>
      )}

      {/* Below lg the tool panel is a sheet under the photo and the canvas takes the space that is
          left; from lg up it is a side column. Either way the panel never covers the image. */}
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <Canvas />
        </div>
        <AdjustmentPanel />
      </main>

      <ToolDock />
    </div>
  );
}
