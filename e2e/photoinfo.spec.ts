import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { IMAGE } from "./helpers";
import { cameraBigEndian, cameraPng, cameraWebp } from "../src/engine/image/photoInfo.fixtures";
import { hasLocation, readPhotoInfoAny, sniffFormat } from "../src/engine/image/photoInfo";

/** Opens a fixture camera photo: a real file with camera details and a location in its EXIF. */
async function openCameraPhoto(
  page: Page,
  file: () => Uint8Array = cameraBigEndian,
  name = "camera.jpg",
  mimeType = "image/jpeg",
) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("input[type=file]", { name, mimeType, buffer: Buffer.from(file()) });
  await expect(page.locator(IMAGE)).toBeVisible();
}

const openExport = async (page: Page, format = "JPG") => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: format, exact: true }).click();
};
const keepInfo = (page: Page) => page.getByRole("checkbox", { name: /Keep photo info/ });
const location = (page: Page) => page.getByRole("checkbox", { name: /Include location/ });

/** Saves the image and returns the downloaded file's bytes, checking it is the format asked for. */
async function save(page: Page, format: "jpeg" | "png" | "webp" = "jpeg") {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save image" }).click(),
  ]);
  const bytes = new Uint8Array(await readFile((await download.path())!));
  expect(sniffFormat(bytes)).toBe(format);
  return bytes;
}

test.describe("photo info", () => {
  test("a default export carries no photo info at all", async ({ page }) => {
    await openCameraPhoto(page);
    await openExport(page);
    await expect(keepInfo(page)).not.toBeChecked();
    expect(await readPhotoInfoAny(await save(page))).toBeNull();
  });

  test("keeping the info writes the camera details but not the location", async ({ page }) => {
    await openCameraPhoto(page);
    await openExport(page);
    await keepInfo(page).check();
    await expect(location(page)).not.toBeChecked(); // location is its own, separate choice
    const bytes = await save(page);
    const info = (await readPhotoInfoAny(bytes))!;
    expect(info).not.toBeNull();
    expect(hasLocation(info)).toBe(false);
    expect(Buffer.from(bytes).toString("latin1")).toContain("TestCam");
    for (const secret of ["SERIAL-12345-SECRET", "PRIVATE CAPTION", "Owner Name Secret"]) {
      expect(Buffer.from(bytes).toString("latin1")).not.toContain(secret);
    }
  });

  test("including the location writes it", async ({ page }) => {
    await openCameraPhoto(page);
    await openExport(page);
    await keepInfo(page).check();
    await location(page).check();
    const info = (await readPhotoInfoAny(await save(page)))!;
    expect(hasLocation(info)).toBe(true);
  });

  test("the location switch is off and unavailable until the info is kept, and resets when it is turned off", async ({
    page,
  }) => {
    await openCameraPhoto(page);
    await openExport(page);
    await expect(location(page)).toBeDisabled();
    await keepInfo(page).check();
    await location(page).check();
    await keepInfo(page).uncheck();
    await keepInfo(page).check();
    await expect(location(page)).not.toBeChecked(); // it did not come back on by itself
  });

  for (const [label, format] of [
    ["PNG", "png"],
    ["WebP", "webp"],
  ] as const) {
    test(`keeping the info works when saving as ${label}`, async ({ page }) => {
      await openCameraPhoto(page);
      await openExport(page, label);
      await expect(keepInfo(page)).toBeVisible();
      await keepInfo(page).check();
      const bytes = await save(page, format);
      const info = (await readPhotoInfoAny(bytes))!;
      expect(info).not.toBeNull();
      expect(hasLocation(info)).toBe(false); // location is still its own choice
      expect(Buffer.from(bytes).toString("latin1")).toContain("TestCam");
      expect(Buffer.from(bytes).toString("latin1")).not.toContain("SERIAL-12345-SECRET");
    });

    test(`a default ${label} export carries no photo info`, async ({ page }) => {
      await openCameraPhoto(page);
      await openExport(page, label);
      expect(await readPhotoInfoAny(await save(page, format))).toBeNull();
    });
  }

  for (const [label, file, name, mime] of [
    ["PNG", cameraPng, "camera.png", "image/png"],
    ["WebP", cameraWebp, "camera.webp", "image/webp"],
  ] as const) {
    test(`a ${label} photo's camera info can be kept too`, async ({ page }) => {
      await openCameraPhoto(page, file, name, mime);
      await openExport(page);
      await keepInfo(page).check();
      await location(page).check();
      const info = (await readPhotoInfoAny(await save(page)))!;
      expect(info).not.toBeNull();
      expect(hasLocation(info)).toBe(true);
    });
  }
});
