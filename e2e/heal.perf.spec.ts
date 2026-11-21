import { expect, test, type Page } from "@playwright/test";
import { BLEMISH, openTestPhoto, screenPoint } from "./helpers";

/**
 * What Heal costs in a real browser, on a 12-megapixel photo (4000 x 3000).
 *
 * The point is the numbers, which the test prints (and attaches to the report) so they can go in
 * the roadmap and be compared between browsers. The assertions are loose guards, about ten times
 * what a desktop browser should take, that only catch something pathological. Profiling and the
 * main-thread renderer are switched on before the page loads: the Worker has no window, so its
 * stage timings would not reach the harness (the same as `?profile&noworker`).
 */

type Row = { stage: string; median: number; p95: number; samples: number };

declare global {
  interface Window {
    __pictoeProfile: { summary: () => Row[]; reset: () => void };
  }
}

const summary = (page: Page) => page.evaluate(() => window.__pictoeProfile.summary());
const reset = (page: Page) => page.evaluate(() => window.__pictoeProfile.reset());
const sampleCount = async (page: Page, stage: string) =>
  (await summary(page)).find((r) => r.stage === stage)?.samples ?? 0;

function report(name: string, rows: Row[]) {
  const wanted = rows.filter((r) => r.stage.startsWith("heal") || r.stage === "total");
  const text = wanted
    .map(
      (r) =>
        `  ${r.stage.padEnd(26)} median ${String(r.median).padStart(7)} ms   p95 ${String(r.p95).padStart(7)} ms   n=${r.samples}`,
    )
    .join("\n");
  console.log(`\nHEAL PROFILE: ${name}\n${text}\n`);
  test
    .info()
    .annotations.push({ type: `heal profile: ${name}`, description: JSON.stringify(wanted) });
}

const row = (rows: Row[], stage: string) => rows.find((r) => r.stage === stage);

test("tap, drag and a big-brush tap on a 12 MP photo", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem("pictoeProfile", "1");
    localStorage.setItem("pictoeWorker", "0");
  });
  await openTestPhoto(page, 4000, 3000);
  await page.getByRole("button", { name: "Heal", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Heal", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  const at = await screenPoint(page, BLEMISH);

  // 1. A tap with the default brush (radius 120 px on this photo). The first one also makes the
  //    full-size copy of the photo that dabs paint on.
  await reset(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => sampleCount(page, "heal dab (each)")).toBeGreaterThanOrEqual(1);
  const tap = await summary(page);
  report("first tap, default brush (includes making the surface)", tap);
  expect(row(tap, "heal: find source")?.samples).toBe(1);
  expect(row(tap, "heal surface (create)")?.samples).toBe(1);
  expect(row(tap, "heal: find source")!.median).toBeLessThan(2000);
  expect(row(tap, "heal surface (create)")!.median).toBeLessThan(15_000);
  expect(row(tap, "heal dab (each)")!.p95).toBeLessThan(2000);

  // 2. A drag of 200 screen px (about 1,000 photo px, so ~33 dabs at a quarter-radius spacing).
  await reset(page);
  await page.mouse.move(at.x - 100, at.y + 60);
  await page.mouse.down();
  for (let dx = -100; dx <= 100; dx += 10) await page.mouse.move(at.x + dx, at.y + 60);
  await page.mouse.up();
  await expect.poll(() => sampleCount(page, "heal dab (each)")).toBeGreaterThanOrEqual(5);
  await page.waitForTimeout(800); // let the last renders finish
  const drag = await summary(page);
  report("drag, default brush", drag);
  expect(row(drag, "heal: find source")?.samples).toBe(1); // one source per drag
  expect(row(drag, "heal dab (each)")!.p95).toBeLessThan(2000);
  expect(row(drag, "heal dabs (batch)")!.p95).toBeLessThan(5000);
  // No surface was rebuilt for more dabs on the end: that is the cache's append path.
  expect(row(drag, "heal surface (create)")).toBeUndefined();

  // 3. A tap with the biggest brush (radius 300 px on this photo): the worst realistic dab.
  await page.getByRole("slider", { name: "Brush size" }).fill("100");
  await reset(page);
  await page.mouse.click(at.x - 200, at.y + 150);
  await expect.poll(() => sampleCount(page, "heal dab (each)")).toBeGreaterThanOrEqual(1);
  const big = await summary(page);
  report("tap, biggest brush", big);
  expect(row(big, "heal: find source")!.median).toBeLessThan(3000);
  expect(row(big, "heal dab (each)")!.p95).toBeLessThan(4000);
});
