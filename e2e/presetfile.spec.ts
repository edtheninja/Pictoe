import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openTestPhoto } from "./helpers";

const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const exportButton = (page: Page) => page.getByRole("button", { name: "Export presets" });
const fileInput = (page: Page) => page.getByLabel("Import presets file");

/** Pulls Exposure all the way down, saves the result as a preset with this name, and leaves the Presets tool open. */
async function saveAPreset(page: Page, name: string) {
  const exposure = page.getByRole("slider", { name: "Exposure" });
  await exposure.focus();
  await page.keyboard.press("Home");
  await tool(page, "Presets");
  await page.getByRole("button", { name: "Save current as preset" }).click();
  await page.getByPlaceholder("Preset name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Clicks Export presets and returns the text of the file the browser downloads. */
async function exportedText(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), exportButton(page).click()]);
  expect(download.suggestedFilename()).toMatch(/^pictoe-presets-\d{4}-\d{2}-\d{2}\.json$/);
  return readFile((await download.path())!, "utf8");
}

test.describe("preset files", () => {
  test("Export presets writes a file with the preset's name and only what it changes", async ({
    page,
  }) => {
    await openTestPhoto(page);
    await tool(page, "Presets");
    await expect(exportButton(page)).toBeDisabled(); // nothing saved yet
    await tool(page, "Adjust");
    await saveAPreset(page, "Dark test");
    await expect(exportButton(page)).toBeEnabled();

    const file = JSON.parse(await exportedText(page));
    expect(file.format).toBe("pictoe-presets");
    expect(file.presets).toHaveLength(1);
    expect(file.presets[0].name).toBe("Dark test");
    expect(Object.keys(file.presets[0].adjustments)).toEqual(["exposure"]);
    expect(file.presets[0].id).toBeUndefined();
  });

  test("a preset exported, deleted and imported comes back, and importing again adds nothing", async ({
    page,
  }) => {
    await openTestPhoto(page);
    await saveAPreset(page, "Dark test");
    const text = await exportedText(page);

    await page.getByRole("button", { name: "Delete preset Dark test" }).click();
    await expect(page.getByText("Dark test", { exact: true })).toHaveCount(0);

    const upload = {
      name: "presets.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    };
    await fileInput(page).setInputFiles(upload);
    await expect(page.getByText("Added 1 preset.")).toBeVisible();
    await expect(page.getByText("Dark test", { exact: true })).toBeVisible();

    await fileInput(page).setInputFiles(upload);
    await expect(page.getByText(/No new presets\. 1 you already had\./)).toBeVisible();
    await expect(page.getByText("Dark test", { exact: true })).toHaveCount(1);
  });

  test("a file that is not a preset file is refused and adds nothing", async ({ page }) => {
    await openTestPhoto(page);
    await tool(page, "Presets");
    await fileInput(page).setInputFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"hello":"world"}'),
    });
    await expect(page.getByText("That isn't a Pictoe preset file.")).toBeVisible();
    await expect(page.getByText("No saved presets yet.")).toBeVisible();
  });

  test("a preset from a file is usable: applying it changes the photo", async ({ page }) => {
    await openTestPhoto(page);
    await tool(page, "Presets");
    const text = JSON.stringify({
      format: "pictoe-presets",
      version: 1,
      presets: [{ name: "From a friend", adjustments: { exposure: -100 } }],
    });
    await fileInput(page).setInputFiles({
      name: "friend.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    await expect(page.getByText("Added 1 preset.")).toBeVisible();
    await page.getByRole("button", { name: "From a friend", exact: true }).click();
    await tool(page, "Adjust");
    await expect(page.getByRole("slider", { name: "Exposure" })).toHaveAttribute(
      "aria-valuenow",
      "-100",
    );
  });
});
