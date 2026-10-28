import { expect, type Page } from "@playwright/test";

/** Where things are in the test photo, as fractions of the image (x, y). */
export const BLEMISH = { x: 0.8, y: 0.3 } as const; // red circle, radius 40px
export const SOURCE = { x: 0.2, y: 0.7 } as const; // clean green square to copy from

export const IMAGE = 'canvas[aria-label*="image"]';

/** Draws an 800×600 test photo in the browser and returns it as a PNG, so no binary is committed. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ blemish, source }) => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      const g = c.getContext("2d")!;
      g.fillStyle = "rgb(90,140,200)";
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = "rgb(40,200,60)";
      g.fillRect(source.x * 800 - 30, source.y * 600 - 30, 60, 60);
      g.fillStyle = "rgb(230,30,30)";
      g.beginPath();
      g.arc(blemish.x * 800, blemish.y * 600, 40, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL("image/png").split(",")[1] ?? "";
    },
    { blemish: BLEMISH, source: SOURCE },
  );
  return Buffer.from(base64, "base64");
}

/** Opens the app, imports the test photo, and waits until it is on the canvas. */
export async function openTestPhoto(page: Page) {
  // Wait for the server-rendered page to hydrate, or the file input has no handler yet.
  await page.goto("/", { waitUntil: "networkidle" });
  const buffer = await makePng(page);
  await page.setInputFiles("input[type=file]", { name: "test.png", mimeType: "image/png", buffer });
  await expect(page.locator(IMAGE)).toBeVisible();
  await expect.poll(() => redPixels(page)).toBeGreaterThan(1000);
}

/** RGB of the canvas pixel at a fraction (x, y) of the current frame. */
export function pixelAt(page: Page, at: { x: number; y: number }) {
  return page.evaluate(
    ({ at, sel }) => {
      const c = document.querySelector<HTMLCanvasElement>(sel)!;
      const x = Math.min(c.width - 1, Math.floor(at.x * c.width));
      const y = Math.min(c.height - 1, Math.floor(at.y * c.height));
      return Array.from(c.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3));
    },
    { at, sel: IMAGE },
  );
}

/** How many red pixels the canvas holds, as a fraction of all pixels (independent of resolution). */
export function redFraction(page: Page) {
  return page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel)!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r = 0, g = 0, b = 0] = [d[i], d[i + 1], d[i + 2]];
      if (r > 180 && g < 90 && b < 90) n++;
    }
    return n / (c.width * c.height);
  }, IMAGE);
}

export const redPixels = async (page: Page) => Math.round((await redFraction(page)) * 800 * 600);

export const isGreen = ([r = 0, g = 0, b = 0]: number[]) => g > 150 && r < 120 && b < 130;

/** Screen position of a fraction (x, y) of the displayed image. */
export async function screenPoint(page: Page, at: { x: number; y: number }) {
  const box = (await page.locator(IMAGE).boundingBox())!;
  return { x: box.x + at.x * box.width, y: box.y + at.y * box.height };
}

/** The canvas re-renders at a slightly different resolution when a panel opens, so compare red
 *  coverage within a few percent instead of exact pixel counts. */
export const roughly = (a: number, b: number) => Math.abs(a - b) / b < 0.05;
