import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests against a running app with the fictitious demo
 * seed (`pnpm db:seed:demo`). Set E2E_BASE_URL to test an existing server;
 * otherwise `pnpm start` is launched (build first).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "pnpm start", url: `${baseURL}/login`, reuseExistingServer: true, timeout: 120_000 },
});
