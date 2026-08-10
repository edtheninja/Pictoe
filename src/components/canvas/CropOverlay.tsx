import { useEditor } from "@/state/editor/EditorContext";

/** Rule-of-thirds guide shown while the crop tool is active. */
export function CropOverlay() {
  const { state } = useEditor();
  if (state.activeTool !== "crop") return null;

  return (
    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="border border-text-primary/15" />
      ))}
    </div>
  );
}
