import { expect, test, type Page } from "@playwright/test";
import { openTestPhoto, pixelAt } from "./helpers";

/** Plain blue background in the middle and near a corner of the test photo. */
const MIDDLE = { x: 0.5, y: 0.6 } as const;
const CORNER = { x: 0.03, y: 0.97 } as const;

async function openLocal(page: Page) {
  await openTestPhoto(page);
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await expect(page.getByRole("button", { name: "Radial", exact: true })).toBeVisible();
}

const handle = (page: Page, id: string) => page.locator(`button[data-handle="${id}"]`);
const luma = ([r = 0, g = 0, b = 0]: number[]) => 0.3 * r + 0.59 * g + 0.11 * b;

test.describe("gradient and radial masks", () => {
  test("a radial area shows handles, brightens inside and not outside, and hides on request", async ({
    page,
  }) => {
    await openLocal(page);
    const before = {
      middle: luma(await pixelAt(page, MIDDLE)),
      corner: luma(await pixelAt(page, CORNER)),
    };

    await page.getByRole("button", { name: "Radial", exact: true }).click();
    for (const id of ["centre", "radiusX", "radiusY", "feather"]) {
      await expect(handle(page, id)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Radial 1", exact: true })).toBeVisible();

    const exposure = page.getByRole("slider", { name: "Exposure" });
    await exposure.focus();
    await page.keyboard.press("End");

    await expect
      .poll(async () => luma(await pixelAt(page, MIDDLE)))
      .toBeGreaterThan(before.middle + 20);
    expect(Math.abs(luma(await pixelAt(page, CORNER)) - before.corner)).toBeLessThan(3);

    await page.getByRole("button", { name: "Hide Radial 1" }).click();
    await expect
      .poll(async () => Math.abs(luma(await pixelAt(page, MIDDLE)) - before.middle))
      .toBeLessThan(3);
    await page.getByRole("button", { name: "Show Radial 1" }).click();
    await expect
      .poll(async () => luma(await pixelAt(page, MIDDLE)))
      .toBeGreaterThan(before.middle + 20);
  });

  test("More controls reveals the five newer sliders, and shadows lift only inside the area", async ({
    page,
  }) => {
    await openLocal(page);
    const before = {
      middle: luma(await pixelAt(page, MIDDLE)),
      corner: luma(await pixelAt(page, CORNER)),
    };
    await page.getByRole("button", { name: "Radial", exact: true }).click();

    for (const name of ["Exposure", "Contrast", "Saturation", "Temperature"]) {
      await expect(page.getByRole("slider", { name })).toBeVisible();
    }
    await expect(page.getByRole("slider", { name: "Shadows" })).toHaveCount(0);

    await page.getByRole("button", { name: "More controls (5)" }).click();
    for (const name of ["Highlights", "Shadows", "Tint", "Clarity", "Sharpness"]) {
      await expect(page.getByRole("slider", { name })).toBeVisible();
    }
    // Sharpness starts at 0 and has no negative side.
    await expect(page.getByRole("slider", { name: "Sharpness" })).toHaveAttribute("min", "0");

    const shadows = page.getByRole("slider", { name: "Shadows" });
    await shadows.focus();
    await page.keyboard.press("End");
    await expect
      .poll(async () => luma(await pixelAt(page, MIDDLE)))
      .toBeGreaterThan(before.middle + 8);
    expect(Math.abs(luma(await pixelAt(page, CORNER)) - before.corner)).toBeLessThan(3);

    // Closing the section hides the sliders but keeps the values (and shows a dot).
    await page.getByRole("button", { name: /Fewer controls/ }).click();
    await expect(page.getByRole("slider", { name: "Shadows" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /More controls/ })).toContainText("•");
    await expect
      .poll(async () => luma(await pixelAt(page, MIDDLE)))
      .toBeGreaterThan(before.middle + 8);
  });

  test("dragging the centre handle moves the area, and one undo puts it back", async ({ page }) => {
    await openLocal(page);
    await page.getByRole("button", { name: "Radial", exact: true }).click();

    const centre = handle(page, "centre");
    const start = (await centre.boundingBox())!;
    const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 20, { steps: 6 });
    await page.mouse.move(from.x + 120, from.y + 40, { steps: 6 });
    await page.mouse.up();

    const moved = (await centre.boundingBox())!;
    expect(moved.x - start.x).toBeGreaterThan(80);

    // The whole drag is one undo step.
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => Math.abs((await centre.boundingBox())!.x - start.x))
      .toBeLessThan(2);
  });

  test("arrow keys nudge a focused handle", async ({ page }) => {
    await openLocal(page);
    await page.getByRole("button", { name: "Linear", exact: true }).click();

    const end = handle(page, "end");
    const before = (await end.boundingBox())!;
    await end.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await end.boundingBox())!.x - before.x).toBeGreaterThan(5);
  });

  test("the list can rename, duplicate, invert and reorder areas from the keyboard", async ({
    page,
  }) => {
    await openLocal(page);
    await page.getByRole("button", { name: "Radial", exact: true }).click();
    await page.getByRole("button", { name: "Linear", exact: true }).click();
    const list = page.getByRole("list", { name: "Areas" });
    await expect(list.getByRole("listitem")).toHaveCount(2);

    // Rename the active (linear) area.
    await page.getByRole("button", { name: "Rename area" }).click();
    await page.keyboard.type("Sky");
    await page.keyboard.press("Enter");
    await expect(list.getByRole("button", { name: "Sky", exact: true })).toBeVisible();

    // Move it up: it becomes the first item.
    await page.getByRole("button", { name: "Move area up" }).click();
    await expect(list.getByRole("listitem").first()).toContainText("Sky");
    await expect(page.getByRole("button", { name: "Move area up" })).toBeDisabled();

    await page.getByRole("button", { name: "Invert area" }).click();
    await expect(page.getByRole("button", { name: "Invert area" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(list.getByRole("listitem").first()).toContainText("(inverted)");

    await page.getByRole("button", { name: "Duplicate area" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(3);
    // The copy keeps the original's inverted state, so its name reads "Sky copy (inverted)".
    const copy = list.getByRole("listitem").filter({ hasText: "Sky copy" });
    await expect(copy).toHaveCount(1);
    await expect(copy).toContainText("(inverted)");
  });

  test("areas survive a reload", async ({ page }) => {
    await openLocal(page);
    await page.getByRole("button", { name: "Radial", exact: true }).click();
    await page.getByRole("button", { name: "Linear", exact: true }).click();
    // Autosave is debounced by 800 ms.
    await page.waitForTimeout(1500);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Local", exact: true }).click();
    const list = page.getByRole("list", { name: "Areas" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("button", { name: "Radial 1", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Gradient 2", exact: true })).toBeVisible();
  });
});
