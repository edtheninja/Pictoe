import type { CropRect } from "@/types/editor";

/** The smallest the crop can get, as a fraction of the frame. */
export const MIN_SIZE = 0.06;

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Slide the crop by (dx, dy), keeping it inside the frame. */
export function moveCrop(start: CropRect, dx: number, dy: number): CropRect {
  return {
    x: Math.min(Math.max(0, start.x + dx), 1 - start.width),
    y: Math.min(Math.max(0, start.y + dy), 1 - start.height),
    width: start.width,
    height: start.height,
  };
}

/** Drag the edges named by `handle` by (dx, dy), staying inside the frame and above MIN_SIZE. */
export function resizeCrop(
  start: CropRect,
  handle: Exclude<CropHandle, "move">,
  dx: number,
  dy: number,
): CropRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (handle.includes("w")) left = clamp01(start.x + dx);
  if (handle.includes("e")) right = clamp01(start.x + start.width + dx);
  if (handle.includes("n")) top = clamp01(start.y + dy);
  if (handle.includes("s")) bottom = clamp01(start.y + start.height + dy);

  if (right - left < MIN_SIZE) {
    if (handle.includes("w")) left = right - MIN_SIZE;
    else right = left + MIN_SIZE;
  }
  if (bottom - top < MIN_SIZE) {
    if (handle.includes("n")) top = bottom - MIN_SIZE;
    else bottom = top + MIN_SIZE;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
export type ArrowKey = (typeof ARROW_KEYS)[number];
export const isArrowKey = (key: string): key is ArrowKey =>
  (ARROW_KEYS as readonly string[]).includes(key);

/**
 * Keyboard control. An arrow key moves the crop by 1% of the frame (5% with `big`).
 * With `resize`, the right and bottom edges move instead: → widens, ← narrows, ↓ lengthens, ↑ shortens.
 */
export function nudgeCrop(
  crop: CropRect,
  key: ArrowKey,
  { resize = false, big = false }: { resize?: boolean; big?: boolean } = {},
): CropRect {
  const step = big ? 0.05 : 0.01;
  const dx = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
  const dy = key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0;
  return resize ? resizeCrop(crop, "se", dx, dy) : moveCrop(crop, dx, dy);
}

/** A sentence for screen readers: "Crop 60% wide, 50% tall, 12% from the left, 10% from the top." */
export function describeCrop(crop: CropRect): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `Crop ${pct(crop.width)} wide, ${pct(crop.height)} tall, ${pct(crop.x)} from the left, ${pct(crop.y)} from the top.`;
}
