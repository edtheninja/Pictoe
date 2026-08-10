import { useEditor } from "@/state/editor/EditorContext";

/**
 * Non-destructive crop overlay: shows the live crop rect with a rule-of-thirds
 * guide. The rect itself is driven by the crop tool controls.
 */
export function CropOverlay() {
  const { state } = useEditor();
  const { crop } = state.edit;
  const isFull = crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
  if (isFull) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute inset-0 bg-canvas/50" />
      <div
        className="absolute border border-accent"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.width * 100}%`,
          height: `${crop.height * 100}%`,
          boxShadow: "0 0 0 9999px oklch(0 0 0 / 0.0)",
          backgroundColor: "transparent",
          mixBlendMode: "normal",
        }}
      >
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-accent/20" />
          ))}
        </div>
      </div>
    </div>
  );
}
