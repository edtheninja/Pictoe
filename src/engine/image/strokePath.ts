/**
 * Where to put the dabs of a stroke as the pointer moves. A pointer reports its position a few
 * dozen times a second, so on a quick swipe two reports can be many brush-widths apart; putting a
 * dab only at each report would leave unpainted gaps between them. Instead, dabs are laid along
 * the straight line from the last dab to the pointer, one every `spacing` pixels.
 */

type Point = { x: number; y: number };

/**
 * Most dabs one pointer report may add. A pointer cannot cover more than this in one report in
 * practice (a 30 px brush spaced at 7.5 px would need a 1,500 px jump); the cap only stops a
 * stray jump from queueing thousands of dabs. The next report carries on from the last dab.
 */
export const MAX_DABS_PER_MOVE = 200;

/**
 * The dab centres to add when the pointer has arrived at `to` and the last dab was at `last`
 * (null at the start of a stroke). Points are in the picture's 0-1 coordinates; `width` and
 * `height` are its size in pixels, so spacing is measured in real pixels on a wide or tall
 * picture. The first dab of a stroke goes where the pointer went down. After that, a dab is put
 * every `spacing` pixels along the line, and none when the pointer has moved less than one
 * spacing, so the caller's "last dab" must be set to the final point returned, not to `to`.
 */
export function dabsAlong(
  last: Point | null,
  to: Point,
  spacing: number,
  width: number,
  height: number,
): Point[] {
  if (!last) return [to];
  if (!(spacing > 0)) return [];

  const dx = (to.x - last.x) * width;
  const dy = (to.y - last.y) * height;
  const distance = Math.hypot(dx, dy);
  // The tolerance is for float rounding: a move of exactly five spacings can come out as 4.9999...,
  // and would otherwise lose its last dab.
  const count = Math.min(MAX_DABS_PER_MOVE, Math.floor(distance / spacing + 1e-9));

  const points: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const t = (i * spacing) / distance;
    points.push({ x: last.x + (to.x - last.x) * t, y: last.y + (to.y - last.y) * t });
  }
  return points;
}
