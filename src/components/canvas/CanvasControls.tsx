import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary"
    >
      {children}
    </button>
  );
}

export function CanvasControls() {
  const { state, setViewport } = useEditor();
  const { zoom } = state.viewport;

  const setZoom = (z: number) => setViewport({ zoom: Math.min(8, Math.max(0.1, z)) });

  return (
    <div className="pointer-events-auto absolute bottom-lg left-1/2 flex -translate-x-1/2 items-center gap-xs rounded-full border border-border bg-surface/85 px-sm py-xs backdrop-blur">
      <IconBtn label="Zoom out" onClick={() => setZoom(zoom / 1.25)}>
        <Minus className="h-4 w-4" />
      </IconBtn>
      <button
        type="button"
        onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
        className="min-w-14 rounded-md px-xs py-1 text-[12px] tabular-nums text-text-secondary transition-colors hover:text-text-primary"
        aria-label={`Zoom level ${Math.round(zoom * 100)} percent. Reset zoom`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconBtn label="Zoom in" onClick={() => setZoom(zoom * 1.25)}>
        <Plus className="h-4 w-4" />
      </IconBtn>
      <div className="mx-xs h-4 w-px bg-border" />
      <IconBtn label="Fit to screen" onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}>
        <Maximize2 className="h-4 w-4" />
      </IconBtn>
      <IconBtn label="Center image" onClick={() => setViewport({ panX: 0, panY: 0 })}>
        <RotateCcw className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}
