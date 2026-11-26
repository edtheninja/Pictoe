import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE,
  FALLBACK_BASE,
  MAX_BASE_LENGTH,
  TEMPLATE_STORAGE_KEY,
  buildFilename,
  findUnknownTokens,
  loadTemplate,
  sanitizeBase,
  saveTemplate,
  type FilenameContext,
} from "./exportFilename";

const ctx = (over: Partial<FilenameContext> = {}): FilenameContext => ({
  originalName: "IMG_0042.JPG",
  width: 4000,
  height: 3000,
  extension: "jpg",
  now: new Date(2026, 10, 5, 9, 7, 3), // 5 Nov 2026, 09:07:03 local
  ...over,
});

describe("buildFilename", () => {
  it("names a file after the original by default", () => {
    expect(buildFilename(DEFAULT_TEMPLATE, ctx())).toBe("IMG_0042-pictoe.jpg");
  });

  it("fills every token", () => {
    expect(buildFilename("{name}_{size}_{width}w_{height}h", ctx())).toBe(
      "IMG_0042_4000x3000_4000w_3000h.jpg",
    );
    expect(buildFilename("{date}_{time}", ctx())).toBe("2026-11-05_090703.jpg");
    expect(buildFilename("{name}-{format}", ctx())).toBe("IMG_0042-jpg.jpg");
  });

  it("is not case-sensitive about tokens", () => {
    expect(buildFilename("{NAME}-{Size}", ctx())).toBe("IMG_0042-4000x3000.jpg");
  });

  it("reports the size that was really written", () => {
    expect(buildFilename("{size}", ctx({ width: 2048, height: 1536 }))).toBe("2048x1536.jpg");
  });

  it("takes the extension from the file, never the template", () => {
    expect(buildFilename("a.png", ctx({ extension: "jpg" }))).toBe("a.jpg");
    expect(buildFilename("a.JPEG", ctx({ extension: "png" }))).toBe("a.png");
    expect(buildFilename("{name}", ctx({ extension: "webp" }))).toBe("IMG_0042.webp");
  });

  it("keeps dots inside the original name", () => {
    expect(buildFilename("{name}", ctx({ originalName: "my.holiday.photo.png" }))).toBe(
      "my.holiday.photo.jpg",
    );
  });

  it("falls back to the default for an empty template", () => {
    expect(buildFilename("", ctx({ originalName: "x.png" }))).toBe("x-pictoe.jpg");
    expect(buildFilename("   ", ctx({ originalName: "x.png" }))).toBe("x-pictoe.jpg");
  });

  it("falls back when only an extension was typed", () => {
    expect(buildFilename(".png", ctx())).toBe(`${FALLBACK_BASE}.jpg`);
  });

  it("uses 'image' when the original has no usable name", () => {
    expect(buildFilename("{name}", ctx({ originalName: ".jpg" }))).toBe("image.jpg");
  });

  it("leaves unknown tokens as typed", () => {
    expect(buildFilename("{name}-{foo}", ctx())).toBe("IMG_0042-{foo}.jpg");
  });

  it("does not treat inherited object names as tokens", () => {
    expect(buildFilename("{constructor}", ctx())).toBe("{constructor}.jpg");
  });

  it("never reads a token's value as another token", () => {
    expect(buildFilename("{name}", ctx({ originalName: "{size}.png" }))).toBe("{size}.jpg");
  });

  it("makes unsafe characters safe", () => {
    expect(buildFilename("a/b:c", ctx())).toBe("a-b-c.jpg");
    expect(buildFilename("a\\b*c?d", ctx())).toBe("a-b-c-d.jpg");
  });
});

describe("sanitizeBase", () => {
  it("avoids names Windows refuses", () => {
    expect(sanitizeBase("con")).toBe("con_");
    expect(sanitizeBase("NUL")).toBe("NUL_");
    expect(sanitizeBase("lpt3.backup")).toBe("lpt3_.backup");
    expect(sanitizeBase("console")).toBe("console");
  });

  it("trims dots and spaces from the ends and collapses runs of spaces", () => {
    expect(sanitizeBase("  ..a   b..  ")).toBe("a b");
  });

  it("removes control characters", () => {
    expect(sanitizeBase("a\u0000b\nc")).toBe("abc");
  });

  it("falls back when nothing is left", () => {
    expect(sanitizeBase("")).toBe(FALLBACK_BASE);
    expect(sanitizeBase(" . . ")).toBe(FALLBACK_BASE);
  });

  it("limits the length without cutting an emoji in half", () => {
    const long = sanitizeBase("a".repeat(500));
    expect(long).toHaveLength(MAX_BASE_LENGTH);
    const emoji = sanitizeBase("😀".repeat(500));
    expect(Array.from(emoji)).toHaveLength(MAX_BASE_LENGTH);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe("findUnknownTokens", () => {
  it("lists only tokens Pictoe doesn't know, once each", () => {
    expect(findUnknownTokens("{name}-{foo}-{foo}-{bar}-{SIZE}")).toEqual(["{foo}", "{bar}"]);
  });
  it("is empty for a clean template", () => {
    expect(findUnknownTokens(DEFAULT_TEMPLATE)).toEqual([]);
    expect(findUnknownTokens("plain")).toEqual([]);
  });
});

describe("remembering the template", () => {
  const fake = (initial?: string) => {
    const data = new Map<string, string>();
    if (initial !== undefined) data.set(TEMPLATE_STORAGE_KEY, initial);
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("round-trips a saved template", () => {
    const s = fake();
    saveTemplate("{date}-{name}", s);
    expect(loadTemplate(s)).toBe("{date}-{name}");
  });

  it("uses the default when nothing, or only blanks, is saved", () => {
    expect(loadTemplate(fake())).toBe(DEFAULT_TEMPLATE);
    expect(loadTemplate(fake("   "))).toBe(DEFAULT_TEMPLATE);
  });

  it("copes with storage that is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadTemplate(broken)).toBe(DEFAULT_TEMPLATE);
    expect(() => saveTemplate("x", broken)).not.toThrow();
    expect(loadTemplate(null)).toBe(DEFAULT_TEMPLATE);
    expect(() => saveTemplate("x", null)).not.toThrow();
  });
});
