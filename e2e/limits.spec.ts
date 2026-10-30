import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readImageSize } from "../src/engine/image/limits";
import { openTestPhoto } from "./helpers";

/** A PNG header that claims 12,000 × 9,000 (108 MP) and has no pixel data at all. */
function oversizedPng() {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return Buffer.from([
    0x89,
    ...text("PNG"),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    ...text("IHDR"),
    ...u32(12000),
    ...u32(9000),
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
}

/** Opens the Export popover, saves, and returns the downloaded file's bytes. */
async function saveExport(page: Page) {
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save image" }).click(),
  ]);
  return new Uint8Array(readFileSync((await download.path())!));
}

test.describe("large photos", () => {
  test("a photo over 100 MP is refused with a clear message, before decoding", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.setInputFiles("input[type=file]", {
      name: "scan.png",
      mimeType: "image/png",
      buffer: oversizedPng(),
    });
    await expect(page.getByText(/12,000 × 9,000 \(108 MP\)/)).toBeVisible();
    await expect(page.getByText(/larger than Pictoe can open/)).toBeVisible();
    await expect(page.locator('canvas[aria-label*="image"]')).toHaveCount(0); // never opened
  });

  test("export still saves a full-size photo normally", async ({ page }) => {
    await openTestPhoto(page);
    const bytes = await saveExport(page);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // a real JPEG
    expect(readImageSize(bytes)).toEqual({ width: 800, height: 600 });
    await expect(page.getByText(/Saved at/)).toHaveCount(0); // nothing was reduced, nothing to say
  });

  test("when the browser can't make a big canvas, export steps down and says so", async ({
    page,
  }) => {
    // Pretend to be a device that can only encode about 300,000 pixels, like a memory-starved phone.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        if (this.width * this.height > 300_000) return callback(null);
        return original.call(this, callback, type, quality);
      };
    });
    await openTestPhoto(page);
    const bytes = await saveExport(page);
    expect(readImageSize(bytes)).toEqual({ width: 600, height: 450 }); // 75% of 800 × 600
    await expect(page.getByText("Saved at 600 × 450 instead of 800 × 600")).toBeVisible();
  });
});
