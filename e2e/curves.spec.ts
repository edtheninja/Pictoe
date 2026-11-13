import { expect, test, type Page } from "@playwright/test";
import { openTestPhoto, pixelAt } from "./helpers";

/** A patch of the plain blue background in the test photo, away from the green square and red blemish. */
const BACKGROUND = { x: 0.5, y: 0.9 } as const;

const rgbEditor = (page: Page) => page.getByRole("group", { name: "RGB curve editor" });
const rgbPoint = (page: Page, n: number, of: number) =>
  page.getByRole("slider", { name: `RGB curve point ${n} of ${of}` });
const greenOfBackground = async (page: Page) => (await pixelAt(page, BACKGROUND))[1]!;

async function openCurves(page: Page) {
  await openTestPhoto(page);
  await page.getByRole("button", { name: "Curves", exact: true }).click();
  await expect(rgbEditor(page)).toBeVisible();
}

test.describe("curves", () => {
  test("a point moved with the keyboard changes the picture, and Reset curve restores it", async ({
    page,
  }) => {
    await openCurves(page);
    const before = await greenOfBackground(page);

    await page.getByRole("button", { name: "Add point" }).click();
    const point = rgbPoint(page, 2, 3);
    await expect(point).toBeVisible();
    await expect(point).toHaveAttribute("aria-valuenow", "50");

    await point.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
    await expect(point).toHaveAttribute("aria-valuenow", "38");
    await expect.poll(() => greenOfBackground(page)).toBeLessThan(before - 8);

    await page.getByRole("button", { name: "Reset curve" }).click();
    await expect(rgbPoint(page, 1, 2)).toBeVisible();
    await expect.poll(() => greenOfBackground(page)).toBeGreaterThan(before - 3);
  });

  test("clicking the graph adds a point that can be dragged", async ({ page }) => {
    await openCurves(page);
    const before = await greenOfBackground(page);
    const box = (await rgbEditor(page).boundingBox())!;
    const at = (fx: number, fy: number) => ({
      x: box.x + fx * box.width,
      y: box.y + fy * box.height,
    });

    // Click the middle of the graph, then drag that new point up to 70% output.
    const start = at(0.5, 0.5);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const end = at(0.5, 0.3);
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();

    const point = rgbPoint(page, 2, 3);
    await expect(point).toBeVisible();
    await expect
      .poll(async () => Number(await point.getAttribute("aria-valuenow")))
      .toBeGreaterThan(65);
    await expect.poll(() => greenOfBackground(page)).toBeGreaterThan(before + 8);
  });

  test("holding an arrow key is one undo step", async ({ page }) => {
    await openCurves(page);
    await page.getByRole("button", { name: "Add point" }).click();
    const point = rgbPoint(page, 2, 3);
    await point.focus();

    await page.keyboard.down("ArrowDown");
    for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowDown"); // auto-repeat
    await page.keyboard.up("ArrowDown");
    await expect(point).toHaveAttribute("aria-valuenow", "44");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(point).toHaveAttribute("aria-valuenow", "50");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(point).toHaveAttribute("aria-valuenow", "44");
  });

  test("Delete removes the focused point, and the end points can't be removed", async ({
    page,
  }) => {
    await openCurves(page);
    await page.getByRole("button", { name: "Add point" }).click();
    const point = rgbPoint(page, 2, 3);
    await point.focus();
    await page.keyboard.press("Delete");
    await expect(rgbPoint(page, 1, 2)).toBeVisible();
    await expect(rgbPoint(page, 2, 3)).toHaveCount(0);

    await rgbPoint(page, 1, 2).focus();
    await page.keyboard.press("Delete");
    await expect(rgbPoint(page, 1, 2)).toBeVisible();
  });

  test("RGB and Luminance keep separate curves", async ({ page }) => {
    await openCurves(page);
    await page.getByRole("button", { name: "Add point" }).click();
    await expect(rgbPoint(page, 2, 3)).toBeVisible();

    await page.getByRole("button", { name: "Luminance", exact: true }).click();
    await expect(page.getByRole("group", { name: "Luminance curve editor" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Luminance curve point 1 of 2" })).toBeVisible();

    await page.getByRole("button", { name: "RGB", exact: true }).click();
    await expect(rgbPoint(page, 2, 3)).toBeVisible();
  });

  test("a curve survives a reload", async ({ page }) => {
    await openCurves(page);
    const before = await greenOfBackground(page);
    await page.getByRole("button", { name: "Add point" }).click();
    await rgbPoint(page, 2, 3).focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
    // All 12 presses are applied, and the preview has finished drawing the result: the picture
    // may still be catching up when it first crosses the threshold, so wait until it stops moving.
    await expect(rgbPoint(page, 2, 3)).toHaveAttribute("aria-valuenow", "38");
    await expect.poll(() => greenOfBackground(page)).toBeLessThan(before - 8);
    let edited = await greenOfBackground(page);
    await expect
      .poll(async () => {
        await page.waitForTimeout(300);
        const now = await greenOfBackground(page);
        const moved = Math.abs(now - edited);
        edited = now;
        return moved;
      })
      .toBe(0);
    await page.waitForTimeout(1500); // the session autosaves after a short pause

    await page.reload();
    await expect(page.locator('canvas[aria-label*="image"]')).toBeVisible();
    await expect
      .poll(async () => Math.abs((await greenOfBackground(page)) - edited))
      .toBeLessThan(4);
  });
});
