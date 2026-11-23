import { describe, expect, it } from "vitest";
import { photoBlob, withBytes } from "./sessionBlob";

const bytesOf = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));
const photo = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });

describe("withBytes", () => {
  it("replaces the Blob with its exact bytes and keeps every other field", async () => {
    const session = { imageBlob: photo(), name: "a.png", type: "image/png", edit: { x: 1 } };
    const out = await withBytes(session);
    expect("imageBlob" in out).toBe(false);
    expect(Array.from(new Uint8Array(out.imageBytes))).toEqual([137, 80, 78, 71, 1, 2, 3]);
    expect(out.name).toBe("a.png");
    expect(out.type).toBe("image/png");
    expect(out.edit).toBe(session.edit);
  });

  it("does not change the session it was given", async () => {
    const session = { imageBlob: photo(), name: "a.png", type: "image/png" };
    await withBytes(session);
    expect(session.imageBlob).toBeInstanceOf(Blob);
    expect("imageBytes" in session).toBe(false);
  });
});

describe("photoBlob", () => {
  it("returns the Blob as it is when the photo was stored as a Blob", () => {
    const blob = photo();
    expect(photoBlob({ imageBlob: blob, type: "image/png" })).toBe(blob);
  });

  it("rebuilds a Blob of the right type and bytes from stored bytes", async () => {
    const stored = await withBytes({ imageBlob: photo(), type: "image/png" });
    const blob = photoBlob(stored)!;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(await bytesOf(blob)).toEqual([137, 80, 78, 71, 1, 2, 3]);
  });

  it("accepts a typed array as well as an ArrayBuffer (what some stores hand back)", async () => {
    const blob = photoBlob({ imageBytes: new Uint8Array([9, 8, 7]), type: "image/jpeg" })!;
    expect(blob.type).toBe("image/jpeg");
    expect(await bytesOf(blob)).toEqual([9, 8, 7]);
  });

  it("prefers the Blob when a record somehow has both", () => {
    const blob = photo();
    expect(photoBlob({ imageBlob: blob, imageBytes: new ArrayBuffer(4), type: "image/png" })).toBe(
      blob,
    );
  });

  it("returns null for a damaged record with neither", () => {
    expect(photoBlob({ type: "image/png" })).toBeNull();
    expect(photoBlob({ imageBlob: "not a blob", imageBytes: 42, type: "image/png" })).toBeNull();
    expect(photoBlob({ imageBlob: null, imageBytes: undefined, type: "image/png" })).toBeNull();
  });
});
