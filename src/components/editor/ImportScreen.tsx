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
    <main className="flex min-h-screen w-full items-center justify-center bg-canvas px-8 py-16">
      <div className="flex w-full max-w-5xl flex-col items-start gap-16 lg:flex-row lg:items-center lg:gap-20">
        {/* LEFT — Pictoe information */}
        <div className="flex-1 lg:w-1/2">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-text-primary">
            Pictoe
          </p>

          <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-text-primary lg:text-6xl">
            Edit without limits.
          </h1>

          <p className="mt-5 text-lg leading-7 text-text-secondary">
            Your image. Your intent. Your control.
          </p>

          <div className="mt-10">
            <p className="text-sm font-medium text-text-primary">Start with an image.</p>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              Choose a photo from your device or drop one into Pictoe to begin editing.
            </p>
            <p className="mt-3 text-xs tracking-[0.12em] text-text-muted">JPG · PNG · WebP</p>
          </div>
        </div>

        {/* RIGHT — drop zone */}
        <div className="w-full lg:w-1/2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();

              if (event.currentTarget === event.target) {
                setDragging(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);

              void handleFile(event.dataTransfer.files?.[0]);
            }}
            className={[
              "group flex w-full flex-col items-center justify-center",
              "aspect-square rounded-2xl border border-dashed",
              "text-center transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-accent focus-visible:ring-offset-4",
              dragging
                ? "scale-[1.01] border-accent bg-accent/10"
                : "border-border bg-surface/20 hover:border-text-muted hover:bg-surface/40",
            ].join(" ")}
            aria-label="Choose an image or drop one here"
          >
            {/* Minimal + mark */}
            <span
              className={[
                "flex h-16 w-16 items-center justify-center rounded-full",
                "border text-2xl font-light transition-all duration-200",
                dragging
                  ? "border-accent text-accent"
                  : "border-border text-text-secondary group-hover:border-text-muted group-hover:text-text-primary",
              ].join(" ")}
              aria-hidden="true"
            >
              +
            </span>

            <p className="mt-8 text-lg font-medium text-text-primary">
              {dragging ? "Release to open your image" : "Choose an image"}
            </p>

            <p className="mt-2 text-sm text-text-secondary">or drop it here</p>

            <span
              className="
                mt-8 inline-flex h-11 items-center justify-center
                rounded-xl bg-accent px-7 text-sm font-medium
                text-accent-foreground transition-colors duration-150
                group-hover:bg-accent-strong
              "
            >
              Choose image
            </span>
          </button>

          {message && (
            <p role="alert" className="mt-4 text-sm leading-6 text-danger">
              {message}
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Choose an image to edit"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
            }}
          />
        </div>
      </div>
    </main>
  );
}
