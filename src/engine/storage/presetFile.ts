/**
 * Saving the user's presets to a JSON file, and reading one back in.
 *
 * A file is the one place presets arrive from outside, so nothing in it is trusted: it may be
 * from an older or newer Pictoe, hand-edited, damaged, or not a preset file at all. Rules:
 * - Only values that differ from "untouched" are written, so a file stays small and still means
 *   the same thing when a later Pictoe adds adjustments.
 * - Reading repairs rather than rejects: unknown adjustments are dropped, values are clamped to
 *   their slider range, names are cleaned. A preset that can't be repaired is skipped and counted.
 * - A file's ids are never used. Every imported preset gets a new id, so an import can't overwrite
 *   a preset you already have.
 * - Importing a file you already imported adds nothing: a preset identical to one you have is
 *   skipped. One with the same name but different values is kept, under a free name.
 *
 * Pure: no React, no DOM. presets.ts does the saving; the panel does the file picking.
 */
import { DEFAULT_ADJUSTMENTS, type Adjustments, type AdjustmentKey } from "@/types/editor";
import { normalizeAdjustments } from "@/engine/storage/sessionSchema";
import type { StoredPreset } from "@/engine/storage/presets";

export const PRESET_FILE_FORMAT = "pictoe-presets";
export const PRESET_FILE_VERSION = 1;

/** Generous for anyone's real collection; stops a huge or hostile file from being worked through. */
export const MAX_PRESET_FILE_BYTES = 1_000_000;
export const MAX_PRESETS_PER_FILE = 200;
export const MAX_PRESET_NAME_LENGTH = 60;
export const FALLBACK_PRESET_NAME = "Imported preset";

const KEYS = Object.keys(DEFAULT_ADJUSTMENTS) as AdjustmentKey[];

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** The adjustments that differ from untouched: what a preset really does. */
function changedOnly(adjustments: Partial<Adjustments>): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};
  for (const key of KEYS) {
    const value = adjustments[key];
    if (typeof value === "number" && Number.isFinite(value) && value !== DEFAULT_ADJUSTMENTS[key]) {
      out[key] = value;
    }
  }
  return out;
}

/** The text of a preset file for these presets. */
export function serializePresets(presets: readonly Pick<StoredPreset, "name" | "adjustments">[]) {
  return JSON.stringify(
    {
      format: PRESET_FILE_FORMAT,
      version: PRESET_FILE_VERSION,
      presets: presets.map((p) => ({ name: p.name, adjustments: changedOnly(p.adjustments) })),
    },
    null,
    2,
  );
}

