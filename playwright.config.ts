import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real app in Chromium. Run them with `bun run e2e` (or `npm run e2e`);
 * the first time, install the browser with `npx playwright install chromium`.
 * PW_NO_SANDBOX=1 is only for containers that run Chromium as root.
 *
 * `npm run e2e:devices` runs the tests in e2e/devices/ instead, on WebKit (the engine behind
 * Safari), an iPhone profile (WebKit with a phone screen and touch) and a Pixel profile (Chromium
 * with a phone screen and touch). Install the browsers first: `npx playwright install webkit chromium`.
 * These are emulations, not real devices: they match the engine, screen size and input type, but
 * not a phone's memory limits, GPU or real fingers, so a real-device check is still worth doing.
 */
const devicesMode = !!process.env["PW_DEVICES"];
const deviceTests = /devices\/.*\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  ...(process.env["CI"] ? { workers: 2 } : {}),
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: process.env["PW_NO_SANDBOX"] ? ["--no-sandbox"] : [] },
  },
  projects: devicesMode
    ? [
        { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: deviceTests },
        { name: "iphone", use: { ...devices["iPhone 14"] }, testMatch: deviceTests },
        { name: "pixel", use: { ...devices["Pixel 7"] }, testMatch: deviceTests },
      ]
    : [{ name: "chromium", testIgnore: deviceTests }],
  webServer: {
    // npm runs package scripts everywhere (laptops and CI), whichever tool installed the packages.
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
