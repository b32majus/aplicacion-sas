// Receta visual Metis · unidad m01-oposicion-oficial
//
// Fotografía los estados de la unidad contra la aplicación real servida por Vite.
// La verificación usa dos oposiciones publicadas SOLO en fixture aislada
// (Administrativo real del catálogo estático + una oposición Radiodiagnóstico
// ficticia servida desde la receta), sin tocar producción ni los archivos del banco.
// La receta solo navega y fotografía: no contiene aserciones.
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
const port = Number(process.env.E2E_PORT || 4310);
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

const rxExamId = "sas-radiodiagnostico-fixture-2026";
const rxVersionPath = `${rxExamId}/versions/version-rx-fixture.json`;
const rxPackage = (() => {
  const questions = Array.from({ length: 75 }, (_, index) => ({
    id: `${rxExamId}-q${String(index + 1).padStart(3, "0")}`,
    sourceNumber: index + 1,
    active: true,
    text: `Pregunta ${index + 1} de Radiodiagnóstico (fixture)`,
    options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }, { id: "C", text: "Tres" }],
    correctOption: "B",
  }));
  return {
    id: rxExamId,
    title: "SAS Radiodiagnóstico 2026 (fixture)",
    durationMinutes: 120,
    version: { id: "version-rx-fixture" },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 75, questionNumbers: questions.map(({ sourceNumber }) => sourceNumber) },
    questions,
  };
})();
registryRows.push({
  exam_id: rxExamId,
  exam_version_id: rxPackage.version.id,
  exam_version_path: rxVersionPath,
  opposition_id: "radiodiagnostico",
  opposition_name: "Radiodiagnóstico",
});

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
const initScript = `(() => {
  const fixture = ${JSON.stringify({ registryRows, rxVersionPath, rxPackage, fixtureUser, staticCatalog })};
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
      if (path.includes("/rest/v1/attempts") || path.includes("/rest/v1/question_progress")) {
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

  await page.goto(`${base}#catalog`);
  await page.getByLabel("Correo electrónico").fill("fixture@metis.local");
  await page.getByLabel("Contraseña").fill("Fixture-Metis-2026");
  await page.getByRole("button", { name: "Entrar" }).click();

  const selector = page.getByLabel("Oposición");
  await selector.waitFor({ state: "visible" });
  await page
    .getByRole("heading", { name: "SAS Administrativo/a 2023 - Turno Libre" })
    .waitFor({ state: "visible" });
  await shot(page, "catalogo-administrativo");

  await selector.selectOption({ label: "Radiodiagnóstico" });
  await page
    .getByRole("heading", { name: "SAS Radiodiagnóstico 2026 (fixture)" })
    .waitFor({ state: "visible" });
  await shot(page, "catalogo-radiodiagnostico");

  await page.getByRole("button", { name: "Elegir examen" }).click();
  await page.locator("#exam-title", { hasText: "SAS Radiodiagnóstico 2026 (fixture)" }).waitFor({ state: "visible" });
  await shot(page, "examen-seleccionado-radiodiagnostico");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  setTimeout(() => server?.kill("SIGKILL"), 3_000)?.unref?.();
}
