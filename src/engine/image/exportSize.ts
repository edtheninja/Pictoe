import { scaledSize } from "./outputScale";

/** How big to save the file: as it is, a share of the original, or a chosen longest side. */
export type SizeSetting =
  | { mode: "original" }
  | { mode: "percent"; percent: number }
  | { mode: "longEdge"; pixels: number };

export const ORIGINAL_SIZE: SizeSetting = { mode: "original" };

/** Saving smaller than this is not useful, so a request below it is raised to it. */
export const MIN_LONG_EDGE = 16;

export type SizeNote =
  /** The request was larger than the photo: saved at the original size (Pictoe never enlarges). */
  | "not-upscaled"
  /** The request was smaller than MIN_LONG_EDGE: raised to it. */
  | "raised-to-minimum"
  /** The request made no sense (empty, zero, negative, not a number): saved at the original size. */
  | "ignored";

export type ResolvedSize = {
  width: number;
  height: number;
  /** The longest side to render at; the same as max(width, height). */
  longEdge: number;
  /** Share of the original, 0-1. */
  scale: number;
  note: SizeNote | null;
};

/**
 * The exact size a setting produces for a photo of `fullWidth` x `fullHeight` (after crop and
 * rotation). Total: whatever it is given, the answer is a real size, so a bad value can never
 * produce a broken file. Never larger than the photo, never below MIN_LONG_EDGE (unless the
 * photo itself is smaller), proportions kept.
 */
export function resolveExportSize(
  setting: SizeSetting,
  fullWidth: number,
  fullHeight: number,
): ResolvedSize {
  const longest = Math.max(1, Math.max(fullWidth, fullHeight));
  const original = (note: SizeNote | null): ResolvedSize => {
    const size = scaledSize(fullWidth, fullHeight);
    return { ...size, longEdge: Math.max(size.width, size.height), scale: 1, note };
  };

  let raw: number;
  if (setting.mode === "original") return original(null);
  if (setting.mode === "percent") raw = (longest * setting.percent) / 100;
  else raw = setting.pixels;
  if (!Number.isFinite(raw) || raw <= 0) return original("ignored");

  const target = Math.round(raw);
  if (target >= longest) return original(raw > longest ? "not-upscaled" : null);

  // A photo already at or below the minimum cannot be made smaller in any useful way.
  if (longest <= MIN_LONG_EDGE) return original(null);
  const longEdge = Math.max(target, MIN_LONG_EDGE);
  const size = scaledSize(fullWidth, fullHeight, longEdge);
  return {
    ...size,
    longEdge: Math.max(size.width, size.height),
    note: target < MIN_LONG_EDGE ? "raised-to-minimum" : null,
  };
}

/** A whole number typed by the user ("2048", " 2048 "), or null for anything else. */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** What to tell the user about a size note, or null when there is nothing to say. */
export function describeSizeNote(note: SizeNote | null): string | null {
  switch (note) {
    case "not-upscaled":
      return "That is larger than the photo, so it will save at the original size.";
    case "raised-to-minimum":
      return `Pictoe saves at ${MIN_LONG_EDGE} px at the smallest.`;
    case "ignored":
      return "That size isn't usable, so it will save at the original size.";
    default:
      return null;
  }
}
