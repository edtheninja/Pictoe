import { describe, expect, it } from "vitest";
import { MIN_SIZE, describeCrop, isArrowKey, moveCrop, nudgeCrop, resizeCrop } from "./cropMath";

const full = { x: 0, y: 0, width: 1, height: 1 };
const box = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };

describe("moveCrop", () => {
  it("slides the crop", () => {
    const m = moveCrop(box, 0.1, -0.1);
    expect(m.x).toBeCloseTo(0.3);
    expect(m.y).toBeCloseTo(0.2);
    expect(m).toMatchObject({ width: 0.5, height: 0.4 });
  });

  it("keeps it inside the frame on every side", () => {
    expect(moveCrop(box, -5, -5)).toMatchObject({ x: 0, y: 0 });
    const far = moveCrop(box, 5, 5);
    expect(far.x + far.width).toBeCloseTo(1);
    expect(far.y + far.height).toBeCloseTo(1);
  });
});

describe("resizeCrop", () => {
  it("moves only the edges the handle names", () => {
    const e = resizeCrop(box, "e", 0.1, 0.5);
    expect(e).toMatchObject({ x: 0.2, y: 0.3 });
    expect(e.height).toBeCloseTo(0.4);
    expect(e.width).toBeCloseTo(0.6);
    const nw = resizeCrop(box, "nw", 0.1, 0.1);
    expect(nw.x).toBeCloseTo(0.3);
    expect(nw.y).toBeCloseTo(0.4);
    expect(nw.x + nw.width).toBeCloseTo(0.7); // the far edges stay put
    expect(nw.y + nw.height).toBeCloseTo(0.7);
  });

  it("never goes past the frame", () => {
    const grown = resizeCrop(box, "se", 5, 5);
    expect(grown.x + grown.width).toBeCloseTo(1);
    expect(grown.y + grown.height).toBeCloseTo(1);
  });

  it("never gets smaller than the minimum, from either side", () => {
    const fromRight = resizeCrop(box, "e", -5, 0);
    expect(fromRight.width).toBeCloseTo(MIN_SIZE);
    expect(fromRight.x).toBeCloseTo(0.2);
    const fromLeft = resizeCrop(box, "w", 5, 0);
    expect(fromLeft.width).toBeCloseTo(MIN_SIZE);
    expect(fromLeft.x + fromLeft.width).toBeCloseTo(0.7); // the right edge stays put
    expect(resizeCrop(box, "n", 0, 5).height).toBeCloseTo(MIN_SIZE);
  });
});

describe("keyboard nudging", () => {
  it("moves by 1% per press, or 5% with Shift", () => {
    expect(nudgeCrop(box, "ArrowRight").x).toBeCloseTo(0.21);
    expect(nudgeCrop(box, "ArrowLeft").x).toBeCloseTo(0.19);
    expect(nudgeCrop(box, "ArrowDown").y).toBeCloseTo(0.31);
    expect(nudgeCrop(box, "ArrowUp", { big: true }).y).toBeCloseTo(0.25);
  });

  it("resizes from the right and bottom edges with the resize modifier", () => {
    const wider = nudgeCrop(box, "ArrowRight", { resize: true });
    expect(wider.width).toBeCloseTo(0.51);
    expect(wider.x).toBeCloseTo(0.2); // the top-left corner doesn't move
    expect(nudgeCrop(box, "ArrowLeft", { resize: true }).width).toBeCloseTo(0.49);
    expect(nudgeCrop(box, "ArrowDown", { resize: true, big: true }).height).toBeCloseTo(0.45);
    expect(nudgeCrop(box, "ArrowUp", { resize: true }).height).toBeCloseTo(0.39);
  });

  it("can't push the full-frame crop out of the frame", () => {
    expect(nudgeCrop(full, "ArrowRight")).toEqual(full);
    expect(nudgeCrop(full, "ArrowDown", { resize: true })).toEqual(full);
    expect(nudgeCrop(full, "ArrowLeft", { resize: true }).width).toBeCloseTo(0.99);
  });

  it("recognises only the four arrow keys", () => {
    expect(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].every(isArrowKey)).toBe(true);
    expect(["a", "Enter", "Tab", "Home"].some(isArrowKey)).toBe(false);
  });
});

describe("describeCrop", () => {
  it("reads out size and position in plain words", () => {
    expect(describeCrop(box)).toBe("Crop 50% wide, 40% tall, 20% from the left, 30% from the top.");
    expect(describeCrop(full)).toBe(
      "Crop 100% wide, 100% tall, 0% from the left, 0% from the top.",
    );
  });
});
