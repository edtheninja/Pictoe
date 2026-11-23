/**
 * Whether a keyboard event's target is somewhere the user is typing text, so the editor's single
 * key shortcuts (undo, zoom, "\" for the original) must leave the key alone.
 *
 * Only fields that take text count. A range slider, radio button, checkbox or button is an
 * `<input>` too, but nothing is typed into it: after nudging a slider with the arrow keys,
 * Ctrl/Cmd+Z has to undo the edit and not be swallowed. Written against a plain shape, not the
 * DOM's classes, so it can be tested without a browser.
 */
export type KeyTarget = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
} | null;

/** `<input>` types where the user does not type text. Anything else (including an unknown type, which a browser treats as text) counts as typing. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isTextEntry(target: KeyTarget | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  return false;
}
