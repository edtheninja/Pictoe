import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openTestPhoto } from "./helpers";

const TOOLS = ["Adjust", "Color", "Detail", "Crop", "Local", "Clone", "Presets", "Intent"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const PANEL = 'section[aria-label$="controls"]';

async function violations(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map(
    (v) =>
      `${where}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(" ")})`,
  );
}

async function openTool(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  if ((await page.locator(PANEL).count()) === 0) await button.click(); // Adjust starts out active
  await expect(page.locator(PANEL)).toBeVisible();
  await page.waitForTimeout(350); // entrance animation
}

/** Presses Tab until the element matching `name` has focus (or gives up). */
async function tabTo(page: Page, matches: (el: Element) => boolean, limit = 80) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(
      (src) =>
        (new Function("el", `return (${src})(el)`) as (el: Element) => boolean)(
          document.activeElement as Element,
        ),
      matches.toString(),
    );
    if (hit) return;
  }
  throw new Error(`Tab never reached the element within ${limit} presses`);
}

const sizes = [
  { name: "desktop", width: 1280, height: 800, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

for (const vp of sizes) {
  test.describe(`axe scan, ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.mobile,
      isMobile: vp.mobile,
    });

    test("no WCAG A/AA violations on any screen or tool", async ({ page }) => {
      const found: string[] = [];
      await page.goto("/", { waitUntil: "networkidle" });
      found.push(...(await violations(page, "import screen")));
      await openTestPhoto(page);
      found.push(...(await violations(page, "editor")));
      for (const tool of TOOLS) {
        await openTool(page, tool);
        found.push(...(await violations(page, `tool ${tool}`)));
      }
      await page.getByRole("button", { name: "Export" }).click();
      await expect(page.getByRole("dialog", { name: "Export options" })).toBeVisible();
      found.push(...(await violations(page, "export popover")));
      expect(found).toEqual([]);
    });
  });
}

test.describe("keyboard", () => {
  test("a tool can be reached with Tab and opened with Enter", async ({ page }) => {
    await openTestPhoto(page);
    await tabTo(page, (el) => el.textContent?.trim() === "Crop" && el.tagName === "BUTTON");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Crop selection" })).toBeVisible();
  });

  test("the focused control has a visible focus indicator", async ({ page }) => {
    await openTestPhoto(page);
    await tabTo(page, (el) => el.textContent?.trim() === "Crop" && el.tagName === "BUTTON");
    const indicator = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return {
        outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0,
        shadow: s.boxShadow !== "none",
      };
    });
    expect(indicator.outline || indicator.shadow).toBe(true);
  });

  test("a slider has a name and moves with the arrow keys", async ({ page }) => {
    await openTestPhoto(page);
    await openTool(page, "Adjust");
    const slider = page.getByRole("slider", { name: "Exposure" });
    await slider.focus();
    const before = Number(await slider.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  });

  test("the crop can be resized and moved from the keyboard, and announces the result", async ({
    page,
  }) => {
    await openTestPhoto(page);
    await openTool(page, "Crop");
    const selection = page.getByRole("group", { name: "Crop selection" });
    await tabTo(page, (el) => el.getAttribute("aria-label") === "Crop selection");
    await expect(selection).toBeFocused();
    const live = page.locator("[aria-live=polite]").filter({ hasText: /^Crop \d+%/ });

    await expect(live).toHaveText("Crop 100% wide, 100% tall, 0% from the left, 0% from the top.");
    await page.keyboard.press("Alt+Shift+ArrowLeft"); // narrower by 5%
    await expect(live).toHaveText(/Crop 95% wide, 100% tall/);
    await page.keyboard.press("Alt+ArrowUp"); // shorter by 1%
    await expect(live).toHaveText(/Crop 95% wide, 99% tall/);
    await page.keyboard.press("ArrowRight"); // now there is room to move
    await expect(live).toHaveText(/Crop 95% wide, 99% tall, 1% from the left/);
  });

  test("holding a key is one undo step, and so is a whole crop drag", async ({ page }) => {
    await openTestPhoto(page);
    await openTool(page, "Crop");
    const live = page.locator("[aria-live=polite]").filter({ hasText: /^Crop \d+%/ });
    await tabTo(page, (el) => el.getAttribute("aria-label") === "Crop selection");

    // Hold Alt + Left, which repeats: width goes 100% → 95%.
    await page.keyboard.down("Alt");
    for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowLeft");
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("Alt");
    await expect(live).toHaveText(/Crop 95% wide/);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(live).toHaveText(/Crop 100% wide, 100% tall/); // one undo undoes the whole hold
    // ...and leaves nothing behind: no half-finished steps from the key repeats.
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    // Drag the top-left corner in ten small steps.
    const box = (await page.getByRole("group", { name: "Crop selection" }).boundingBox())!;
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + i * 8, box.y + i * 6);
    await page.mouse.up();
    await expect(live).not.toHaveText(/Crop 100% wide/);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(live).toHaveText(/Crop 100% wide, 100% tall, 0% from the left, 0% from the top/);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

test.describe("motion", () => {
  test("animations are effectively off when the user asks for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openTestPhoto(page);
    await openTool(page, "Color");
    const seconds = await page
      .locator(PANEL)
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(seconds).toBeLessThan(0.01);
  });

  test("and they do run normally otherwise (so the check above means something)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openTestPhoto(page);
    await openTool(page, "Color");
    const seconds = await page
      .locator(PANEL)
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(seconds).toBeGreaterThan(0.05);
  });
});
