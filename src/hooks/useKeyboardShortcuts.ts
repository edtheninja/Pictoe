import { useEffect } from "react";
import { useEditor } from "@/state/editor/EditorContext";

export function useKeyboardShortcuts() {
  const { undo, redo, setShowOriginal, setViewport, state } = useEditor();

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "\\" && !e.repeat) setShowOriginal(true);
      if (e.key === "0") setViewport({ zoom: 1, panX: 0, panY: 0 });
      if (e.key === "+" || e.key === "=") setViewport({ zoom: Math.min(8, state.viewport.zoom * 1.25) });
      if (e.key === "-") setViewport({ zoom: Math.max(0.1, state.viewport.zoom / 1.25) });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "\\") setShowOriginal(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo, setShowOriginal, setViewport, state.viewport.zoom]);
}
