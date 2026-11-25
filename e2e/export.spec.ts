import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openTestPhoto } from "./helpers";

/** The width and height of a PNG, read from its header, so the test sees the real file's size. */
async function pngSize(page: Page, action: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const openExport = async (page: Page) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "PNG", exact: true }).click(); // a format that is easy to read back
};
const size = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();
const save = (page: Page) => page.getByRole("button", { name: "Save image" }).click();
const readout = (page: Page) => page.getByText(/Saves at/);

test.describe("export size", () => {
  test("Original saves at the photo's own size, and says so", async ({ page }) => {
    await openTestPhoto(page); // 800 x 600
    await openExport(page);
    await expect(page.getByRole("radio", { name: "Original", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(readout(page)).toContainText("800 × 600");
    expect(await pngSize(page, () => save(page))).toEqual({ width: 800, height: 600 });
  });

  test("a percent saves a smaller file, and the readout matches the file", async ({ page }) => {
    await openTestPhoto(page);
    await openExport(page);
    await size(page, "50%");
    await expect(readout(page)).toContainText("400 × 300");
    expect(await pngSize(page, () => save(page))).toEqual({ width: 400, height: 300 });

    await openExport(page);
    await size(page, "25%");
    await expect(readout(page)).toContainText("200 × 150");
    expect(await pngSize(page, () => save(page))).toEqual({ width: 200, height: 150 });
  });

  test("Custom: longest side and percent are two views of one size", async ({ page }) => {
    await openTestPhoto(page);
    await openExport(page);
    await size(page, "Custom");
    const pixels = page.getByLabel("Longest side (px)");
    const percent = page.getByLabel("Percent of original");

    // It opens at the current size, so the fields are never empty.
    await expect(pixels).toHaveValue("800");
    await expect(percent).toHaveValue("100");

    await pixels.fill("200");
    await expect(percent).toHaveValue("25");
    await expect(readout(page)).toContainText("200 × 150");
    expect(await pngSize(page, () => save(page))).toEqual({ width: 200, height: 150 });

    await openExport(page);
    await percent.fill("50");
    await expect(pixels).toHaveValue("400");
    await expect(readout(page)).toContainText("400 × 300");
    expect(await pngSize(page, () => save(page))).toEqual({ width: 400, height: 300 });
  });

  test("a size larger than the photo saves at the original size and explains why", async ({
    page,
  }) => {
    await openTestPhoto(page);
    await openExport(page);
    await size(page, "Custom");
    await page.getByLabel("Longest side (px)").fill("5000");
    await expect(readout(page)).toContainText("800 × 600");
    await expect(page.getByText(/larger than the photo/)).toBeVisible();
    expect(await pngSize(page, () => save(page))).toEqual({ width: 800, height: 600 });
  });

  test("something that is not a number cannot be saved", async ({ page }) => {
    await openTestPhoto(page);
    await openExport(page);
    await size(page, "Custom");
    const pixels = page.getByLabel("Longest side (px)");

    for (const bad of ["", "abc", "12.5", "-4"]) {
      await pixels.fill(bad);
      await expect(page.getByRole("button", { name: "Save image" })).toBeDisabled();
      await expect(page.getByText("Enter a whole number")).toBeVisible();
    }
    await pixels.fill("300");
    await expect(page.getByRole("button", { name: "Save image" })).toBeEnabled();
  });

  test("the size follows the crop and rotation: a turned photo saves turned", async ({ page }) => {
    await openTestPhoto(page);
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await page.getByRole("button", { name: "Rotate right" }).click(); // 800 x 600 becomes 600 x 800
    await openExport(page);
    await size(page, "50%");
    await expect(readout(page)).toContainText("300 × 400");
    expect(await pngSize(page, () => save(page))).toEqual({ width: 300, height: 400 });
  });

  test("typing a number in a size field does not trigger the editor's shortcuts", async ({
    page,
  }) => {
    await openTestPhoto(page);
    await openExport(page);
    await size(page, "Custom");
    const pixels = page.getByLabel("Longest side (px)");
    await pixels.fill("");
    await pixels.pressSequentially("0123"); // "0" and digits are shortcuts elsewhere (zoom to fit)
    await expect(pixels).toHaveValue("0123");
  });
});
