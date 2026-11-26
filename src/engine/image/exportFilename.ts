/**
 * Turns a filename template like "{name}-{size}" into a safe file name for an export.
 *
 * Kept free of React and the DOM so it can be tested on its own. The extension is never part
 * of the template: it always comes from what the browser really produced (see exportFormat.ts),
 * so a file's name and its contents can't disagree.
 */

export const DEFAULT_TEMPLATE = "{name}-pictoe";

export const TEMPLATE_TOKENS = [
  "name",
  "date",
  "time",
  "width",
  "height",
  "size",
  "format",
] as const;

export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

export type FilenameContext = {
  /** The original file's name, with or without its extension. */
  originalName: string;
  /** The size of the file that was actually written, not the size that was asked for. */
  width: number;
  height: number;
  /** The extension the saved file really has ("jpg", "png", "webp"), without the dot. */
  extension: string;
  now?: Date;
};

/** Long enough for any real name, short enough to stay under every file system's limit. */
export const MAX_BASE_LENGTH = 120;
export const FALLBACK_BASE = "pictoe-export";

const KNOWN_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
// Windows refuses these as a file name, with or without an extension ("con.txt" too).
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Not `k in values`: that would also match inherited names like "constructor".
const isToken = (k: string): k is TemplateToken =>
  (TEMPLATE_TOKENS as readonly string[]).includes(k);

const pad = (n: number) => String(n).padStart(2, "0");

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

function withoutControlChars(text: string): string {
  return Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/** Makes any text safe to use as the base of a file name on Windows, macOS, Linux and Android. */
export function sanitizeBase(raw: string): string {
  let s = withoutControlChars(raw)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  // Count whole characters, so a long name never gets cut through the middle of an emoji.
  const chars = Array.from(s);
  if (chars.length > MAX_BASE_LENGTH) {
    s = chars
      .slice(0, MAX_BASE_LENGTH)
      .join("")
      .replace(/[\s.]+$/g, "");
  }
  if (!s) return FALLBACK_BASE;
  const [first = "", ...rest] = s.split(".");
  if (RESERVED.test(first)) return [`${first}_`, ...rest].join(".");
  return s;
}

/** Tokens in the template that Pictoe doesn't know, so the panel can say so instead of guessing. */
export function findUnknownTokens(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const key = match[1]!.trim().toLowerCase();
    if (!isToken(key)) unknown.add(match[0]);
  }
  return [...unknown];
}

/** The full file name, extension included. Total: any template gives a usable name. */
export function buildFilename(template: string, ctx: FilenameContext): string {
  const d = ctx.now ?? new Date();
  const values: Record<TemplateToken, string> = {
    name: stripExtension(ctx.originalName) || "image",
    // Local time, year first, so files sort in the order they were saved.
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    width: String(ctx.width),
    height: String(ctx.height),
    size: `${ctx.width}x${ctx.height}`,
    format: ctx.extension,
  };

  // An extension typed into the template is dropped: the real one is added below.
  const source = (template.trim() || DEFAULT_TEMPLATE).replace(KNOWN_EXTENSIONS, "");
  // One pass, so a token's value is never itself read as a token. Unknown tokens stay as typed.
  const base = source.replace(/\{([^{}]*)\}/g, (whole, key: string) => {
    const k = key.trim().toLowerCase();
    return isToken(k) ? values[k] : whole;
  });

  // Anything left empty or unusable (say, a template that was only an extension) gets a fallback.
  return `${sanitizeBase(base)}.${ctx.extension}`;
}

// --- Remembering the template between visits -------------------------------------------------

export const TEMPLATE_STORAGE_KEY = "pictoe.exportTemplate";

type TemplateStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): TemplateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // some browsers throw just for touching storage (blocked cookies, private mode)
  }
}

/** The saved template, or the default when there is none or storage can't be read. */
export function loadTemplate(storage: TemplateStorage | null = defaultStorage()): string {
  try {
    const saved = storage?.getItem(TEMPLATE_STORAGE_KEY);
    return saved && saved.trim() ? saved : DEFAULT_TEMPLATE;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

/** Saves the template. Failing to save is never worth interrupting an export for. */
export function saveTemplate(
  template: string,
  storage: TemplateStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(TEMPLATE_STORAGE_KEY, template);
  } catch {
    // ignore: the template still works for this visit
  }
}
