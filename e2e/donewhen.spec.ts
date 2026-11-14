import { expect, test, type Page } from "@playwright/test";
import { BLEMISH, SOURCE, openTestPhoto, pixelAt, screenPoint } from "./helpers";

/**
 * Milestone 8's "done when", as one story on the test photo:
 *
 *   a user can brighten a face with a radial mask, cool a sky with a gradient, and fine-tune
 *   greens with hue/saturation/luminance, all non-destructively and all surviving a reload.
 *
 * The test photo has no face, sky or foliage, so stand-ins are used: the red circle is the
 * "face", the plain blue top of the picture is the "sky" and the green square is the "greens".
 * "Ground" is a patch of plain background far from every edit, which must never change.
 */
const FACE = BLEMISH; // red circle, rgb(230, 30, 30)
const SKY = { x: 0.5, y: 0.1 } as const; // plain blue, rgb(90, 140, 200)
const GREENS = SOURCE; // green square, rgb(40, 200, 60)
const GROUND = { x: 0.1, y: 0.95 } as const;

type Rgb = number[];
type Snapshot = Record<"face" | "sky" | "greens" | "ground", Rgb>;

const snapshot = async (page: Page): Promise<Snapshot> => ({
  face: await pixelAt(page, FACE),
  sky: await pixelAt(page, SKY),
  greens: await pixelAt(page, GREENS),
  ground: await pixelAt(page, GROUND),
});

/** Total difference over the three channels. */
const apart = (a: Rgb, b: Rgb) => a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0);

/** Waits until a pixel is within `tolerance` (summed over channels) of `want`. */
const expectPixel = (page: Page, at: { x: number; y: number }, want: Rgb, tolerance: number) =>
  expect.poll(async () => apart(await pixelAt(page, at), want)).toBeLessThanOrEqual(tolerance);

/** Drags one of the gradient handles to a spot on the photo (fractions of the image). */
async function dragHandleTo(page: Page, id: string, to: { x: number; y: number }) {
  const box = (await page.locator(`button[data-handle="${id}"]`).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const target = await screenPoint(page, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + target.x) / 2, (from.y + target.y) / 2, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
}

const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const slider = (page: Page, name: string) => page.getByRole("slider", { name });

async function openMixerBand(page: Page, band: string) {
  await tool(page, "Color").click();
  await page.getByRole("button", { name: /More controls/ }).click();
  await page.getByRole("button", { name: new RegExp(`^${band}( \\(adjusted\\))?$`) }).click();
}

test("brighten a face, cool a sky and tune the greens, all non-destructively and across a reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openTestPhoto(page);
  const original = await snapshot(page);
  expect(original.face[0]).toBeGreaterThan(200); // really the red circle
  expect(original.greens[1]).toBeGreaterThan(150); // really the green square

  // 1. Brighten the face with a radial area: move it onto the face, then raise exposure.
  await tool(page, "Local").click();
  await tool(page, "Radial").click();
  await dragHandleTo(page, "centre", FACE);
  await slider(page, "Exposure").focus();
  await page.keyboard.press("End");

  // The circle's green channel goes from 30 to about 46 at full strength.
  await expect
    .poll(async () => (await pixelAt(page, FACE))[1]!)
    .toBeGreaterThan(original.face[1]! + 8);
  await expectPixel(page, GROUND, original.ground, 3);

  // 2. Cool the sky with a gradient: from the top edge (full effect) down to 60% (none).
  await tool(page, "Linear").click();
  await dragHandleTo(page, "start", { x: 0.5, y: 0.03 });
  await dragHandleTo(page, "end", { x: 0.5, y: 0.6 });
  await slider(page, "Temperature").focus();
  await page.keyboard.press("Home");

  // Cooling lowers red and raises blue (about -10 and +8 here, a bit more at the very top).
  await expect.poll(async () => (await pixelAt(page, SKY))[0]!).toBeLessThan(original.sky[0]! - 4);
  expect((await pixelAt(page, SKY))[2]!).toBeGreaterThan(original.sky[2]! + 4);
  await expectPixel(page, GROUND, original.ground, 3);

  // 3. Fine-tune the greens: hue first, then saturation and luminance.
  await openMixerBand(page, "Green");
  const beforeMixer = await pixelAt(page, GREENS);
  await slider(page, "Green hue").focus();
  await page.keyboard.press("End");
  // Green turns towards cyan, so blue rises a lot.
  await expect
    .poll(async () => (await pixelAt(page, GREENS))[2]!)
    .toBeGreaterThan(beforeMixer[2]! + 40);

  const afterHue = await pixelAt(page, GREENS);
  await slider(page, "Green saturation").focus();
  await page.keyboard.press("End");
  await expect.poll(async () => apart(await pixelAt(page, GREENS), afterHue)).toBeGreaterThan(6);

  const afterSat = await pixelAt(page, GREENS);
  await slider(page, "Green luminance").focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => apart(await pixelAt(page, GREENS), afterSat)).toBeGreaterThan(6);

  // Nothing leaked into the plain background.
  await expectPixel(page, GROUND, original.ground, 3);
  const edited = await snapshot(page);
  expect(apart(edited.face, original.face)).toBeGreaterThan(10);
  expect(apart(edited.sky, original.sky)).toBeGreaterThan(10);
  expect(apart(edited.greens, original.greens)).toBeGreaterThan(40);

  // 4. Reload. Autosave is debounced by 800 ms; wait it out, then check everything came back.
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('canvas[aria-label*="image"]')).toBeVisible();
  for (const key of ["face", "sky", "greens", "ground"] as const) {
    const at = { face: FACE, sky: SKY, greens: GREENS, ground: GROUND }[key];
    await expectPixel(page, at, edited[key], 9);
  }

  // The areas are still listed, and the mixer still holds its three values.
  await tool(page, "Local").click();
  const areas = page.getByRole("list", { name: "Areas" });
  await expect(areas.getByRole("listitem")).toHaveCount(2);
  await expect(areas.getByRole("button", { name: "Radial 1", exact: true })).toBeVisible();
  await expect(areas.getByRole("button", { name: "Gradient 2", exact: true })).toBeVisible();

  await openMixerBand(page, "Green");
  await expect(slider(page, "Green hue")).toHaveValue("100");
  await expect(slider(page, "Green saturation")).toHaveValue("100");
  await expect(slider(page, "Green luminance")).toHaveValue("-100");

  // 5. Non-destructive: switching both areas off gives the original face and sky back.
  await tool(page, "Local").click();
  await page.getByRole("button", { name: "Hide Radial 1" }).click();
  await page.getByRole("button", { name: "Hide Gradient 2" }).click();
  await expectPixel(page, FACE, original.face, 9);
  await expectPixel(page, SKY, original.sky, 9);
  await expectPixel(page, GROUND, original.ground, 3);
});
