/**
 * Copy the "look" of one photo and paste it onto another.
 *
 * The look is the part of an edit that means the same thing on any photo: every adjustment and
 * the tone curves. What stays with each photo, and is never copied or pasted: crop, rotation and
 * flip (they fit one photo's shape), healing strokes (they point at pixels of one photo) and local
 * areas (they are masks of one photo, and whether they should travel is still an open decision).
 *
 * Pure: no React and no DOM. The editor keeps the copied look in memory; saving it between visits
 * goes through the small storage helpers at the bottom, which never throw.
 */
import {
  DEFAULT_ADJUSTMENTS,
  type Adjustments,
  type CurvesState,
  type EditState,
} from "@/types/editor";
import { isIdentityCurve, normalizeCurves } from "@/engine/image/curves";
import { normalizeAdjustments } from "@/engine/storage/sessionSchema";

export type CopiedLook = {
  adjustments: Adjustments;
  curves: CurvesState;
};

const cloneCurves = (c: CurvesState): CurvesState => ({
  rgb: c.rgb.map((p) => ({ ...p })),
  luma: c.luma.map((p) => ({ ...p })),
});

/** Copies the look out of an edit. The result shares nothing with the edit it came from. */
export function copyLook(edit: Pick<EditState, "adjustments" | "curves">): CopiedLook {
  return { adjustments: { ...edit.adjustments }, curves: cloneCurves(edit.curves) };
}

/** The part of an edit that pasting a look replaces. Spread it into applyEdit. */
export function pasteLook(look: CopiedLook): Pick<EditState, "adjustments" | "curves"> {
  return copyLook(look);
}

/** How many adjustments are away from their untouched value. */
export function changedAdjustmentCount(look: Pick<CopiedLook, "adjustments">): number {
  return (Object.keys(DEFAULT_ADJUSTMENTS) as (keyof Adjustments)[]).filter(
    (k) => look.adjustments[k] !== DEFAULT_ADJUSTMENTS[k],
  ).length;
}

export function hasCurves(look: Pick<CopiedLook, "curves">): boolean {
  return !isIdentityCurve(look.curves.rgb) || !isIdentityCurve(look.curves.luma);
}

/** True when there is nothing to copy: no adjustment moved and both curves are straight. */
export function isPlainLook(look: CopiedLook): boolean {
  return changedAdjustmentCount(look) === 0 && !hasCurves(look);
}

/** Whether two looks are the same, so a paste that changes nothing can be skipped. */
export function sameLook(a: CopiedLook, b: CopiedLook): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A plain-language summary: "5 adjustments and curves", "curves", "no changes". */
export function describeLook(look: CopiedLook): string {
  const n = changedAdjustmentCount(look);
  const parts: string[] = [];
  if (n > 0) parts.push(`${n} ${n === 1 ? "adjustment" : "adjustments"}`);
  if (hasCurves(look)) parts.push("curves");
  return parts.length > 0 ? parts.join(" and ") : "no changes";
}

/**
 * Turns whatever was read back from storage into a look, or null when it isn't one. Missing or
 * invalid values fall back to untouched and are clamped to their slider range, exactly as a saved
 * session's are, so a clipboard from an older build or a damaged one can't put NaN into an edit.
 */
export function normalizeLook(raw: unknown): CopiedLook | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  return {
    adjustments: normalizeAdjustments(rec["adjustments"]),
    curves: normalizeCurves(rec["curves"]),
  };
}

// --- Remembering the copied look between visits ----------------------------------------------

export const LOOK_STORAGE_KEY = "pictoe.copiedLook";

type LookStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): LookStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // some browsers throw just for touching storage (blocked cookies, private mode)
  }
}

/** The saved look, or null when there is none, it can't be read, or it isn't a look. */
export function loadLook(storage: LookStorage | null = defaultStorage()): CopiedLook | null {
  try {
    const text = storage?.getItem(LOOK_STORAGE_KEY);
    return text ? normalizeLook(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Saves the look. Failing to save is never worth interrupting an edit for. */
export function saveLook(look: CopiedLook, storage: LookStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(LOOK_STORAGE_KEY, JSON.stringify(look));
  } catch {
    // ignore: the look still works for this visit
  }
}
