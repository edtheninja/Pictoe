import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { IMAGE } from "./helpers";
import { cameraBigEndian } from "../src/engine/image/photoInfo.fixtures";
import { hasLocation, readPhotoInfoFromBytes } from "../src/engine/image/photoInfo";

/** Opens the fixture camera photo: a real JPEG with camera details and a location in its EXIF. */
async function openCameraPhoto(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("input[type=file]", {
    name: "camera.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(cameraBigEndian()),
  });
  await expect(page.locator(IMAGE)).toBeVisible();
}

const openExport = async (page: Page) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "JPG", exact: true }).click();
};
const keepInfo = (page: Page) => page.getByRole("checkbox", { name: /Keep photo info/ });
const location = (page: Page) => page.getByRole("checkbox", { name: /Include location/ });

/** Saves the image and returns the downloaded JPEG's bytes. */
async function save(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save image" }).click(),
  ]);
  const bytes = new Uint8Array(await readFile((await download.path())!));
  expect(bytes.subarray(0, 2)).toEqual(Uint8Array.of(0xff, 0xd8)); // a JPEG
  return bytes;
}

test.describe("photo info", () => {
  test("a default export carries no photo info at all", async ({ page }) => {
    await openCameraPhoto(page);
    await openExport(page);
    await expect(keepInfo(page)).not.toBeChecked();
    expect(readPhotoInfoFromBytes(await save(page))).toBeNull();
  });

  test("keeping the info writes the camera details but not the location", async ({ page }) => {
    await openCameraPhoto(page);
    await openExport(page);
    await keepInfo(page).check();
    await expect(location(page)).not.toBeChecked(); // location is its own, separate choice
    const bytes = await save(page);
    const info = readPhotoInfoFromBytes(bytes)!;
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
    const info = readPhotoInfoFromBytes(await save(page))!;
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

  test("the choice is not offered for PNG, and says why", async ({ page }) => {
    await openCameraPhoto(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("button", { name: "PNG", exact: true }).click();
    await expect(keepInfo(page)).toHaveCount(0);
    await expect(page.getByText("Photo info can be kept when saving as JPG.")).toBeVisible();
  });
});
