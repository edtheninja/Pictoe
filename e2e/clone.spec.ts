import { expect, test, type Page } from "@playwright/test";
import {
  BLEMISH,
  SOURCE,
  isGreen,
  openTestPhoto,
  pixelAt,
  redFraction,
  roughly,
  screenPoint,
} from "./helpers";

const HINT = "Tap a clean area to copy from";

/** Choose the green square as the source, then drag across the red blemish. */
async function paintOverBlemish(page: Page) {
  await page.getByRole("button", { name: "Clone" }).click();
  await expect(page.getByText(HINT)).toBeVisible();
  const src = await screenPoint(page, SOURCE);
  await page.mouse.click(src.x, src.y);
  await expect(page.getByText(HINT)).toHaveCount(0);
  const at = await screenPoint(page, BLEMISH);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let dx = -14; dx <= 14; dx += 4) await page.mouse.move(at.x + dx, at.y);
  await page.mouse.up();
}

test.describe("clone tool", () => {
  test("copies the source over the blemish", async ({ page }) => {
    await openTestPhoto(page);
    const before = await redFraction(page);
    await paintOverBlemish(page);
    await expect.poll(async () => isGreen(await pixelAt(page, BLEMISH))).toBe(true);
    expect(await redFraction(page)).toBeLessThan(before * 0.9);
  });

  test("a whole drag is one keyboard undo, and redo puts it back", async ({ page }) => {
    await openTestPhoto(page);
    const before = await redFraction(page);
    await paintOverBlemish(page);
    await expect.poll(async () => (await redFraction(page)) < before * 0.9).toBe(true);
    const painted = await redFraction(page);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => roughly(await redFraction(page), before)).toBe(true);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(async () => roughly(await redFraction(page), painted)).toBe(true);
  });

  test("strokes survive a reload", async ({ page }) => {
    await openTestPhoto(page);
    await paintOverBlemish(page);
    await expect.poll(async () => isGreen(await pixelAt(page, BLEMISH))).toBe(true);
    const painted = await redFraction(page);
    await page.waitForTimeout(1500); // the session autosaves after a short pause

    await page.reload();
    await expect(page.locator('canvas[aria-label*="image"]')).toBeVisible();
    await expect.poll(async () => roughly(await redFraction(page), painted)).toBe(true);
    expect(isGreen(await pixelAt(page, BLEMISH))).toBe(true);
  });

  test("the healed spot follows rotation and flip", async ({ page }) => {
    await openTestPhoto(page);
    await paintOverBlemish(page);
    await expect.poll(async () => isGreen(await pixelAt(page, BLEMISH))).toBe(true);
    const fraction = await redFraction(page);

    await page.getByRole("button", { name: "Crop" }).click();
    await page.getByRole("button", { name: "Rotate right" }).click();
    // 90° clockwise sends (x, y) to (1 − y, x).
    const rotated = { x: 1 - BLEMISH.y, y: BLEMISH.x };
    await expect.poll(async () => isGreen(await pixelAt(page, rotated))).toBe(true);
    expect(roughly(await redFraction(page), fraction)).toBe(true);

    await page.getByRole("button", { name: "Flip horizontally" }).click();
    const flipped = { x: 1 - rotated.x, y: rotated.y };
    await expect.poll(async () => isGreen(await pixelAt(page, flipped))).toBe(true);
    expect(roughly(await redFraction(page), fraction)).toBe(true);
  });
});
