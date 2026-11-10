import { expect, test, type Page } from "@playwright/test";
import { openTestPhoto, pixelAt } from "./helpers";

/** A patch of the plain blue background in the test photo (a mid-dark blue: rgb 90, 140, 200). */
const BACKGROUND = { x: 0.5, y: 0.9 } as const;

async function openGrading(page: Page) {
  await openTestPhoto(page);
  await page.getByRole("button", { name: "Color", exact: true }).click();
  await page.getByRole("button", { name: /More controls/ }).click();
  await expect(page.getByRole("group", { name: "Colour grading" })).toBeVisible();
}

const range = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}( \\(adjusted\\))?$`) });

test.describe("colour grading", () => {
  test("shows hue, saturation and luminance for the selected range, plus a balance", async ({
    page,
  }) => {
    await openGrading(page);
    await range(page, "Midtones").click();
    for (const what of ["hue", "saturation", "luminance"]) {
      await expect(page.getByRole("slider", { name: `Midtones ${what}` })).toBeVisible();
    }
    await expect(page.getByRole("slider", { name: "Grading balance" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Shadows hue" })).toHaveCount(0);
  });

  test("a mid-tone tint changes the picture and a reset puts it back", async ({ page }) => {
    await openGrading(page);
    const before = await pixelAt(page, BACKGROUND);

    await range(page, "Midtones").click();
    // Hue 0 is red; take the saturation all the way up.
    const saturation = page.getByRole("slider", { name: "Midtones saturation" });
    await saturation.focus();
    await page.keyboard.press("End");

    await expect
      .poll(async () => (await pixelAt(page, BACKGROUND))[0]!)
      .toBeGreaterThan(before[0]! + 8);
    await expect(range(page, "Midtones")).toHaveAccessibleName("Midtones (adjusted)");

    await page.getByRole("button", { name: "Reset Midtones saturation" }).click();
    await expect
      .poll(async () => Math.abs((await pixelAt(page, BACKGROUND))[0]! - before[0]!))
      .toBeLessThan(3);
  });
});
