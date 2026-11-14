// Receta visual Metis · unidad m03-artificial-oposicion
//
// Fotografía los estados de la unidad contra la aplicación real servida por Vite.
// La verificación usa dos oposiciones publicadas SOLO en fixture aislada
// (Administrativo real del catálogo estático + una oposición Radiodiagnóstico
// ficticia con solo 74 preguntas activas, servida desde la receta), sin tocar
// producción ni los archivos del banco. La receta solo navega y fotografía: no
// contiene aserciones.
//
// El entorno de verificación ejecuta esta receta sobre una copia limpia del
// checkout, sin node_modules: la receta restaura primero las dependencias
// declaradas del repositorio (npm ci, preferentemente offline con la caché de
// npm) y solo después arranca el servidor y el navegador.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT || 4312);
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

await ensureDependencies();
const { chromium } = await import("@playwright/test");
const { watch, shot } = await import(process.env.METIS_SHOT_KIT);

// --- Fixture aislada: dos oposiciones publicadas ---------------------------------
const staticCatalog = JSON.parse(
  await readFile(path.join(repoRoot, "app/public/data/exams/catalog.json"), "utf8"),
);
const registryRows = staticCatalog.exams.map((entry) => ({
  exam_id: entry.id,
  exam_version_id: entry.latestVersion,
  exam_version_path: entry.latestPath,
  opposition_id: "administrativo",
  opposition_name: "Administrativo",
}));

// La oposición ficticia tiene solo 74 preguntas activas: el Examen artificial
// debe aparecer bloqueado en su propia oposición sin completar con otro banco.
const rxExamId = "sas-radiodiagnostico-fixture-2026";
const rxVersionPath = `${rxExamId}/versions/version-rx-fixture.json`;
const rxQuestions = Array.from({ length: 74 }, (_, index) => ({
  id: `${rxExamId}-q${String(index + 1).padStart(3, "0")}`,
  sourceNumber: index + 1,
  active: true,
  text: `Pregunta ${index + 1} de Radiodiagnóstico (fixture)`,
  options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }, { id: "C", text: "Tres" }],
  correctOption: "B",
}));
const rxPackage = {
  id: rxExamId,
  title: "SAS Radiodiagnóstico 2026 (fixture)",
  durationMinutes: 120,
  version: { id: "version-rx-fixture" },
  qa: { state: "publicable" },
  scorableSet: { state: "resolved", count: rxQuestions.length, questionNumbers: rxQuestions.map(({ sourceNumber }) => sourceNumber) },
  questions: rxQuestions,
};
registryRows.push({
  exam_id: rxExamId,
  exam_version_id: rxPackage.version.id,
  exam_version_path: rxVersionPath,
  opposition_id: "radiodiagnostico",
  opposition_name: "Radiodiagnóstico",
});

const rxSourceRows = rxQuestions.map((question, position) => ({
  position,
  exam_id: rxExamId,
  exam_version_id: rxPackage.version.id,
  exam_version_path: rxVersionPath,
  question_id: `artificial-q${String(position + 1).padStart(3, "0")}`,
  source_question_id: question.id,
}));

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

