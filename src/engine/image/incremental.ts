export type IncrementalPlan = "reuse" | "append" | "rebuild";

/**
 * How to bring something built from an ordered list of immutable items (mask strokes, clone
 * strokes) up to date. The reducers replace the array whenever it changes and keep the item
 * objects, so identity comparisons are a safe, cheap way to tell "nothing changed" from
 * "items were added" from "an undo swapped in a different history".
 */
export function planStrokeUpdate<T>(
  cached: readonly T[] | undefined,
  next: readonly T[],
): IncrementalPlan {
  if (!cached) return "rebuild";
  if (cached === next) return "reuse";
  // Fewer (or the same number of) items but a different array: an undo or redo. Start over.
  if (next.length <= cached.length) return "rebuild";
  for (let i = 0; i < cached.length; i++) {
    if (next[i] !== cached[i]) return "rebuild";
  }
  return "append";
}
