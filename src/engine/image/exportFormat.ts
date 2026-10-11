/**
 * canvas.toBlob() never fails when it can't encode the format it was asked for: the HTML spec
 * has it quietly return a PNG. Safari has never been able to encode WebP from a canvas, so a
 * WebP export there used to be saved as a PNG named ".webp". These helpers check what the
 * browser actually produced, so the file name is always honest.
 */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
};

export type ExportOutcome = {
  /** The MIME type the file really has. */
  type: string;
  /** File extension to save with. */
  extension: string;
  /** True when the browser produced a different format from the one requested. */
  fellBack: boolean;
  /** A plain-language note for the user when it did. */
  message: string | null;
};

export function resolveExportOutcome(requested: string, blob: { type: string }): ExportOutcome {
  const actual = blob.type;
  // An empty or unfamiliar type tells us nothing, so trust the request rather than guess.
  if (!(actual in EXTENSIONS) || actual === requested) {
    return {
      type: requested,
      extension: EXTENSIONS[requested] ?? "png",
      fellBack: false,
      message: null,
    };
  }
  return {
    type: actual,
    extension: EXTENSIONS[actual]!,
    fellBack: true,
    message: `Your browser can't save ${LABELS[requested] ?? requested}, so Pictoe saved a ${LABELS[actual]} instead.`,
  };
}

type ProbeCanvas = Pick<HTMLCanvasElement, "width" | "height" | "toBlob">;

/**
 * Whether this browser can really encode the format, found by trying it on a 1×1 canvas.
 * PNG is always available. If the check itself can't run, don't block the user.
 */
export async function canEncode(
  mime: string,
  makeCanvas: () => ProbeCanvas = () => document.createElement("canvas"),
): Promise<boolean> {
  if (mime === "image/png") return true;
  try {
    const probe = makeCanvas();
    probe.width = 1;
    probe.height = 1;
    const blob = await new Promise<Blob | null>((resolve) => probe.toBlob(resolve, mime));
    return blob?.type === mime;
  } catch {
    return true;
  }
}
