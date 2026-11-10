import { expect, test, type Page } from "@playwright/test";
import { SOURCE, isGreen, openTestPhoto, pixelAt, redFraction, roughly } from "./helpers";

/** A patch of the plain blue background in the test photo. */
const BACKGROUND = { x: 0.5, y: 0.9 } as const;

async function openMixer(page: Page) {
  await openTestPhoto(page);
  await page.getByRole("button", { name: "Color", exact: true }).click();
  await page.getByRole("button", { name: /More controls/ }).click();
  await expect(page.getByRole("group", { name: "Colour mixer" })).toBeVisible();
}

const band = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}( \\(adjusted\\))?$`) });

test.describe("colour mixer", () => {
  test("shows three sliders for the selected band", async ({ page }) => {
    await openMixer(page);
    await band(page, "Blue").click();
    for (const what of ["hue", "saturation", "luminance"]) {
      await expect(page.getByRole("slider", { name: `Blue ${what}` })).toBeVisible();
    }
    await band(page, "Red").click();
    await expect(page.getByRole("slider", { name: "Red hue" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Blue hue" })).toHaveCount(0);
  });

  test("a band's saturation changes only that band's colours", async ({ page }) => {
    await openMixer(page);
    const redBefore = await redFraction(page);
    const backgroundBefore = await pixelAt(page, BACKGROUND);
    expect(isGreen(await pixelAt(page, SOURCE))).toBe(true);

    await band(page, "Green").click();
    const saturation = page.getByRole("slider", { name: "Green saturation" });
    await saturation.focus();
    await page.keyboard.press("Home"); // all the way down to -100

    await expect.poll(async () => isGreen(await pixelAt(page, SOURCE))).toBe(false);
    expect(roughly(await redFraction(page), redBefore)).toBe(true);
    expect(await pixelAt(page, BACKGROUND)).toEqual(backgroundBefore);
    await expect(band(page, "Green")).toHaveAccessibleName("Green (adjusted)");
  });

  test("a band's hue turns its colours towards the next band", async ({ page }) => {
    await openMixer(page);
    const before = await pixelAt(page, SOURCE);

    await band(page, "Green").click();
    const hue = page.getByRole("slider", { name: "Green hue" });
    await hue.focus();
    await page.keyboard.press("End"); // all the way up to +100

    // Green turns towards cyan: the blue channel rises while the green channel stays high.
    await expect
      .poll(async () => (await pixelAt(page, SOURCE))[2]!)
      .toBeGreaterThan(before[2]! + 40);
    expect((await pixelAt(page, SOURCE))[1]!).toBeGreaterThan(150);
  });
});
