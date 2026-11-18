// Receta visual Metis · unidad m05-casos-multimedia
//
// Fotografía los estados de la unidad contra la aplicación real servida por
// Vite: la imagen compartida de un caso, varias imágenes ordenadas, la
// ampliación accesible (escritorio y móvil), el Modo examen, la revisión
// histórica fijada a la versión v1 aunque el catálogo actual publique la v2,
// y el error explícito de un asset ausente, a 1280 y a 390 px.
// Todo el contenido es SINTÉTICO (PNG generados aquí, sin leer ni publicar
// fuentes RX privadas) y se sirve en entorno aislado por interceptación de red,
// sin credenciales ni llamadas a Supabase alojado. La receta solo navega y
// fotografía: no contiene aserciones y nunca importa los oráculos.
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
import { deflateSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT || 4316);
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

// --- PNG sintético -------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function pngBytes(width, height, [red, green, blue] = [190, 30, 45]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const offset = y * (1 + width * 3);
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[offset + 1 + x * 3] = red;
      raw[offset + 2 + x * 3] = green;
      raw[offset + 3 + x * 3] = blue;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// --- Fixture sintética: examen RX con caso de dos preguntas --------------------
const RX_EXAM = "fixture-rx-media-examen";
const V1 = { id: "fixture-rx-version-v1", path: `${RX_EXAM}/versions/fixture-rx-version-v1.json` };
const V2 = { id: "fixture-rx-version-v2", path: `${RX_EXAM}/versions/fixture-rx-version-v2.json` };
const ADMIN_EXAM = "fixture-admin-examen";
const BROKEN_EXAM = "fixture-rx-roto-examen";

async function buildAsset(id, examId, versionId, width, height, color) {
  const bytes = pngBytes(width, height, color);
  return {
    id,
    path: `${examId}/media/${id}-${versionId}.png`,
    mime: "image/png",
    width,
    height,
    sha256: await sha256Hex(bytes),
    source: "Receta visual Metis · PNG sintético (sin fuente RX privada)",
    version: versionId,
    bytes,
  };
}

async function rxPackage(version, examId = RX_EXAM) {
  const color = version.id === V1.id ? [190, 30, 45] : [30, 60, 190];
  const assets = [
    await buildAsset("asset-1", examId, version.id, 320, 240, color),
    await buildAsset("asset-2", examId, version.id, 320, 240, color),
    await buildAsset("asset-3", examId, version.id, 480, 360, color),
  ];
  const questions = [1, 2, 3, 4].map((number) => ({
    id: `${RX_EXAM}-q${String(number).padStart(3, "0")}`,
    sourceNumber: number,
    active: true,
    status: "valid",
    displayLabel: null,
    text: `Enunciado ${number} del caso clínico sintético de la receta`,
    options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }, { id: "C", text: "Tres" }, { id: "D", text: "Cuatro" }],
    sourceAnswer: "B",
    correctOption: "B",
    sourcePage: number,
  }));
  questions[0].caseId = "caso-receta-1";
  questions[0].media = [{ asset: "asset-1", alt: "Radiografía posteroanterior de tórax de la serie oficial del caso" }];
  questions[1].caseId = "caso-receta-1";
  questions[1].media = [
    { asset: "asset-1", alt: "Radiografía posteroanterior de tórax de la serie oficial del caso" },
    { asset: "asset-2", alt: "Radiografía lateral de tórax de la misma serie oficial del caso" },
    { asset: "asset-3", alt: "Corte de tomografía computarizada identificado en el enunciado" },
  ];
  return {
    schemaVersion: "2.0",
    id: RX_EXAM,
    title: "Examen RX (fixture multimedia)",
    category: "Radiodiagnóstico (fixture)",
    access: "Turno libre",
    variant: null,
    year: 2099,
    durationMinutes: 90,
    source: { pdf: "RECETA.pdf", sha256: "a".repeat(64), answerKeyPage: 2 },
    version: { id: version.id, contentSha256: "b".repeat(64) },
    questions,
    scorableSet: {
      state: "resolved", questionNumbers: [1, 2, 3, 4], count: 4,
      annulledNumbers: [], reserveNumbers: [], reserveUsedNumbers: [], reserveUsedLabels: {},
      annulledCount: 0, reserveTotal: 0, reserveUsedCount: 0, reserveUnusedCount: 0,
    },
    qa: { state: "publicable", blockedReason: null, flags: [], checks: {
      metadataComplete: true, optionsPerQuestionValid: true, answerCoverageValid: true,
      countsReconciled: true, annulledHandlingResolved: true, reserveHandlingResolved: true,
      duplicatesResolved: true,
    } },
    media: {
      assets: assets.map(({ bytes: _bytes, ...asset }) => asset),
      cases: [{ id: "caso-receta-1", label: "Caso clínico 1 (fixture)", assets: ["asset-1", "asset-2", "asset-3"] }],
    },
    __assets: assets,
  };
}

