/**
 * A recording fake canvas for tests that run the real renderImage and look at which canvas work
 * it asks for (not at pixels). Every method call and property assignment on a 2D context is
 * logged. `getImageData` returns zeroed pixels of the size asked for, except that the one-pixel
 * read the app uses to probe `ctx.filter` support is answered "supported" (so filters are set
 * as strings, not applied pixel by pixel).
 */
export type Call = { name: string; args: unknown[] };

export type FakeCanvas = {
  width: number;
  height: number;
  calls: Call[];
  getContext: () => unknown;
};

export function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, prop: string) =>
      (...args: unknown[]) => {
        calls.push({ name: prop, args });
        if (prop === "createRadialGradient" || prop === "createLinearGradient") {
          return { addColorStop() {} };
        }
        if (prop === "getImageData") {
          const w = Number(args[2]);
          const h = Number(args[3]);
          const data = new Uint8ClampedArray(w * h * 4);
          if (w === 1 && h === 1) data[0] = 255;
          return { width: w, height: h, data };
        }
        return undefined;
      },
    set: (_t, prop: string, value: unknown) => {
      calls.push({ name: `set:${prop}`, args: [value] });
      return true;
    },
  });
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

/** What a stubbed `document.createElement("canvas")` has made so far (clear with length = 0). */
export type FakeDocument = { canvases: FakeCanvas[] };

export function createFakeDocument(): { document: unknown; made: FakeDocument } {
  const made: FakeDocument = { canvases: [] };
  const document = {
    createElement: () => {
      const c = fakeCanvas();
      made.canvases.push(c);
      return c;
    },
  };
  return { document, made };
}
