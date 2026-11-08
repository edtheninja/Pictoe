import {
  ADJUSTMENT_DEFS,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP,
  DEFAULT_EDIT_STATE,
  DEFAULT_LOCAL_ADJUSTMENTS,
  type Adjustments,
  type CropRect,
  type EditState,
  type HealStroke,
  type LocalAdjustments,
  type MaskLayer,
  type MaskStroke,
} from "@/types/editor";
import { normalizeCurves } from "@/engine/image/curves";

/**
 * Turns whatever came out of IndexedDB into a session the editor can safely use.
 *
 * Saved sessions outlive the code that wrote them. A save from an older build can lack fields the
 * current build expects (new adjustments, clone strokes), and a damaged or hand-edited save can hold
 * anything. The editor's maths assume every adjustment is a finite number, so a missing key or a
 * stray string would otherwise show up later as NaN pixels rather than as a clear failure here.
 *
 * Rules:
 * - Missing or invalid values fall back to their defaults; valid values are kept as they are
 *   (clamped to their slider range).
 * - Keys this build doesn't know are dropped, and a stroke or layer that can't be repaired is
 *   dropped rather than guessed at.
 * - Normalising twice gives the same result as normalising once.
 *
 * Bump SESSION_SCHEMA_VERSION when the saved shape changes in a way old data needs help with, and
 * add the step here, with a fixture of the previous format in sessionSchema.test.ts.
 *
 * Versions: 0 = saves from before this field existed (the mask-space flag was the only marker),
 * 1 = adds `schemaVersion`. A save from a NEWER build is restored as far as this build understands
 * it; fields this build doesn't know are lost the next time autosave overwrites it.
 */
export const SESSION_SCHEMA_VERSION = 1;

export type NormalizedSession = {
  edit: EditState;
  maskLayers: MaskLayer[];
  /**
   * "source": mask strokes are relative to the source image (current). "frame": they are relative
   * to the visible frame at the time (oldest saves) and still need migrateLegacyLayers.
   */
  maskSpace: "source" | "frame";
  fromNewerVersion: boolean;
};

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const num = (v: unknown, fallback: number, min: number, max: number) =>
  isFiniteNumber(v) ? clamp(v, min, max) : fallback;

const ADJUSTMENT_RANGE = new Map(ADJUSTMENT_DEFS.map((d) => [d.key, d] as const));

export function normalizeAdjustments(raw: unknown): Adjustments {
  const source = isRecord(raw) ? raw : {};
  const out = { ...DEFAULT_ADJUSTMENTS };
  for (const key of Object.keys(DEFAULT_ADJUSTMENTS) as (keyof Adjustments)[]) {
    const range = ADJUSTMENT_RANGE.get(key);
    out[key] = num(source[key], DEFAULT_ADJUSTMENTS[key], range?.min ?? -100, range?.max ?? 100);
  }
  return out;
}

export function normalizeCrop(raw: unknown): CropRect {
  if (!isRecord(raw)) return { ...DEFAULT_CROP };
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(isFiniteNumber)) return { ...DEFAULT_CROP };
  const w = clamp(width as number, 0.01, 1);
  const h = clamp(height as number, 0.01, 1);
  return {
    x: clamp(x as number, 0, 1 - w),
    y: clamp(y as number, 0, 1 - h),
    width: w,
    height: h,
  };
}

function normalizeRotation(raw: unknown): number {
  if (!isFiniteNumber(raw)) return 0;
  return (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
}

function normalizeHealStrokes(raw: unknown): HealStroke[] {
  if (!Array.isArray(raw)) return [];
  const out: HealStroke[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { x, y, dx, dy, radius } = item;
    if (![x, y, dx, dy, radius].every(isFiniteNumber) || (radius as number) <= 0) continue;
    out.push({
      x: x as number,
      y: y as number,
      dx: dx as number,
      dy: dy as number,
      radius: Math.min(radius as number, 2),
      softness: num(item["softness"], 30, 0, 100),
    });
  }
  return out;
}

function normalizeMaskStrokes(raw: unknown): MaskStroke[] {
  if (!Array.isArray(raw)) return [];
  const out: MaskStroke[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { x, y, radius } = item;
    if (![x, y, radius].every(isFiniteNumber) || (radius as number) <= 0) continue;
    const stroke: MaskStroke = {
      x: x as number,
      y: y as number,
      radius: Math.min(radius as number, 2),
    };
    if (isFiniteNumber(item["softness"])) stroke.softness = clamp(item["softness"], 0, 100);
    if (item["mode"] === "paint" || item["mode"] === "erase") stroke.mode = item["mode"];
    out.push(stroke);
  }
  return out;
}

function normalizeLocalAdjustments(raw: unknown): LocalAdjustments {
  const source = isRecord(raw) ? raw : {};
  const out = { ...DEFAULT_LOCAL_ADJUSTMENTS };
  for (const key of Object.keys(DEFAULT_LOCAL_ADJUSTMENTS) as (keyof LocalAdjustments)[]) {
    out[key] = num(source[key], DEFAULT_LOCAL_ADJUSTMENTS[key], -100, 100);
  }
  return out;
}

export function normalizeMaskLayers(raw: unknown, makeId: () => string): MaskLayer[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MaskLayer[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    let id = typeof item["id"] === "string" && item["id"] !== "" ? item["id"] : makeId();
    while (seen.has(id)) id = makeId();
    seen.add(id);
    out.push({
      id,
      name:
        typeof item["name"] === "string" && item["name"] !== ""
          ? item["name"]
          : `Area ${out.length + 1}`,
      strokes: normalizeMaskStrokes(item["strokes"]),
      adjustments: normalizeLocalAdjustments(item["adjustments"]),
    });
  }
  return out;
}

export function normalizeEdit(raw: unknown): EditState {
  const source = isRecord(raw) ? raw : {};
  return {
    adjustments: normalizeAdjustments(source["adjustments"]),
    crop: normalizeCrop(source["crop"]),
    rotation: normalizeRotation(source["rotation"]),
    flipH: source["flipH"] === true,
    healStrokes: normalizeHealStrokes(source["healStrokes"]),
    curves: normalizeCurves(source["curves"]),
  };
}

/** Returns null only when `raw` isn't a saved-session object at all. */
export function normalizeSession(
  raw: unknown,
  makeId: () => string = () => crypto.randomUUID(),
): NormalizedSession | null {
  if (!isRecord(raw)) return null;
  const version = isFiniteNumber(raw["schemaVersion"]) ? raw["schemaVersion"] : 0;
  return {
    edit: isRecord(raw["edit"]) ? normalizeEdit(raw["edit"]) : normalizeEdit(DEFAULT_EDIT_STATE),
    maskLayers: normalizeMaskLayers(raw["maskLayers"], makeId),
    maskSpace: version >= 1 || raw["maskSpace"] === "source" ? "source" : "frame",
    fromNewerVersion: version > SESSION_SCHEMA_VERSION,
  };
}
