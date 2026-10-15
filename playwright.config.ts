import { defineConfig } from "@playwright/test";
const port = Number(process.env.FREEZER_TEST_PORT ?? 3001);
export default defineConfig({
  testDir: "tests/e2e",
  workers: process.env.CI ? 2 : 3,
  expect: { timeout: 10000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath: process.env.FREEZER_CHROMIUM_PATH },
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  projects: [360, 390, 768, 1280, 1440, 1536].map((width) => ({
    name: String(width),
    use: { viewport: { width, height: 850 } },
  })),
});
