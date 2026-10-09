/**
 * Canvas `ctx.filter` is disabled by default in Safari and iOS Safari, where assigning it is
 * silently ignored. Pictoe's exposure, contrast, saturation and blur all rely on it, so this
 * module detects support and provides a pixel-maths fallback that follows the CSS filter
 * definitions (brightness → contrast → saturate → blur, each clamped).
 */

export type FilterParams = {
  brightness: number;
  contrast: number;
  saturate: number;
  /** Gaussian standard deviation in pixels. */
  blurPx: number;
};

export const NO_FILTER: FilterParams = { brightness: 1, contrast: 1, saturate: 1, blurPx: 0 };

const BLUR_THRESHOLD = 0.15;

/** The same CSS filter string the renderer has always set on the canvas context. */
export function filterString(p: FilterParams): string {
  const parts = [
    `brightness(${p.brightness.toFixed(4)})`,
    `contrast(${p.contrast.toFixed(4)})`,
    `saturate(${p.saturate.toFixed(4)})`,
  ];
  if (p.blurPx > BLUR_THRESHOLD) parts.push(`blur(${p.blurPx.toFixed(2)}px)`);
  return parts.join(" ");
}

let cachedSupport: boolean | undefined;

/**
 * Behavioural test, not user-agent sniffing: invert a black pixel and see whether it turned
 * white. If the check itself can't run, keep the native path so behaviour never gets worse.
 */
export function supportsCanvasFilter(): boolean {
  if (cachedSupport !== undefined) return cachedSupport;
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext("2d");
    if (!ctx) {
      cachedSupport = true;
      return true;
    }
    ctx.filter = "invert(1)";
    ctx.fillRect(0, 0, 1, 1);
    cachedSupport = ctx.getImageData(0, 0, 1, 1).data[0] === 255;
  } catch {
    cachedSupport = true;
  }
  return cachedSupport;
}

/** For tests. */
export function resetCanvasFilterSupportCache() {
  cachedSupport = undefined;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Applies the filter chain to RGBA pixel data in place. */
export function filterPixels(data: Uint8ClampedArray, w: number, h: number, p: FilterParams) {
  if (p.brightness !== 1 || p.contrast !== 1 || p.saturate !== 1) {
    const b = p.brightness;
    const c = p.contrast;
    const s = p.saturate;
    const intercept = 255 * (0.5 - 0.5 * c);

    // The saturate() colour matrix from the Filter Effects specification.
    const m00 = 0.213 + 0.787 * s;
    const m01 = 0.715 - 0.715 * s;
    const m02 = 0.072 - 0.072 * s;
    const m10 = 0.213 - 0.213 * s;
    const m11 = 0.715 + 0.285 * s;
    const m12 = 0.072 - 0.072 * s;
    const m20 = 0.213 - 0.213 * s;
    const m21 = 0.715 - 0.715 * s;
    const m22 = 0.072 + 0.928 * s;

    for (let i = 0; i < data.length; i += 4) {
      const r = clamp255(clamp255(data[i]! * b) * c + intercept);
      const g = clamp255(clamp255(data[i + 1]! * b) * c + intercept);
      const bl = clamp255(clamp255(data[i + 2]! * b) * c + intercept);

      data[i] = clamp255(m00 * r + m01 * g + m02 * bl);
      data[i + 1] = clamp255(m10 * r + m11 * g + m12 * bl);
      data[i + 2] = clamp255(m20 * r + m21 * g + m22 * bl);
      // Alpha is untouched by these three filters.
    }
  }

  if (p.blurPx > BLUR_THRESHOLD) gaussianBlur(data, w, h, p.blurPx);
}

/** Box sizes whose three successive passes approximate a Gaussian of the given sigma. */
function boxSizes(sigma: number, passes: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round(
    (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) /
      (-4 * lower - 4),
  );
  return Array.from({ length: passes }, (_, i) => (i < m ? lower : upper));
}

/** One box blur over a line of samples, extending the edge pixels outward. */
function boxPass(line: Float32Array, scratch: Float32Array, len: number, radius: number) {
  if (radius <= 0) return;
  const inv = 1 / (2 * radius + 1);
  let sum = line[0]! * radius;
  for (let i = 0; i <= radius; i++) sum += line[Math.min(i, len - 1)]!;
  for (let i = 0; i < len; i++) {
    scratch[i] = sum * inv;
    sum += line[Math.min(i + radius + 1, len - 1)]! - line[Math.max(i - radius, 0)]!;
  }
  line.set(scratch.subarray(0, len));
}

/**
 * Approximate Gaussian blur (three box passes per direction). Colour and alpha are blurred
 * independently, so semi-transparent edges can fringe slightly; fine for photographs.
 * Lines are held as floats across the three passes, so rounding happens once per direction.
 */
function gaussianBlur(data: Uint8ClampedArray, w: number, h: number, sigma: number) {
  const radii = boxSizes(sigma, 3).map((size) => (size - 1) / 2);
  const line = new Float32Array(Math.max(w, h));
  const scratch = new Float32Array(Math.max(w, h));

  const run = (len: number, count: number, start: (i: number) => number, stride: number) => {
    for (let n = 0; n < count; n++) {
      const base = start(n);
      for (let ch = 0; ch < 4; ch++) {
        for (let i = 0; i < len; i++) line[i] = data[base + i * stride + ch]!;
        for (const r of radii) boxPass(line, scratch, len, r);
        for (let i = 0; i < len; i++) data[base + i * stride + ch] = line[i]!;
      }
    }
  };

  run(w, h, (y) => y * w * 4, 4); // rows
  run(h, w, (x) => x * 4, w * 4); // columns
}

type PixelContext = {
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  putImageData(data: ImageData, x: number, y: number): void;
};

/** Applies the filter chain to everything already drawn on the context. */
export function applyFilterFallback(ctx: PixelContext, w: number, h: number, p: FilterParams) {
  const nothingToDo =
    p.brightness === 1 && p.contrast === 1 && p.saturate === 1 && p.blurPx <= BLUR_THRESHOLD;
  if (nothingToDo) return;
  const image = ctx.getImageData(0, 0, w, h);
  filterPixels(image.data, w, h, p);
  ctx.putImageData(image, 0, 0);
}
