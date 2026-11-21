import { defineConfig, devices } from "@playwright/test";

// Configuración Playwright del Tren B (unidades m04 y m05):
// pruebas de navegador EXCLUSIVAMENTE aisladas. No requiere credenciales ni
// acceso a Supabase alojado: cada spec intercepta toda la red con fixtures y
// arranca un Vite local sin variables de entorno sensibles. Ejecución:
//   npx playwright test --config tests/playwright-tren-b.config.js
//   npx playwright test exam-media --config tests/playwright-tren-b.config.js
//
// `opposition-history-dashboard.spec.js` es la spec heredada de M04; su
// interceptor no gestiona algunos POST legítimos de arranque, una laguna
// preexistente fuera de esta unidad. La spec nueva `exam-media.spec.js` sí los
// gestiona y pasa completa.

process.env.VITE_SUPABASE_URL ??= "http://127.0.0.1:4317/aplicacion-sas/";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_tren_b_fixture";

export default defineConfig({
  testDir: "e2e",
  testMatch: /(exam-media|opposition-history-dashboard)\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4317/aplicacion-sas/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 4317 --strictPort",
    url: "http://127.0.0.1:4317/aplicacion-sas/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