const rxV1 = await rxPackage(V1);
const rxV2 = await rxPackage(V2);
const adminPackage = {
  ...rxV2,
  id: ADMIN_EXAM,
  title: "Examen Administrativo (fixture)",
  questions: rxV2.questions.map(({ caseId: _caseId, media: _media, ...question }) => ({ ...question, id: `${ADMIN_EXAM}-q${String(question.sourceNumber).padStart(3, "0")}` })),
};
delete adminPackage.media;
delete adminPackage.__assets;
const brokenPackage = await rxPackage(V2, BROKEN_EXAM);
brokenPackage.id = BROKEN_EXAM;
brokenPackage.title = "Examen RX roto (fixture)";
brokenPackage.questions = brokenPackage.questions.map((question) => ({ ...question, id: `${BROKEN_EXAM}-q${String(question.sourceNumber).padStart(3, "0")}` }));
const brokenAssets = brokenPackage.__assets;
delete brokenPackage.__assets;

const registryRows = [
  { exam_id: RX_EXAM, exam_version_id: V2.id, exam_version_path: V2.path, opposition_id: "rx-fixture", opposition_name: "Radiodiagnóstico (fixture)" },
  { exam_id: BROKEN_EXAM, exam_version_id: V2.id, exam_version_path: `${BROKEN_EXAM}/versions/${V2.id}.json`, opposition_id: "rx-fixture", opposition_name: "Radiodiagnóstico (fixture)" },
  { exam_id: ADMIN_EXAM, exam_version_id: V2.id, exam_version_path: `${ADMIN_EXAM}/versions/${V2.id}.json`, opposition_id: "administrativo", opposition_name: "Administrativo" },
];

// Bytes reales para las <img> del navegador (page.route) y base64 para el
// fetch simulado (initScript): la misma fixture sirve ambos caminos.
const assetByPath = new Map();
for (const asset of [...rxV1.__assets, ...rxV2.__assets, ...brokenAssets]) assetByPath.set(asset.path, asset);

const historicalAttempt = {
  id: "70000000-0000-4000-8000-0000000000f1",
  exam_id: RX_EXAM,
  exam_version_id: V1.id,
  exam_version_path: V1.path,
  question_ids: [`${RX_EXAM}-q001`, `${RX_EXAM}-q002`],
  kind: "exam",
  strategy: "exam",
  status: "completed",
  origin: "official",
  opposition_id: "rx-fixture",
  created_at: "2026-11-17T09:00:00Z",
  completed_at: "2026-11-17T09:30:00Z",
  active_seconds: 0,
  exam_elapsed_ms: 1_800_000,
  score: 75,
  correct_answers: 1,
  wrong_answers: 1,
  blank_answers: 0,
  answered_questions: 2,
  failed_scope_exam_id: null,
  started_at: "2026-11-17T09:00:00Z",
  deadline_at: "2026-11-17T10:30:00Z",
};

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

const assetBase64 = [...assetByPath.values()].map(({ path, mime, sha256, width, height, version, source, bytes }) => ({
  path, mime, sha256, width, height, version, source, base64: bytes.toString("base64"),
}));
const catalogEntries = registryRows.map(({ exam_id: id, exam_version_id: latestVersion, exam_version_path: latestPath }) => ({ id, latestVersion, latestPath }));
const packageByPath = new Map([
  [V1.path, rxV1],
  [V2.path, rxV2],
  [`${ADMIN_EXAM}/versions/${V2.id}.json`, adminPackage],
  [`${BROKEN_EXAM}/versions/${V2.id}.json`, brokenPackage],
]);

