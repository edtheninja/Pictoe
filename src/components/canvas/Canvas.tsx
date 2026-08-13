import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderImage, outputSize } from "@/engine/image/render";
import { useEditor } from "@/state/editor/EditorContext";
import { DEFAULT_ADJUSTMENTS, DEFAULT_CROP } from "@/types/editor";
import { CanvasControls } from "./CanvasControls";
import { CropOverlay } from "./CropOverlay";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export function Canvas() {
  const { state, setViewport, setError } = useEditor();
  const { source, edit, viewport, showOriginal, activeTool } = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const isCropping = activeTool === "crop";

  const out = useMemo(() => {
    if (!source) return { width: 1, height: 1 };
    const sizingEdit = isCropping ? { ...edit, crop: { ...DEFAULT_CROP } } : edit;
    return outputSize(source.width, source.height, sizingEdit);
  }, [source, edit, isCropping]);

  const fitScale = useMemo(() => {
    if (!box.width || !box.height) return 1;
    return Math.min((box.width - 64) / out.width, (box.height - 64) / out.height, 1.5);
  }, [box, out]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Preview render — downscaled to what the viewport can actually show.
  useEffect(() => {
    if (!source || !canvasRef.current) return;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const maxDim = Math.min(
          2400,
          Math.max(640, Math.max(out.width, out.height) * fitScale * viewport.zoom * dpr),
        );
        const previewEdit = {
          ...edit,
          adjustments: showOriginal ? { ...DEFAULT_ADJUSTMENTS } : edit.adjustments,
          crop: isCropping ? { ...DEFAULT_CROP } : edit.crop,
        };
        renderImage(
          source.element,
          source.width,
          source.height,
          previewEdit,
          canvasRef.current!,
          maxDim,
        );
      } catch {
        setError("Pictoe couldn't process this image. Try another image or check its format.");
      }
    });
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [
    source,
    edit,
    showOriginal,
    isCropping,
    fitScale,
    viewport.zoom,
    out.width,
    out.height,
    setError,
  ]);

  const zoomAt = useCallback(
    (nextZoom: number, px: number, py: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      const k = z / viewport.zoom;
      setViewport({
        zoom: z,
        panX: px - (px - viewport.panX) * k,
        panY: py - (py - viewport.panY) * k,
      });
    },
    [viewport, setViewport],
  );

  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  const viewportZoomRef = useRef(viewport.zoom);
  viewportZoomRef.current = viewport.zoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomRef.current(viewportZoomRef.current * Math.exp(-dy * 0.0018), px, py);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (activeTool === "crop") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: viewport.panX, panY: viewport.panY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setViewport({ panX: d.panX + (e.clientX - d.x), panY: d.panY + (e.clientY - d.y) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (!source) return null;

  const displayW = out.width * fitScale;
  const displayH = out.height * fitScale;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-background"
      role="region"
      aria-label="Image canvas"
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          cursor: activeTool === "crop" ? "default" : dragRef.current ? "grabbing" : "grab",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="relative shadow-strong checker"
          style={{
            width: displayW,
            height: displayH,
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
            transition: dragRef.current ? "none" : "transform 180ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full select-none"
            aria-label={showOriginal ? "Original image" : "Edited image preview"}
          />
          {activeTool === "crop" && <CropOverlay />}
        </div>
      </div>

      {showOriginal && (
        <div className="pointer-events-none absolute left-1/2 top-lg -translate-x-1/2 rounded-full bg-surface-elevated/90 px-md py-xs text-[12px] font-medium tracking-wide text-text-secondary backdrop-blur">
          Original
        </div>
      )}

      <CanvasControls />
    </div>
  );
}
