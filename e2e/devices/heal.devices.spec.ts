import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  BLEMISH,
  IMAGE,
  openTestPhoto,
  pixelAt,
  redFraction,
  screenPoint,
  settledRedFraction,
} from "../helpers";

/**
 * Heal on WebKit (Safari's engine), an iPhone profile and a Pixel profile (`npm run e2e:devices`).
 * These are emulations: the right engine, screen size and kind of input, but not a phone's memory
 * limits or a real finger, so they are a first line of defence and not a replacement for trying
 * it on a device. Two-finger gestures need real multi-touch input, which only Chromium offers
 * (through the DevTools protocol), so those run on the Pixel profile only.
 */

/** Plain blue background high in the picture, rgb(90, 140, 200). */
const SKY = { x: 0.5, y: 0.1 } as const;

const apart = (a: number[], b: number[]) =>
  a.slice(0, 3).reduce((t, v, i) => t + Math.abs(v - b[i]!), 0);

/** Errors the page throws or logs: every test ends by checking there were none. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/** A tap the way this device does it: a finger on a touch screen, a click on a desktop. */
async function tap(page: Page, at: { x: number; y: number }) {
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** Opens the Heal tool in Heal mode with the brush wide enough to cover the red circle. */
async function openHeal(page: Page) {
  await page.getByRole("button", { name: "Heal", exact: true }).click();
  await page.getByRole("radio", { name: "Heal", exact: true }).click();
  await page.getByRole("slider", { name: "Brush size" }).fill("100");
}

test.describe("heal on real engines and phone screens", () => {
  test("a tap fixes the spot with no source chosen, and one undo brings it back", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await redFraction(page);
    const sky = await pixelAt(page, SKY);

    await openHeal(page);
    await tap(page, await screenPoint(page, BLEMISH));

    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.1);
    await expect.poll(async () => apart(await pixelAt(page, BLEMISH), sky)).toBeLessThan(30);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => redFraction(page)).toBeGreaterThan(before * 0.9);
    expect(errors).toEqual([]);
  });

  test("a drag heals along a path, and the whole drag is one undo step", async ({ page }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await redFraction(page);

    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Heal", exact: true }).click();
    await page.getByRole("slider", { name: "Brush size" }).fill("70");

    const at = await screenPoint(page, BLEMISH);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let dx = 3; dx <= 18; dx += 3) await page.mouse.move(at.x + dx, at.y);
    await page.mouse.up();

    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.5);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => redFraction(page)).toBeGreaterThan(before * 0.9);
    expect(errors).toEqual([]);
  });

  test("a healed spot survives a reload", async ({ page }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await redFraction(page);
    await openHeal(page);
    await tap(page, await screenPoint(page, BLEMISH));
    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.1);
    await page.waitForTimeout(1500); // the session autosaves after a short pause

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(IMAGE)).toBeVisible();
    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.1);
    expect(errors).toEqual([]);
  });

  test("Clone mode still works: choose a source, then paint", async ({ page }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await redFraction(page);
    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Clone", exact: true }).click();
    await expect(page.getByText("Tap a clean area to copy from")).toBeVisible();

    await tap(page, await screenPoint(page, { x: 0.2, y: 0.7 })); // the green square
    await expect(page.getByText("Tap a clean area to copy from")).toHaveCount(0);
    const at = await screenPoint(page, BLEMISH);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let dx = -14; dx <= 14; dx += 4) await page.mouse.move(at.x + dx, at.y);
    await page.mouse.up();

    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.9);
    expect(errors).toEqual([]);
  });

  test("the no-source notice fits the screen, and nothing is painted", async ({ page }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await settledRedFraction(page);
    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Heal", exact: true }).click();

    await tap(page, await screenPoint(page, { x: 0.005, y: 0.005 })); // the very corner
    const notice = page.getByText(/find a good place to copy from/);
    await expect(notice).toBeVisible();

    // The whole notice is on screen, not cut off on a narrow phone.
    const box = (await notice.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);

    expect(await redFraction(page)).toBeCloseTo(before, 4);
    expect(errors).toEqual([]);
  });

  test("a 12 megapixel photo opens and heals without errors", async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await openTestPhoto(page, 4000, 3000);
    const before = await redFraction(page);
    await openHeal(page);
    await tap(page, await screenPoint(page, BLEMISH));
    await expect.poll(() => redFraction(page), { timeout: 30_000 }).toBeLessThan(before * 0.5);
    expect(errors).toEqual([]);
  });
});

