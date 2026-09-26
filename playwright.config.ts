import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Prefer a system Chromium (no browser download). CI can set TUNL_CHROMIUM or run `npx playwright install chromium`.
const systemChromium = ["/usr/bin/chromium-browser", "/usr/bin/chromium"].find((path) =>
  existsSync(path),
);
const executablePath = process.env.TUNL_CHROMIUM ?? systemChromium;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    locale: "en-US",
    colorScheme: "dark",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
