import { describe, expect, it, vi } from "vitest";
import { canEncode, resolveExportOutcome } from "./exportFormat";

const blobOf = (type: string) => ({ type });

describe("resolveExportOutcome", () => {
  it("uses the requested extension when the browser produced that format", () => {
    expect(resolveExportOutcome("image/jpeg", blobOf("image/jpeg"))).toMatchObject({
      extension: "jpg",
      fellBack: false,
      message: null,
    });
    expect(resolveExportOutcome("image/webp", blobOf("image/webp")).extension).toBe("webp");
    expect(resolveExportOutcome("image/png", blobOf("image/png")).extension).toBe("png");
  });

  it("names a Safari WebP request after the PNG it really got, and says so", () => {
    const outcome = resolveExportOutcome("image/webp", blobOf("image/png"));
    expect(outcome.extension).toBe("png");
    expect(outcome.type).toBe("image/png");
    expect(outcome.fellBack).toBe(true);
    expect(outcome.message).toContain("WebP");
    expect(outcome.message).toContain("PNG");
  });

  it("reports any other mismatch the same way", () => {
    const outcome = resolveExportOutcome("image/jpeg", blobOf("image/png"));
    expect(outcome).toMatchObject({ extension: "png", fellBack: true });
    expect(outcome.message).toContain("JPG");
  });

  it("trusts the request when the blob's type is empty or unfamiliar", () => {
    expect(resolveExportOutcome("image/webp", blobOf(""))).toMatchObject({
      extension: "webp",
      fellBack: false,
    });
    expect(resolveExportOutcome("image/jpeg", blobOf("application/octet-stream")).extension).toBe(
      "jpg",
    );
  });
});

describe("canEncode", () => {
  const canvasProducing = (type: string | null) => () => ({
    width: 0,
    height: 0,
    toBlob: (cb: BlobCallback) => cb(type === null ? null : (blobOf(type) as Blob)),
  });

  it("is always true for PNG without probing", async () => {
    const make = vi.fn(canvasProducing("image/png"));
    expect(await canEncode("image/png", make)).toBe(true);
    expect(make).not.toHaveBeenCalled();
  });

  it("is true when the canvas really produces the format", async () => {
    expect(await canEncode("image/webp", canvasProducing("image/webp"))).toBe(true);
  });

  it("is false when the canvas silently returns a PNG, as Safari does for WebP", async () => {
    expect(await canEncode("image/webp", canvasProducing("image/png"))).toBe(false);
  });

  it("is false when nothing comes back", async () => {
    expect(await canEncode("image/webp", canvasProducing(null))).toBe(false);
  });

  it("does not block the user if the probe itself fails", async () => {
    const broken = () => {
      throw new Error("no canvas");
    };
    expect(await canEncode("image/webp", broken)).toBe(true);
  });
});
