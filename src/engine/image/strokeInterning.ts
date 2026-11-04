/**
 * Keeps stroke arrays recognisable after they have crossed a thread boundary.
 *
 * The mask and heal caches decide between "reuse", "append" and "rebuild" by comparing array and
 * item identity (see incremental.ts). A message to a Worker is structured-cloned, so every render
 * request arrives with brand-new arrays and objects, and identity would never match. This swaps
 * each incoming item for the previously seen item when the two are equal by value, and returns the
 * previously seen array itself when nothing changed, so the existing cache logic keeps working.
 */

function shallowEqual(a: object, b: object): boolean {
  if (a === b) return true;
  const ak = Object.keys(a) as (keyof typeof a)[];
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (a[key] !== (b as typeof a)[key]) return false;
  }
  return true;
}

export function internStrokes<T extends object>(
  cached: readonly T[] | undefined,
  incoming: readonly T[],
): readonly T[] {
  if (!cached) return incoming;
  if (cached === incoming) return cached;

  let allSame = incoming.length === cached.length;
  const items = incoming.map((item, i) => {
    const previous = cached[i];
    if (previous !== undefined && shallowEqual(previous, item)) return previous;
    allSame = false;
    return item;
  });
  return allSame ? cached : items;
}