/** Two real fingers need multi-touch input: Chromium's DevTools protocol provides it. */
type Finger = { x: number; y: number; id: number };
async function touches(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  fingers: Finger[],
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: fingers.map((f) => ({ x: f.x, y: f.y, id: f.id })),
  });
}

/** The zoom of the picture: the scale in the transform of whichever ancestor of the canvas has one. */
function pictureZoom(page: Page) {
  return page.evaluate((sel) => {
    let el: Element | null = document.querySelector(sel);
    while (el) {
      const t = getComputedStyle(el).transform;
      if (t && t !== "none") {
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) return Number(m[1]!.split(",")[0]);
      }
      el = el.parentElement;
    }
    return 1;
  }, IMAGE);
}

test.describe("two fingers (Chromium touch)", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "multi-touch input is only available through Chromium's protocol",
    );
  });

  test("a touch drag with one finger heals, as one undo step", async ({ page }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await redFraction(page);
    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Heal", exact: true }).click();
    await page.getByRole("slider", { name: "Brush size" }).fill("70");

    const cdp = await page.context().newCDPSession(page);
    const at = await screenPoint(page, BLEMISH);
    await touches(cdp, "touchStart", [{ x: at.x, y: at.y, id: 1 }]);
    for (let dx = 4; dx <= 20; dx += 4)
      await touches(cdp, "touchMove", [{ x: at.x + dx, y: at.y, id: 1 }]);
    await touches(cdp, "touchEnd", []);

    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.5);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => redFraction(page)).toBeGreaterThan(before * 0.9);
    expect(errors).toEqual([]);
  });

  test("a pinch zooms the picture and leaves no stray dab under the first finger", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await settledRedFraction(page);
    await openHeal(page);

    const cdp = await page.context().newCDPSession(page);
    const at = await screenPoint(page, BLEMISH); // the first finger lands right on the blemish
    const zoomBefore = await pictureZoom(page);

    // The first finger goes down alone; the second follows a moment later, as fingers really do.
    await touches(cdp, "touchStart", [{ x: at.x, y: at.y, id: 1 }]);
    await page.waitForTimeout(60);
    await touches(cdp, "touchStart", [
      { x: at.x, y: at.y, id: 1 },
      { x: at.x + 50, y: at.y, id: 2 },
    ]);
    for (let spread = 50; spread <= 170; spread += 20) {
      await touches(cdp, "touchMove", [
        { x: at.x, y: at.y, id: 1 },
        { x: at.x + spread, y: at.y, id: 2 },
      ]);
    }
    await touches(cdp, "touchEnd", []);

    // The picture zoomed...
    await expect.poll(() => pictureZoom(page)).toBeGreaterThan(zoomBefore * 1.5);
    // ...and the blemish under the first finger was not healed by the touch that started the pinch.
    expect(await redFraction(page)).toBeCloseTo(before, 3);
    // Nothing was added to the history either: undo has nothing to take back.
    await page.keyboard.press("ControlOrMeta+z");
    expect(await redFraction(page)).toBeCloseTo(before, 3);
    expect(errors).toEqual([]);
  });

  test("a stroke that has been going a while is kept when a second finger lands", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openTestPhoto(page);
    const before = await redFraction(page);
    await page.getByRole("button", { name: "Heal", exact: true }).click();
    await page.getByRole("radio", { name: "Heal", exact: true }).click();
    await page.getByRole("slider", { name: "Brush size" }).fill("70");

    const cdp = await page.context().newCDPSession(page);
    const at = await screenPoint(page, BLEMISH);
    await touches(cdp, "touchStart", [{ x: at.x, y: at.y, id: 1 }]);
    for (let dx = 4; dx <= 24; dx += 4)
      await touches(cdp, "touchMove", [{ x: at.x + dx, y: at.y, id: 1 }]);
    await page.waitForTimeout(500); // well past the moment in which a second finger means "pinch"
    await touches(cdp, "touchStart", [
      { x: at.x + 24, y: at.y, id: 1 },
      { x: at.x + 120, y: at.y + 80, id: 2 },
    ]);
    await touches(cdp, "touchEnd", []);

    // The stroke the user was making is still there.
    await expect.poll(() => redFraction(page)).toBeLessThan(before * 0.5);
    expect(errors).toEqual([]);
  });
});
