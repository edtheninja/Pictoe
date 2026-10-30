import { MAX_CANVAS_SIDE, describeSize } from "./limits";

/** Fractions of the full size to try, largest first. */
export const EXPORT_SCALES = [1, 0.75, 0.5, 0.35, 0.25, 0.15] as const;

export type ExportAttempt = { blob: Blob | null; width: number; height: number };

export type ExportResult = {
  blob: Blob;
  width: number;
  height: number;
  /** True when the file is smaller than the full-size result would have been. */
  scaled: boolean;
};

/**
 * Browsers fail quietly when a canvas is too big (Safari on iPhones caps it near 16 megapixels,
 * and any browser can run out of memory), so a full-size export cannot be assumed to work.
 * This tries the full size first and steps down until the browser produces a file.
 *
 * `attempt(maxDimension)` renders and encodes at that longest-side size; it may return a null
 * blob or throw when the browser can't, and the next smaller size is tried.
 */
export async function exportWithFallback(
  fullWidth: number,
  fullHeight: number,
  attempt: (maxDimension: number) => Promise<ExportAttempt>,
): Promise<ExportResult> {
  const longest = Math.max(fullWidth, fullHeight);
  for (const scale of EXPORT_SCALES) {
    const maxDimension = Math.round(longest * scale);
    if (maxDimension < 1 || maxDimension > MAX_CANVAS_SIDE) continue;
    try {
      const result = await attempt(maxDimension);
      if (result.blob && result.blob.size > 0) {
        return {
          blob: result.blob,
          width: result.width,
          height: result.height,
          scaled: result.width < fullWidth || result.height < fullHeight,
        };
      }
    } catch {
      // Out of memory or a canvas limit: fall through to a smaller size.
    }
  }
  throw new Error("encode-failed");
}

/** A plain-language note for when the saved file is smaller than the photo. */
export function describeScaledExport(
  full: { width: number; height: number },
  saved: { width: number; height: number },
): string {
  return `Saved at ${describeSize(saved.width, saved.height).replace(/ \(.*\)$/, "")} instead of ${describeSize(full.width, full.height).replace(/ \(.*\)$/, "")}, because this browser couldn't make a larger image.`;
}
