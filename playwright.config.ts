import { defineConfig } from "@playwright/test";

const baseURL = process.env.TARGET_URL ?? "https://example.com";
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    ...(channel ? { channel } : {}),
  },
});
