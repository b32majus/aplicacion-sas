import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

Object.assign(process.env, loadEnv("e2e", process.cwd(), ""));

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SAS_TEST_EMAIL",
  "SAS_TEST_PASSWORD",
  "SAS_TEST_EMAIL_2",
  "SAS_TEST_PASSWORD_2",
  "SAS_TEST_EMAIL_3",
  "SAS_TEST_PASSWORD_3",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Falta configuración E2E local: ${missing.join(", ")}`);
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4183/aplicacion-sas/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 4183 --strictPort",
    url: "http://127.0.0.1:4183/aplicacion-sas/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
