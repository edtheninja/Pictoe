import { expect, test, type Page } from "@playwright/test";
import {
  BLEMISH,
  openTestPhoto,
  pixelAt,
  redFraction,
  screenPoint,
  settledRedFraction,
} from "./helpers";

/** Plain blue background high in the picture, rgb(90, 140, 200): what a good heal should leave. */
const SKY = { x: 0.5, y: 0.1 } as const;

const apart = (a: number[], b: number[]) =>
  a.slice(0, 3).reduce((t, v, i) => t + Math.abs(v - b[i]!), 0);

/** Opens the Heal tool in Heal mode, with the brush big enough to cover the red circle (radius 40 px). */
async function openHeal(page: Page) {
  await page.getByRole("button", { name: "Heal", exact: true }).click();
  await page.getByRole("radio", { name: "Heal", exact: true }).click();
  const size = page.getByRole("slider", { name: "Brush size" });
  await size.focus();
  await page.keyboard.press("End"); // 100: a brush radius of 60 px on the 800 x 600 test photo
}

const tapOnBlemish = async (page: Page) => {
  const at = await screenPoint(page, BLEMISH);
  await page.mouse.click(at.x, at.y);
};

test.describe("heal mode", () => {
  test("one tap fixes the spot with no source chosen, and one undo brings it back", async ({
    page,
  }) => {
    await openTestPhoto(page);
    const before = await redFraction(page);
    const sky = await pixelAt(page, SKY);
    expect(before).toBeGreaterThan(0.005); // really the red circle

    await openHeal(page);
    // Heal never asks for a source.
    await expect(page.getByText("Tap a clean area to copy from")).toHaveCount(0);
    await tapOnBlemish(page);

    await expect.poll(async () => await redFraction(page)).toBeLessThan(before * 0.1);
    // The patch matches the plain background around it (blended, not a visible island).
    await expect.poll(async () => apart(await pixelAt(page, BLEMISH), sky)).toBeLessThan(30);

    // A tap is one undo step.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => await redFraction(page)).toBeGreaterThan(before * 0.9);
  });

  test("a drag paints with one source and is one undo step", async ({ page }) => {
    await openTestPhoto(page);
    const before = await redFraction(page);

    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Heal", exact: true }).click();
    // A brush of radius 42 px (a bit wider than the 40 px circle). With a soft edge only the inner
    // 70% is replaced outright, so a smaller brush leaves much of the red partly blended in.
    await page.getByRole("slider", { name: "Brush size" }).fill("70");

    // Start in the middle of the blemish and drag across it, so no dab's ring sits on unhealed red.
    const at = await screenPoint(page, BLEMISH);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let dx = 4; dx <= 24; dx += 4) await page.mouse.move(at.x + dx, at.y);
    await page.mouse.up();

    await expect.poll(async () => await redFraction(page)).toBeLessThan(before * 0.5);

    // The whole drag, many dabs, is one undo step.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => await redFraction(page)).toBeGreaterThan(before * 0.9);
  });

  test("says so, and paints nothing, when there is nowhere good to copy from", async ({ page }) => {
    await openTestPhoto(page);
    const before = await settledRedFraction(page);

    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Heal", exact: true }).click();
    // The very corner: most of the brush's surroundings are off the picture.
    const corner = await screenPoint(page, { x: 0.005, y: 0.005 });
    await page.mouse.click(corner.x, corner.y);

    await expect(page.getByText(/find a good place to copy from/)).toBeVisible();
    expect(await redFraction(page)).toBeCloseTo(before, 4);
    // Nothing was added to the history, so undo has nothing to take back.
    await page.keyboard.press("ControlOrMeta+z");
    expect(await redFraction(page)).toBeCloseTo(before, 4);
  });

  test("a healed spot survives a reload", async ({ page }) => {
    await openTestPhoto(page);
    const before = await redFraction(page);
    await openHeal(page);
    await tapOnBlemish(page);
    await expect.poll(async () => await redFraction(page)).toBeLessThan(before * 0.1);
    await page.waitForTimeout(1500); // the session autosaves after a short pause

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('canvas[aria-label*="image"]')).toBeVisible();
    await expect.poll(async () => await redFraction(page)).toBeLessThan(before * 0.1);
  });

  test("Clone mode is still there and still asks for a source", async ({ page }) => {
    await openTestPhoto(page);
    await page.getByRole("button", { name: "Heal", exact: true }).click();
    // Clone is the default, and switching back and forth keeps it working.
    await expect(page.getByRole("radio", { name: "Clone", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByText("Tap a clean area to copy from")).toBeVisible();

    await page.getByRole("radio", { name: "Heal", exact: true }).click();
    await expect(page.getByText("Tap a clean area to copy from")).toHaveCount(0);
    await page.getByRole("radio", { name: "Clone", exact: true }).click();
    await expect(page.getByText("Tap a clean area to copy from")).toBeVisible();
  });
});
