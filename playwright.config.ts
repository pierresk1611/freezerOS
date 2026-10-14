import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: { executablePath: process.env.FREEZER_CHROMIUM_PATH },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
  projects: [360, 390, 768, 1280, 1440].map((width) => ({
    name: String(width),
    use: { viewport: { width, height: 850 } },
  })),
});
