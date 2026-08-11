import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "pwa.e2e.spec.js",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4191/aplicacion-sas/",
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run preview -- --port 4191 --strictPort",
    url: "http://127.0.0.1:4191/aplicacion-sas/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
