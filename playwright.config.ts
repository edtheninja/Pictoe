import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real app in Chromium. Run them with `bun run e2e` (or `npm run e2e`);
 * the first time, install the browser with `npx playwright install chromium`.
 * PW_NO_SANDBOX=1 is only for containers that run Chromium as root.
 */
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
  webServer: {
    command: "bun run dev --host 127.0.0.1",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