const attemptRowFor = (attemptId, examId, version, questionIds, kind) => {
  const startedAt = new Date();
  return {
    id: attemptId,
    user_id: fixtureUser.id,
    exam_id: examId,
    exam_version_id: version.id,
    exam_version_path: version.path,
    question_ids: questionIds,
    kind,
    principal: true,
    strategy: kind === "exam" ? "exam" : "normal",
    status: "active",
    current_position: 0,
    active_seconds: 0,
    is_paused: false,
    duration_minutes: kind === "exam" ? 90 : null,
    started_at: kind === "exam" ? startedAt.toISOString() : null,
    deadline_at: kind === "exam" ? new Date(startedAt.getTime() + 90 * 60_000).toISOString() : null,
    server_now: startedAt.toISOString(),
  };
};

const initScript = `(() => {
  const fixture = ${JSON.stringify({
    registryRows,
    catalogEntries,
    assetBase64,
    packageByPath: [...packageByPath.entries()],
    historicalAttempt,
    fixtureUser,
    RX_EXAM,
    V1,
    V2,
  })};
  const originalFetch = window.fetch.bind(window);
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const broken = () => window.sessionStorage.getItem("metis-broken-media") === "1";
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
      if (path.includes("/rest/v1/rpc/get_server_now")) return json(new Date().toISOString());
      if (path.includes("/rest/v1/rpc/start_or_replace_principal_attempt")) {
        const payload = JSON.parse((init && init.body) || "{}");
        return json({
          ...window.__fixtureStudyAttempt,
          exam_id: payload.p_exam_id,
          exam_version_id: payload.p_exam_version_id,
          exam_version_path: payload.p_exam_version_path,
          question_ids: payload.p_question_ids,
        });
      }
      if (path.includes("/rest/v1/rpc/start_or_resume_exam_attempt")) {
        const payload = JSON.parse((init && init.body) || "{}");
        return json({
          ...window.__fixtureExamAttempt,
          exam_id: payload.p_exam_id,
          exam_version_id: payload.p_exam_version_id,
          exam_version_path: payload.p_exam_version_path,
          question_ids: payload.p_question_ids,
        });
      }
      if (path.includes("/rest/v1/rpc/sync_active_attempt")) {
        return json({ attempt: window.__fixtureSyncAttempt || {}, answers: [] });
      }
      if (path.includes("/rest/v1/personal_attempt_history")) {
        return json([fixture.historicalAttempt]);
      }
      if (path.includes("/rest/v1/attempts") || path.includes("/rest/v1/question_progress")) return json([]);
      if (path.includes("/rest/v1/attempt_question_sources")) return json([]);
      if (path.includes("/rest/v1/attempt_answers")) return json([]);
      if (path.endsWith("/data/exams/catalog.json")) return json({ exams: fixture.catalogEntries });
      const packageEntry = fixture.packageByPath.find(([suffix]) => path.endsWith(suffix));
      if (packageEntry) return json(packageEntry[1]);
      const asset = fixture.assetBase64.find((candidate) => path.endsWith(candidate.path));
      if (asset) {
        if (broken() && path.includes("fixture-rx-roto-examen")) {
          return new Response("asset ausente", { status: 404 });
        }
        const bytes = Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0));
        return new Response(bytes, { status: 200, headers: { "Content-Type": asset.mime } });
      }
    } catch {}
    return originalFetch(input, init);
  };
})();`;

