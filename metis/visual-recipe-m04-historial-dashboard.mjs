// Receta visual Metis · unidad m04-historial-dashboard
//
// Fotografía los estados de la unidad contra la aplicación real servida por
// Vite: Historial y Dashboard por oposición con la oposición consultada
// visible, estados vacíos, revisión histórica fijada tras cambiar de
// oposición, y navegación de vuelta al catálogo, a 1280 y a 390 px.
// La verificación usa dos oposiciones SOLO en fixture (Administrativo +
// Radiodiagnóstico ficticia) servidas desde la receta, sin credenciales ni
// llamadas a Supabase alojado. La receta solo navega y fotografía: no contiene
// aserciones y nunca importa los oráculos.
//
// El entorno de verificación ejecuta esta receta sobre una copia limpia del
// checkout, sin node_modules: la receta restaura primero las dependencias
// declaradas del repositorio (npm ci, preferentemente offline con la caché de
// npm) y solo después arranca el servidor y el navegador.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT || 4314);
const base = `http://127.0.0.1:${port}/aplicacion-sas/`;

if (!process.env.METIS_SHOT_KIT) {
  throw new Error("Falta METIS_SHOT_KIT: Metis debe proporcionar el kit de capturas.");
}

async function ensureDependencies() {
  const viteBin = path.join(repoRoot, "node_modules", ".bin", "vite");
  let playwrightReady = false;
  try {
    await import(pathToFileURL(path.join(repoRoot, "node_modules", "@playwright", "test", "index.js")));
    playwrightReady = true;
  } catch { playwrightReady = false; }
  if (playwrightReady && existsSync(viteBin)) return;
  const install = spawnSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: repoRoot,
    timeout: 300_000,
    stdio: "inherit",
  });
  if (install.status !== 0) {
    throw new Error(`No se pudieron restaurar las dependencias del repositorio (npm ci, estado ${install.status}).`);
  }
}

import { readFile } from "node:fs/promises";
await ensureDependencies();
const { chromium } = await import("@playwright/test");
const { watch, shot } = await import(process.env.METIS_SHOT_KIT);

// --- Fixture aislada: dos oposiciones publicadas ---------------------------------
const registryRows = [
  {
    exam_id: "fixture-adm-examen",
    exam_version_id: "version-fixture-adm-examen-v1",
    exam_version_path: "fixture-adm-examen/versions/version-fixture-adm-examen-v1.json",
    opposition_id: "administrativo",
    opposition_name: "Administrativo",
  },
  {
    exam_id: "fixture-rx-examen",
    exam_version_id: "version-fixture-rx-examen-v1",
    exam_version_path: "fixture-rx-examen/versions/version-fixture-rx-examen-v1.json",
    opposition_id: "rx-fixture",
    opposition_name: "Radiodiagnóstico (fixture)",
  },
];

function packageFor(examId, title) {
  const questions = Array.from({ length: 3 }, (_, index) => ({
    id: `${examId}-q${index + 1}`,
    sourceNumber: index + 1,
    active: true,
    text: `Pregunta ${index + 1} de ${title}`,
    options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }, { id: "C", text: "Tres" }],
    correctOption: "B",
  }));
  return {
    id: examId,
    title,
    durationMinutes: 90,
    version: { id: `version-${examId}-v1` },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 3, questionNumbers: [1, 2, 3] },
    questions,
  };
}

