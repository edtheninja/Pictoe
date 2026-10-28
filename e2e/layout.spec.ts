import { expect, test } from "@playwright/test";
import { IMAGE, openTestPhoto } from "./helpers";

const TOOLS = ["Adjust", "Color", "Detail", "Crop", "Local", "Clone", "Presets", "Intent"];

const viewports = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "small phone", width: 360, height: 640, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];

for (const vp of viewports) {
  test.describe(vp.name, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.mobile,
      isMobile: vp.mobile && vp.width < 700,
    });

    test("no tool panel covers the photo", async ({ page }) => {
      await openTestPhoto(page);
      for (const tool of TOOLS) {
        const button = page.getByRole("button", { name: tool, exact: true });
        const panel = page.locator('section[aria-label$="controls"]');
        await button.scrollIntoViewIfNeeded();
        await button.click();
        // Adjust starts out active, so its first click closes the panel; click again to open it.
        if ((await panel.count()) === 0) await button.click();
        await expect(panel).toBeVisible();
        await page.waitForTimeout(300); // let the panel's entrance animation settle

        const p = (await panel.boundingBox())!;
        const img = (await page.locator(IMAGE).boundingBox())!;
        // Below lg the panel is a sheet under the photo; from lg up it is a column beside it.
        const overlap = vp.width >= 1024 ? img.x + img.width - p.x : img.y + img.height - p.y;
        expect(overlap, `${tool} panel overlaps the photo by ${overlap}px`).toBeLessThanOrEqual(1);
      }
    });
  });
}
