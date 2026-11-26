import { expect, test, type Page } from "@playwright/test";
import { makePng, openTestPhoto, pixelAt, IMAGE } from "./helpers";

/** A patch of the plain blue background in the test photo, away from the green square and red blemish. */
const BACKGROUND = { x: 0.5, y: 0.9 } as const;
const greenOfBackground = async (page: Page) => (await pixelAt(page, BACKGROUND))[1]!;

const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const copyButton = (page: Page) => page.getByRole("button", { name: "Copy edits", exact: true });
const pasteButton = (page: Page) => page.getByRole("button", { name: "Paste edits", exact: true });

/** Darkens the background by pulling the middle of the RGB curve down, and returns its new green. */
async function darkenWithCurve(page: Page) {
  const before = await greenOfBackground(page);
  await tool(page, "Curves");
  await page.getByRole("button", { name: "Add point" }).click();
  const point = page.getByRole("slider", { name: "RGB curve point 2 of 3" });
  await point.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  await expect.poll(() => greenOfBackground(page)).toBeLessThan(before - 8);
  return { before, after: await greenOfBackground(page) };
}

/** Opens another photo without reloading the page, so only in-memory state can carry over. */
async function openAnotherPhoto(page: Page) {
  await page.getByRole("button", { name: "Return to import screen" }).click();
  const buffer = await makePng(page);
  await page.setInputFiles("input[type=file]", {
    name: "second.png",
    mimeType: "image/png",
    buffer,
  });
  await expect(page.locator(IMAGE)).toBeVisible();
}

test.describe("copy and paste edits", () => {
  test("a look copied from one photo can be pasted onto the next", async ({ page }) => {
    await openTestPhoto(page);
    const { before, after } = await darkenWithCurve(page);

    await tool(page, "Presets");
    await copyButton(page).click();
    await expect(page.getByText(/Copied: curves/)).toBeVisible();

    await openAnotherPhoto(page);
    await expect.poll(() => greenOfBackground(page)).toBeGreaterThan(before - 3); // untouched

    await tool(page, "Presets");
    await pasteButton(page).click();
    await expect.poll(() => greenOfBackground(page)).toBeLessThan(before - 8);
    expect(Math.abs((await greenOfBackground(page)) - after)).toBeLessThan(4);
  });

  test("a paste is one undo step", async ({ page }) => {
    await openTestPhoto(page);
    await darkenWithCurve(page);
    await tool(page, "Presets");
    await copyButton(page).click();

    await openAnotherPhoto(page);
    const untouched = await greenOfBackground(page);
    await tool(page, "Presets");
    await pasteButton(page).click();
    await expect.poll(() => greenOfBackground(page)).toBeLessThan(untouched - 8);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => greenOfBackground(page)).toBeGreaterThan(untouched - 3);
  });

  test("the copied look is still there after the page is reloaded", async ({ page }) => {
    await openTestPhoto(page);
    await darkenWithCurve(page);
    await tool(page, "Presets");
    await copyButton(page).click();

    await openTestPhoto(page); // reloads the page: only storage can carry the look over
    await tool(page, "Presets");
    await expect(pasteButton(page)).toBeEnabled();
  });

  test("nothing to copy, nothing to paste: both are off", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await openTestPhoto(page);
    await tool(page, "Presets");
    await expect(copyButton(page)).toBeDisabled();
    await expect(pasteButton(page)).toBeDisabled();
  });
});
