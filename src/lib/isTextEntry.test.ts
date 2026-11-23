import { describe, expect, it } from "vitest";
import { isTextEntry } from "./isTextEntry";

const input = (type?: string) => ({ tagName: "INPUT", ...(type === undefined ? {} : { type }) });

describe("isTextEntry", () => {
  it("is true where the user types text", () => {
    for (const type of ["text", "search", "email", "url", "tel", "password", "number", "date"]) {
      expect(isTextEntry(input(type))).toBe(true);
    }
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("counts an input with no type, or a type a browser would treat as text, as typing", () => {
    expect(isTextEntry(input())).toBe(true);
    expect(isTextEntry(input("something-new"))).toBe(true);
  });

  it("is false for inputs nothing is typed into, so undo still works after nudging a slider", () => {
    for (const type of [
      "range",
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "file",
      "color",
      "image",
    ]) {
      expect(isTextEntry(input(type))).toBe(false);
    }
  });

  it("is false for everything else, and for nothing at all", () => {
    for (const tagName of ["BUTTON", "DIV", "CANVAS", "BODY", "SELECT", "A"]) {
      expect(isTextEntry({ tagName })).toBe(false);
    }
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
    expect(isTextEntry({})).toBe(false);
  });

  it("ignores the case of the tag and the type", () => {
    expect(isTextEntry({ tagName: "input", type: "TEXT" })).toBe(true);
    expect(isTextEntry({ tagName: "input", type: "Range" })).toBe(false);
    expect(isTextEntry({ tagName: "textarea" })).toBe(true);
  });

  it("is not fooled by contentEditable being merely false", () => {
    expect(isTextEntry({ tagName: "DIV", isContentEditable: false })).toBe(false);
  });
});