// Interceptor de red del navegador: hace de Supabase de fixture y sirve el
// paquete JSON de la oposición Radiodiagnóstico que no existe en el banco real.
// El RPC del artificial se responde con el intento materializado de la
// selección enviada por el cliente (75 fuentes de la oposición solicitada).
const initScript = `(() => {
  const fixture = ${JSON.stringify({
    registryRows,
    rxVersionPath,
    rxPackage,
    rxSourceRows,
    fixtureUser,
    staticCatalog,
  })};
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
      if (path.includes("/rest/v1/rpc/get_server_now")) {
        return json(new Date().toISOString());
      }
      let artificialSources = null;
      if (path.includes("/rest/v1/rpc/start_or_resume_artificial_attempt_v2")) {
        const payload = JSON.parse((init && init.body) || "{}");
        if (payload.p_opposition_id !== "administrativo" || (payload.p_sources || []).length !== 75) {
          return json({ message: "La selección del Examen artificial debe pertenecer íntegramente a la oposición solicitada." }, 400);
        }
        const startedAt = new Date();
        artificialSources = payload.p_sources.map((source, position) => ({
          position,
          exam_id: source.exam_id,
          exam_version_id: source.exam_version_id,
          exam_version_path: source.exam_version_path,
          question_id: "artificial-q" + String(position + 1).padStart(3, "0"),
          source_question_id: source.source_question_id,
        }));
        window.__fixtureArtificialSources = artificialSources;
        return json({
          id: "60000000-0000-4000-8000-0000000000f1",
          user_id: fixture.fixtureUser.id,
          exam_id: "__artificial__",
          exam_version_id: "materialized-fixture",
          exam_version_path: "artificial/materialized-fixture.json",
          question_ids: artificialSources.map(({ question_id: questionId }) => questionId),
          kind: payload.p_mode === "exam" ? "exam" : "normal",
          origin: "artificial",
          principal: false,
          strategy: payload.p_mode === "exam" ? "artificial_exam" : "artificial_study",
          status: "active",
          current_position: 0,
          active_seconds: 0,
          is_paused: false,
          duration_minutes: payload.p_mode === "exam" ? 120 : null,
          started_at: payload.p_mode === "exam" ? startedAt.toISOString() : null,
          deadline_at: payload.p_mode === "exam"
            ? new Date(startedAt.getTime() + 120 * 60_000).toISOString()
            : null,
          server_now: startedAt.toISOString(),
        });
      }
      if (path.includes("/rest/v1/attempt_question_sources")) {
        return json(window.__fixtureArtificialSources || []);
      }
      if (path.includes("/rest/v1/attempts") || path.includes("/rest/v1/question_progress") || path.includes("/rest/v1/attempt_answers")) {
        return json([]);
      }
      if (path.endsWith("/data/exams/catalog.json")) {
        return json({
          ...fixture.staticCatalog,
          exams: [...fixture.staticCatalog.exams, {
            id: fixture.rxPackage.id,
            title: fixture.rxPackage.title,
            latestVersion: fixture.rxPackage.version.id,
            latestPath: fixture.rxVersionPath,
          }],
        });
      }
      if (path.endsWith("/" + fixture.rxVersionPath)) {
        return json(fixture.rxPackage);
      }
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

  // Estado 1 · Administrativo (pool con más de 75): el artificial está disponible.
  await page.goto(`${base}#catalog`);
  await page.getByLabel("Correo electrónico").fill("fixture@metis.local");
  await page.getByLabel("Contraseña").fill("Fixture-Metis-2026");
  await page.getByRole("button", { name: "Entrar" }).click();

  const selector = page.getByLabel("Oposición");
  await selector.waitFor({ state: "visible" });
  await page
    .getByRole("heading", { name: "SAS Administrativo/a 2023 - Turno Libre" })
    .waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Generar en Modo estudio" })
    .waitFor({ state: "visible" });
  await shot(page, "catalogo-artificial-administrativo");

  // Estado 2 · Radiodiagnóstico (pool de 74): el artificial aparece bloqueado
  // en su propia oposición y sin completar con otro banco.
  await page.locator("#opposition-select").selectOption({ label: "Radiodiagnóstico" });
  await page
    .getByRole("heading", { name: "SAS Radiodiagnóstico 2026 (fixture)" })
    .waitFor({ state: "visible" });
  await page
    .locator("#artificial-error", { hasText: "La oposición seleccionada no contiene al menos 75 Preguntas activas distintas." })
    .waitFor({ state: "visible" });
  await shot(page, "catalogo-artificial-bloqueado-radiodiagnostico");

  // Estado 3 · Administrativo: el artificial de estudio entra con 75 preguntas.
  await page.locator("#opposition-select").selectOption({ label: "Administrativo" });
  await page
    .getByRole("button", { name: "Generar en Modo estudio" })
    .click();
  await page.locator("#study-panel").waitFor({ state: "visible" });
  await page.locator("#study-progress", { hasText: "1 de 75" }).waitFor({ state: "visible" });
  await shot(page, "artificial-estudio-75-preguntas");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  setTimeout(() => server?.kill("SIGKILL"), 3_000)?.unref?.();
}
