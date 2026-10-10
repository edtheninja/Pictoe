/**
 * Two-finger pinch-to-zoom and pan, kept free of React and the DOM so it can be unit-tested.
 * Points are measured from the centre of the canvas container, the same convention as the
 * wheel-zoom code. The picture's transform is translate(pan) then scale(zoom) about its
 * centre, so a point u on the picture (from its centre) sits at screen position pan + zoom·u.
 */
export type Point = { x: number; y: number };
export type ViewState = { zoom: number; panX: number; panY: number };

/** Fingers closer than this (in px) are treated as one, avoiding divide-by-zero on a pinch start. */
const MIN_PINCH_DISTANCE = 8;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type PinchStart = { view: ViewState; mid: Point; dist: number };

/**
 * The view after the fingers moved from `start` to `now`. The point of the picture that was
 * under the starting midpoint ends up under the current midpoint, so it follows the fingers.
 */
export function pinchView(
  start: PinchStart,
  now: { mid: Point; dist: number },
  minZoom: number,
  maxZoom: number,
): ViewState {
  const zoom = clamp(start.view.zoom * (now.dist / start.dist), minZoom, maxZoom);
  const k = zoom / start.view.zoom;
  return {
    zoom,
    panX: now.mid.x - k * (start.mid.x - start.view.panX),
    panY: now.mid.y - k * (start.mid.y - start.view.panY),
  };
}

export class PinchTracker {
  private pointers = new Map<number, Point>();
  private pinch: (PinchStart & { ids: [number, number] }) | null = null;

  constructor(
    private readonly minZoom: number,
    private readonly maxZoom: number,
  ) {}

  /** True while two fingers are driving a pinch. */
  get active() {
    return this.pinch !== null;
  }

  /** Records a pointer going down. Returns true if this started a pinch. */
  down(id: number, p: Point, view: ViewState): boolean {
    this.pointers.set(id, p);
    if (this.pinch || this.pointers.size < 2) return false;

    const [a, b] = [...this.pointers.keys()] as [number, number];
    const pa = this.pointers.get(a)!;
    const pb = this.pointers.get(b)!;
    const dist = distance(pa, pb);
    if (dist < MIN_PINCH_DISTANCE) return false;

    this.pinch = { ids: [a, b], view, mid: midpoint(pa, pb), dist };
    return true;
  }

  /** Records movement. Returns the new view while pinching, otherwise null. */
  move(id: number, p: Point): ViewState | null {
    if (!this.pointers.has(id)) return null;
    this.pointers.set(id, p);
    if (!this.pinch) return null;

    const pa = this.pointers.get(this.pinch.ids[0]);
    const pb = this.pointers.get(this.pinch.ids[1]);
    if (!pa || !pb) return null;
    return pinchView(
      this.pinch,
      { mid: midpoint(pa, pb), dist: distance(pa, pb) },
      this.minZoom,
      this.maxZoom,
    );
  }

  /** Forgets a pointer. Returns true if that ended an active pinch. */
  up(id: number): boolean {
    this.pointers.delete(id);
    if (this.pinch?.ids.includes(id)) {
      this.pinch = null;
      return true;
    }
    return false;
  }

  reset() {
    this.pointers.clear();
    this.pinch = null;
  }
}