const admPackage = packageFor("fixture-adm-examen", "Examen Administrativo (fixture)");
const rxPackage = packageFor("fixture-rx-examen", "Examen Radiodiagnóstico (fixture)");
const attempts = [
  {
    id: "20000000-0000-4000-8000-0000000000ad",
    exam_id: admPackage.id,
    exam_version_id: admPackage.version.id,
    exam_version_path: `fixture-adm-examen/versions/${admPackage.version.id}.json`,
    question_ids: ["fixture-adm-examen-q1"],
    kind: "exam",
    strategy: "exam",
    status: "completed",
    origin: "official",
    opposition_id: "administrativo",
    created_at: "2026-11-17T09:00:00Z",
    completed_at: "2026-11-17T09:30:00Z",
    active_seconds: 0,
    exam_elapsed_ms: 1_800_000,
    score: 75,
    correct_answers: 0,
    wrong_answers: 1,
    blank_answers: 0,
    answered_questions: 1,
    failed_scope_exam_id: null,
    started_at: "2026-11-17T09:00:00Z",
    deadline_at: "2026-11-17T10:30:00Z",
  },
];
const fixtureUser = {
  id: "00000000-0000-4000-8000-0000000000f1",
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@metis.local",
  email_confirmed_at: new Date().toISOString(),
  phone: "",
  confirmed_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const dashboardFor = (oppositionId) => ({
  personal: {
    global: oppositionId === "administrativo"
      ? { answer_count: 2, accuracy: 50, study_active_seconds: 125, average_score: 75, best_score: 75, dominated_count: 0 }
      : { answer_count: 0, accuracy: 0, study_active_seconds: 0, average_score: null, best_score: null, dominated_count: 0 },
    official_exams: oppositionId === "administrativo"
      ? [{ exam_id: admPackage.id, attempt_count: 1, best_score: 75, average_score: 75, best_time_ms: 1_800_000, accuracy: 50, pending_failures: 0, dominated_count: 0, latest_attempt_at: attempts[0].completed_at, latest_attempt_status: "completed", latest_attempt_score: 75 }]
      : [],
    questions: oppositionId === "administrativo"
      ? [{ exam_id: admPackage.id, question_id: "fixture-adm-examen-q1", attempts: 1, correct: 0, wrong: 1, accuracy: 0, mastery: "pending" }]
      : [],
  },
  shared: oppositionId === "administrativo"
    ? {
        profiles: [
          { alias: "Participante 1", answer_count: 2, accuracy: 50, study_active_seconds: 125, average_score: 75, best_score: 75, dominated_count: 0 },
        ],
        official_exam_rankings: [{ exam_id: admPackage.id, alias: "Participante 1", score: 75, exam_elapsed_ms: 1_800_000, rank: 1 }],
        failed_by_all: [],
      }
    : { profiles: [], official_exam_rankings: [], failed_by_all: [] },
});

// Interceptor de red del navegador: hace de Supabase de fixture y sirve los
// paquetes JSON de las dos oposiciones que no existen en el banco real.
const initScript = `(() => {
  const fixture = ${JSON.stringify({ registryRows, attempts, admPackage, rxPackage, fixtureUser })};
  const originalFetch = window.fetch.bind(window);
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  window.fetch = async (input, init) => {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.origin);
      const path = url.pathname;
      if (path.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "password") {
        return json({
          access_token: "fixture-access-token",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "fixture-refresh-token",
          user: fixture.fixtureUser,
        });
      }
      if (path.includes("/rest/v1/rpc/get_published_official_exam_versions_v2")) {
        return json(fixture.registryRows);
      }
      if (path.includes("/rest/v1/rpc/get_opposition_dashboard_v2")) {
        const body = JSON.parse(init?.body || "{}");
        return json(body.p_opposition_id === "administrativo"
          ? ${JSON.stringify(dashboardFor("administrativo"))}
          : ${JSON.stringify(dashboardFor("rx-fixture"))});
      }
      if (path.includes("/rest/v1/rpc/get_server_now")) return json(new Date().toISOString());
      if (path.includes("/rest/v1/personal_attempt_history")) {
        const opposition = url.searchParams.get("opposition_id") || "";
        const wanted = opposition.split("eq.")[1] || "";
        return json(fixture.attempts.filter((attempt) => !wanted || attempt.opposition_id === wanted));
      }
      if (path.includes("/rest/v1/attempts") || path.includes("/rest/v1/question_progress")) return json([]);
      if (path.includes("/rest/v1/attempt_question_sources")) return json([]);
      if (path.includes("/rest/v1/attempt_answers")) {
        return json([{
          id: "30000000-0000-4000-8000-0000000000ad",
          question_id: "fixture-adm-examen-q1",
          answer_sequence: 1,
          selected_option: "A",
          correct_option: "B",
          is_correct: false,
          confirmed_at: "2026-11-17T09:01:00Z",
        }]);
      }
      if (path.endsWith("/data/exams/catalog.json")) {
        return json({
          exams: fixture.registryRows.map((row) => ({
            id: row.exam_id,
            title: row.exam_id === fixture.admPackage.id ? fixture.admPackage.title : fixture.rxPackage.title,
            latestVersion: row.exam_version_id,
            latestPath: row.exam_version_path,
          })),
        });
      }
      if (path.endsWith("/" + fixture.registryRows[0].exam_version_path)) return json(fixture.admPackage);
      if (path.endsWith("/" + fixture.registryRows[1].exam_version_path)) return json(fixture.rxPackage);
    } catch {}
    return originalFetch(input, init);
  };
})();`;

async function startServer() {
  const viteBin = path.join(repoRoot, "node_modules", ".bin", "vite");
  const child = spawn(
    viteBin,
    ["--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: "1",
        VITE_SUPABASE_URL: base,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_metis_fixture",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor Vite no arrancó en el puerto ${port}: ${stderr.slice(-800)}`);
    }
    try {
      const response = await fetch(base);
      if (response.ok) return child;
    } catch { /* aún no está listo */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill("SIGKILL");
  throw new Error(`El servidor Vite no respondió a tiempo en el puerto ${port}: ${stderr.slice(-800)}`);
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch {
    spawnSync(
      process.execPath,
      [path.join(repoRoot, "node_modules", "playwright", "cli.js"), "install", "chromium"],
      { cwd: repoRoot, stdio: "inherit", timeout: 240_000 },
    );
    return await chromium.launch();
  }
}

let server;
let browser;
try {
  server = await startServer();
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(45_000);
  await page.addInitScript(initScript);
  await watch(page);

  await page.goto(`${base}#catalog`);
  await page.getByLabel("Correo electrónico").fill("fixture@metis.local");
  await page.getByLabel("Contraseña").fill("Fixture-Metis-2026");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("heading", { name: "Examen Administrativo (fixture)" }).waitFor({ state: "visible" });

  // Historial de la oposición consultada (1280).
  await page.getByRole("button", { name: "Historial" }).click();
  await page.locator("#history-opposition", { hasText: "Oposición consultada: Administrativo" }).waitFor({ state: "visible" });
  await page.locator(".history-entry").first().waitFor({ state: "visible" });
  await shot(page, "historial-administrativo-1280");

  // Revisión histórica fijada (1280).
  await page.locator("#history-list .history-entry button", { hasText: "Abrir en solo lectura" }).first().click();
  await page.locator("#history-detail-version", { hasText: "Versión histórica fijada:" }).waitFor({ state: "visible" });
  await shot(page, "historial-detalle-fijado-1280");

  // Dashboard de la oposición consultada (1280).
  await page.locator("#history-detail-back").click();
  await page.locator("#history-catalog-button").click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.locator("#dashboard-opposition", { hasText: "Oposición consultada: Administrativo" }).waitFor({ state: "visible" });
  await page.locator("#dashboard-shared", { hasText: "Participante 1" }).waitFor({ state: "visible" });
  await shot(page, "dashboard-administrativo-1280");

  // Oposición vacía en la segunda selección (1280): Historial y Dashboard.
  await page.locator("#dashboard-catalog-button").click();
  await page.getByLabel("Oposición").selectOption({ label: "Radiodiagnóstico (fixture)" });
  await page.locator("#exam-grid", { hasText: "Examen Radiodiagnóstico (fixture)" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Historial" }).click();
  await page.locator("#history-opposition", { hasText: "Oposición consultada: Radiodiagnóstico (fixture)" }).waitFor({ state: "visible" });
  await page.locator("#history-status", { hasText: "Todavía no hay intentos persistidos" }).waitFor({ state: "visible" });
  await shot(page, "historial-vacio-radiodiagnostico-1280");

  await page.locator("#history-catalog-button").click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.locator("#dashboard-opposition", { hasText: "Oposición consultada: Radiodiagnóstico (fixture)" }).waitFor({ state: "visible" });
  await page.locator("#dashboard-exams", { hasText: "todavía no tiene exámenes oficiales publicados" }).waitFor({ state: "visible" });
  await shot(page, "dashboard-vacio-radiodiagnostico-1280");

  // Enlace directo de un intento de otra oposición: revisión fijada (1280).
  // La aplicación enruta al cargar: el enlace directo entra por recarga real.
  await page.evaluate(() => { window.location.hash = "history=20000000-0000-4000-8000-0000000000ad"; });
  await page.reload();
  await page.locator("#history-detail-version", { hasText: "Versión histórica fijada:" }).waitFor({ state: "visible" });
  await shot(page, "revision-enlace-directo-1280");

  // Estados a 390 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#history-detail-back").click();
  await page.locator("#history-catalog-button").click();
  await page.getByRole("button", { name: "Historial" }).click();
  await page.locator("#history-opposition", { hasText: "Oposición consultada: Radiodiagnóstico (fixture)" }).waitFor({ state: "visible" });
  await shot(page, "historial-vacio-390");

  await page.locator("#history-catalog-button").click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.locator("#dashboard-opposition", { hasText: "Oposición consultada: Radiodiagnóstico (fixture)" }).waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await shot(page, "dashboard-390");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  setTimeout(() => server?.kill("SIGKILL"), 3_000)?.unref?.();
}
