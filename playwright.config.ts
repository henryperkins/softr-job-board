import { defineConfig } from "@playwright/test";
const origin = `http://localhost:${process.env.SYNTHETIC_PORT ?? 8787}`;
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: origin,
    browserName: "chromium",
    trace: "off",
  },
  webServer: {
    command: "pnpm preview:synthetic",
    url: origin + "/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  reporter: "list",
});
