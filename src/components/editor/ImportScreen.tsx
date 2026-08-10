import { useRef, useState } from "react";
import { useEditor } from "@/state/editor/EditorContext";
import { loadImageFile, ImageLoadError } from "@/engine/image/load";

export function ImportScreen() {
  const { setSource, setError } = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setMessage(null);
    try {
      const image = await loadImageFile(file);
      setSource(image);
      setError(null);
    } catch (err) {
      setMessage(
        err instanceof ImageLoadError
          ? err.message
          : "Pictoe couldn't process this image. Try another image or check its format.",
      );
    }
  };

  return (
    <div
      className="flex flex-1 items-center justify-center px-lg"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div
        className={`w-full max-w-md rounded-xl border border-dashed px-xl py-3xl text-center transition-colors duration-200 ${
          dragging ? "border-accent bg-surface/60" : "border-border"
        }`}
      >
        <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-text-primary">
          Pictoe
        </h1>
        <p className="mt-sm text-[16px] leading-6 text-text-secondary">Drop an image here</p>
        <p className="mt-xs text-[13px] text-text-muted">or</p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-lg rounded-md bg-accent px-xl py-2 text-[14px] font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-strong"
        >
          Choose image
        </button>

        <p className="mt-xl text-[12px] tracking-wide text-text-muted">JPG · PNG · WebP</p>

        {message && (
          <p role="alert" className="mt-lg text-[13px] text-danger">
            {message}
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Choose an image to edit"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