/** "pictoe-presets-2026-11-26.json": local date, year first, so files sort in order. */
export function presetFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `pictoe-presets-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** A name safe to show and to keep: no control characters, single spaces, a sensible length. */
export function cleanPresetName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_PRESET_NAME;
  const text = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const cut = Array.from(text).slice(0, MAX_PRESET_NAME_LENGTH).join("").trim();
  return cut || FALLBACK_PRESET_NAME;
}

export type PresetDraft = { name: string; adjustments: Adjustments };

export type ParsedPresetFile =
  | {
      ok: true;
      presets: PresetDraft[];
      /** Entries that could not be turned into a preset at all (not an object, or past the limit). */
      skipped: number;
      /** The file says it was written by a newer Pictoe, so some of it may not be understood. */
      fromNewerVersion: boolean;
    }
  | { ok: false; reason: "too-big" | "not-json" | "not-a-preset-file" | "empty" };

/** Reads the text of a preset file. Total: whatever it is given, the answer is one of the above. */
export function parsePresetFile(text: string): ParsedPresetFile {
  if (typeof text !== "string" || text.length > MAX_PRESET_FILE_BYTES) {
    return { ok: false, reason: "too-big" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!isRecord(raw) || raw["format"] !== PRESET_FILE_FORMAT || !Array.isArray(raw["presets"])) {
    return { ok: false, reason: "not-a-preset-file" };
  }
  const version = typeof raw["version"] === "number" ? raw["version"] : 1;
  const entries = raw["presets"] as unknown[];
  if (entries.length === 0) return { ok: false, reason: "empty" };

  const presets: PresetDraft[] = [];
  let skipped = Math.max(0, entries.length - MAX_PRESETS_PER_FILE);
  for (const entry of entries.slice(0, MAX_PRESETS_PER_FILE)) {
    if (!isRecord(entry) || !isRecord(entry["adjustments"])) {
      skipped++;
      continue;
    }
    presets.push({
      name: cleanPresetName(entry["name"]),
      adjustments: normalizeAdjustments(entry["adjustments"]),
    });
  }
  return { ok: true, presets, skipped, fromNewerVersion: version > PRESET_FILE_VERSION };
}

const sameAdjustments = (a: Adjustments, b: Adjustments) => KEYS.every((k) => a[k] === b[k]);

/** The first of "Name", "Name 2", "Name 3" … that is not in `taken` (compared ignoring case). */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  const lower = (s: string) => s.toLowerCase();
  if (!taken.has(lower(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const base = Array.from(name)
      .slice(0, MAX_PRESET_NAME_LENGTH - suffix.length)
      .join("")
      .trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(lower(candidate))) return candidate;
  }
}

export type ImportPlan = {
  toAdd: StoredPreset[];
  /** Presets identical to one already saved (or earlier in the same file), left out. */
  duplicates: number;
  /** Presets kept under a different name because theirs was taken by a different preset. */
  renamed: number;
};

/** Decides what to save from a read file, given the presets already saved. */
export function planImport(
  existing: readonly StoredPreset[],
  drafts: readonly PresetDraft[],
  makeId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  const known: { name: string; adjustments: Adjustments }[] = existing.map((p) => ({
    name: p.name,
    adjustments: normalizeAdjustments(p.adjustments),
  }));
  const taken = new Set(known.map((p) => p.name.toLowerCase()));
  const toAdd: StoredPreset[] = [];
  let duplicates = 0;
  let renamed = 0;

  for (const draft of drafts) {
    const identical = known.some(
      (p) =>
        p.name.toLowerCase() === draft.name.toLowerCase() &&
        sameAdjustments(p.adjustments, draft.adjustments),
    );
    if (identical) {
      duplicates++;
      continue;
    }
    const name = freeName(draft.name, taken);
    if (name !== draft.name) renamed++;
    taken.add(name.toLowerCase());
    known.push({ name, adjustments: draft.adjustments });
    toAdd.push({ id: makeId(), name, adjustments: changedOnly(draft.adjustments) });
  }
  return { toAdd, duplicates, renamed };
}

/** A plain-language account of an import, for the panel. */
export function describeImport(
  plan: ImportPlan,
  skipped: number,
  fromNewerVersion: boolean,
): string {
  const n = plan.toAdd.length;
  const parts = [n === 0 ? "No new presets." : `Added ${n} ${n === 1 ? "preset" : "presets"}.`];
  if (plan.renamed > 0) {
    parts.push(`${plan.renamed} got a new name because yours was taken.`);
  }
  if (plan.duplicates > 0) {
    parts.push(`${plan.duplicates} you already had.`);
  }
  if (skipped > 0) {
    parts.push(`${skipped} couldn't be read and ${skipped === 1 ? "was" : "were"} skipped.`);
  }
  if (fromNewerVersion)
    parts.push("This file is from a newer Pictoe, so some of it may be missing.");
  return parts.join(" ");
}

export function describeParseFailure(reason: Extract<ParsedPresetFile, { ok: false }>["reason"]) {
  switch (reason) {
    case "too-big":
      return "That file is too big to be a preset file.";
    case "not-json":
    case "not-a-preset-file":
      return "That isn't a Pictoe preset file.";
    case "empty":
      return "That file has no presets in it.";
  }
}