// Filas de intento que el interceptor necesita antes del primer arranque.
const studyAttempt = attemptRowFor("71000000-0000-4000-8000-0000000000f1", RX_EXAM, V2, rxV2.questions.map(({ id }) => id), "normal");
const examAttempt = attemptRowFor("72000000-0000-4000-8000-0000000000f1", RX_EXAM, V2, rxV2.questions.map(({ id }) => id), "exam");
const seedScript = `(() => {
  window.__fixtureStudyAttempt = ${JSON.stringify(studyAttempt)};
  window.__fixtureExamAttempt = ${JSON.stringify(examAttempt)};
  window.__fixtureSyncAttempt = ${JSON.stringify(examAttempt)};
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
  // Las <img> piden los assets por URL al servidor: la receta responde con los
  // PNG sintéticos de la fixture (aislado, sin tocar el banco real).
  await page.route("**/media/**", async (route) => {
    const url = new URL(route.request().url());
    const asset = [...assetByPath.entries()].find(([assetPath]) => url.pathname.endsWith(assetPath));
    if (!asset) return route.fulfill({ status: 404, body: "asset ausente" });
    return route.fulfill({ status: 200, contentType: asset[1].mime, body: asset[1].bytes });
  });
  await page.addInitScript(initScript);
  await page.addInitScript(seedScript);
  await watch(page);

  await page.goto(`${base}#catalog`);
  await page.getByLabel("Correo electrónico").fill("fixture@metis.local");
  await page.getByLabel("Contraseña").fill("Fixture-Metis-2026");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.locator(".exam-card", { hasText: "Examen RX (fixture multimedia)" }).waitFor({ state: "visible" });

  // Estudio normal: pregunta 1 del caso con su imagen compartida (1280).
  await page.locator(".exam-card", { hasText: "Examen RX (fixture multimedia)" }).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: "Empezar estudio normal" }).click();
  await page.locator("#question-media img").first().waitFor({ state: "visible" });
  await shot(page, "estudio-caso-imagen-compartida-1280");

  // Segunda pregunta del caso: varias imágenes en orden (1280).
  await page.getByRole("button", { name: "Saltar" }).click();
  await page.locator("#question-media img").nth(2).waitFor({ state: "visible" });
  await shot(page, "estudio-varias-imagenes-orden-1280");

  // Ampliación accesible (1280).
  await page.locator(".question-media-item").first().click();
  await page.locator("dialog[open] img").waitFor({ state: "visible" });
  await shot(page, "ampliacion-1280");
  await page.getByRole("button", { name: "Cerrar imagen ampliada" }).click();

  // Presentación a 390 px y ampliación en móvil.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot(page, "estudio-caso-390");
  await page.locator(".question-media-item").first().click();
  await page.locator("dialog[open] img").waitFor({ state: "visible" });
  await shot(page, "ampliacion-390");
  await page.getByRole("button", { name: "Cerrar imagen ampliada" }).click();

  // Revisión histórica fijada a la versión v1 (1280), con el catálogo actual en v2.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "← Salir y guardar" }).click();
  await page.getByRole("button", { name: "Historial" }).click();
  await page.locator(".history-entry").first().waitFor({ state: "visible" });
  await page.locator("#history-list .history-entry button", { hasText: "Abrir en solo lectura" }).first().click();
  await page.locator("#history-detail-version", { hasText: `Versión histórica fijada: ${V1.id}` }).waitFor({ state: "visible" });
  await page.locator("#history-questions img").first().waitFor({ state: "visible" });
  await shot(page, "revision-historica-imagenes-1280");

  // Modo examen cronometrado con imagen (1280).
  await page.locator("#history-detail-back").click();
  await page.locator("#history-catalog-button").click();
  await page.locator(".exam-card", { hasText: "Examen RX (fixture multimedia)" }).waitFor({ state: "visible" });
  await page.locator(".exam-card", { hasText: "Examen RX (fixture multimedia)" }).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: "Empezar Modo examen" }).click();
  await page.locator("#question-media img").first().waitFor({ state: "visible" });
  await shot(page, "examen-imagen-1280");

  // Error explícito por asset ausente (móvil): el catálogo rechaza la carga.
  await page.getByRole("button", { name: "← Salir del examen" }).click();
  await page.evaluate(() => window.sessionStorage.setItem("metis-broken-media", "1"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("#catalog-status", { hasText: "fixture-rx-roto-examen" }).waitFor({ state: "visible" });
  await shot(page, "error-asset-ausente-390");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  setTimeout(() => server?.kill("SIGKILL"), 3_000)?.unref?.();
}
