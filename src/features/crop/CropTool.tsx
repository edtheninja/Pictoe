import { FlipHorizontal, RotateCcw, RotateCw } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { DEFAULT_CROP } from "@/types/editor";

const RATIOS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
];

export function CropTool() {
  const { state, applyEdit } = useEditor();
  const { source, edit } = state;
  if (!source) return null;

  const rot = ((edit.rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const baseW = swap ? source.height : source.width;
  const baseH = swap ? source.width : source.height;

  const applyRatio = (ratio: number | null) => {
    if (ratio === null) {
      applyEdit({ crop: { ...DEFAULT_CROP } });
      return;
    }
    const imageRatio = baseW / baseH;
    let width = 1;
    let height = 1;
    if (imageRatio > ratio) width = ratio / imageRatio;
    else height = imageRatio / ratio;
    applyEdit({
      crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
    });
  };

  const rotate = (delta: number) =>
    applyEdit({ rotation: (edit.rotation + delta + 360) % 360, crop: { ...DEFAULT_CROP } });

  return (
    <div className="flex flex-wrap items-center gap-md">
      <div className="flex flex-wrap items-center gap-xs">
        {RATIOS.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => applyRatio(r.value)}
            className="rounded-md border border-border px-md py-1.5 text-[12px] text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex items-center gap-xs">
        <button
          type="button"
          aria-label="Rotate left"
          onClick={() => rotate(-90)}
          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Rotate right"
          onClick={() => rotate(90)}
          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Flip horizontally"
          aria-pressed={edit.flipH}
          onClick={() => applyEdit({ flipH: !edit.flipH })}
          className={`grid h-8 w-8 place-items-center rounded-md transition-colors duration-150 hover:bg-surface-elevated ${
            edit.flipH ? "text-accent" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <FlipHorizontal className="h-4 w-4" />
        </button>
      </div>
      <span className="text-[12px] tabular-nums text-text-muted">
        {Math.round(baseW * edit.crop.width)} × {Math.round(baseH * edit.crop.height)} px
      </span>
    </div>
  );
}
