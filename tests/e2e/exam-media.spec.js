// Pruebas E2E aisladas de la unidad m05-casos-multimedia.
//
// Sin credenciales reales y sin Supabase alojado: toda la red (auth, RPC,
// catálogo, paquetes y bytes de imágenes) se intercepta con fixtures. Los PNG
// son sintéticos y se generan aquí, así que ninguna fuente RX privada se lee ni
// se publica. Se cubre la imagen compartida del caso, el orden de varias
// imágenes, la ampliación accesible y el error explícito por asset ausente.
import { test, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";

const RX_EXAM = "e2e-rx-media-examen";
const ADMIN_EXAM = "e2e-admin-examen";
const BROKEN_EXAM = "e2e-rx-roto-examen";
const V1 = { id: "e2e-rx-version-v1", path: `${RX_EXAM}/versions/e2e-rx-version-v1.json` };
const V2 = { id: "e2e-rx-version-v2", path: `${RX_EXAM}/versions/e2e-rx-version-v2.json` };
const ALT_1 = "Radiografía posteroanterior de tórax de la serie oficial del caso";
const ALT_2 = "Radiografía lateral de tórax de la misma serie oficial del caso";
const ALT_3 = "Corte de tomografía computarizada identificado en el enunciado";

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

function pngBytes(width, height, [red, green, blue]) {
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
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildAsset(id, examId, versionId, width, height, color) {
  const bytes = pngBytes(width, height, color);
  return {
    id,
    path: `${examId}/media/${id}-${versionId}.png`,
    mime: "image/png",
    width,
    height,
    sha256: await sha256Hex(bytes),
    source: "Fixture E2E sintética (sin fuente RX privada)",
    version: versionId,
    contentType: "image/png",
    bytes,
  };
}

async function examPackage(version, examId = RX_EXAM) {
  const color = version.id === V1.id ? [190, 30, 45] : [30, 60, 190];
  const assets = [
    await buildAsset("asset-1", examId, version.id, 320, 240, color),
    await buildAsset("asset-2", examId, version.id, 320, 240, color),
    await buildAsset("asset-3", examId, version.id, 480, 360, color),
  ];
  const questions = [1, 2, 3, 4].map((number) => ({
    id: `${examId}-q${String(number).padStart(3, "0")}`,
    sourceNumber: number,
    active: true,
    status: "valid",
    displayLabel: null,
    text: `Enunciado ${number} del caso clínico sintético de la prueba E2E`,
    options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }, { id: "C", text: "Tres" }, { id: "D", text: "Cuatro" }],
    sourceAnswer: "B",
    correctOption: "B",
    sourcePage: number,
  }));
  questions[0].caseId = "caso-e2e-1";
  questions[0].media = [{ asset: "asset-1", alt: ALT_1 }];
  questions[1].caseId = "caso-e2e-1";
  questions[1].media = [
    { asset: "asset-1", alt: ALT_1 },
    { asset: "asset-2", alt: ALT_2 },
    { asset: "asset-3", alt: ALT_3 },
  ];
  return {
    schemaVersion: "2.0",
    id: examId,
    title: examId === ADMIN_EXAM ? "Examen Administrativo (fixture)" : examId === BROKEN_EXAM ? "Examen RX roto (fixture)" : "Examen RX (fixture E2E)",
    category: examId === ADMIN_EXAM ? "Administrativo (fixture)" : "Radiodiagnóstico (fixture)",
    access: "Turno libre",
    variant: null,
    year: 2099,
    durationMinutes: 90,
    source: { pdf: "E2E.pdf", sha256: "a".repeat(64), answerKeyPage: 2 },
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
      assets: assets.map(({ bytes: _bytes, contentType: _contentType, ...asset }) => asset),
      cases: [{ id: "caso-e2e-1", label: "Caso clínico 1 (fixture)", assets: ["asset-1", "asset-2", "asset-3"] }],
    },
    __assets: assets,
  };
}

const rxV1 = await examPackage(V1);
const rxV2 = await examPackage(V2);
const brokenPackage = await examPackage(V2, BROKEN_EXAM);
const adminPackage = {
  ...rxV2,
  id: ADMIN_EXAM,
  title: "Examen Administrativo (fixture)",
  questions: rxV2.questions.map(({ caseId: _caseId, media: _media, ...question }) => ({
    ...question,
    id: `${ADMIN_EXAM}-q${String(question.sourceNumber).padStart(3, "0")}`,
  })),
};
delete adminPackage.media;
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
  opposition_id: "administrativo",
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

const registryRows = [
  { exam_id: RX_EXAM, exam_version_id: V2.id, exam_version_path: V2.path, opposition_id: "rx-fixture", opposition_name: "Radiodiagnóstico (fixture)" },
  { exam_id: BROKEN_EXAM, exam_version_id: V2.id, exam_version_path: `${BROKEN_EXAM}/versions/${V2.id}.json`, opposition_id: "rx-fixture", opposition_name: "Radiodiagnóstico (fixture)" },
  { exam_id: ADMIN_EXAM, exam_version_id: V2.id, exam_version_path: `${ADMIN_EXAM}/versions/${V2.id}.json`, opposition_id: "administrativo", opposition_name: "Administrativo" },
];
const packageByPath = new Map([
  [V1.path, rxV1],
  [V2.path, rxV2],
  [`${ADMIN_EXAM}/versions/${V2.id}.json`, adminPackage],
  [`${BROKEN_EXAM}/versions/${V2.id}.json`, brokenPackage],
]);
const assetByPath = new Map();
for (const asset of [...rxV1.__assets, ...rxV2.__assets, ...brokenPackage.__assets]) assetByPath.set(asset.path, asset);

function attemptRow(id, kind) {
  const now = new Date();
  return {
    id,
    user_id: fixtureUser.id,
    exam_id: RX_EXAM,
    exam_version_id: V2.id,
    exam_version_path: V2.path,
    question_ids: rxV2.questions.map(({ id: questionId }) => questionId),
    kind,
    principal: true,
    strategy: kind === "exam" ? "exam" : "normal",
    status: "active",
    current_position: 0,
    active_seconds: 0,
    is_paused: false,
    duration_minutes: kind === "exam" ? 90 : null,
    started_at: kind === "exam" ? now.toISOString() : null,
    deadline_at: kind === "exam" ? new Date(now.getTime() + 90 * 60_000).toISOString() : null,
    server_now: now.toISOString(),
    origin: "official",
  };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function interceptApplication(page, { broken = false } = {}) {
  const studyAttempt = attemptRow("71000000-0000-4000-8000-0000000000f1", "normal");
  const examAttempt = attemptRow("72000000-0000-4000-8000-0000000000f1", "exam");
  let activeAttempt = studyAttempt;

  await page.route("**/rest/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.includes("/rpc/get_published_official_exam_versions_v2")) return json(route, registryRows);
    if (path.includes("/rpc/get_server_now")) return json(route, new Date().toISOString());
    if (path.includes("/rpc/start_or_replace_principal_attempt")) {
      const payload = JSON.parse(request.postData() || "{}");
      activeAttempt = { ...studyAttempt, exam_id: payload.p_exam_id, question_ids: payload.p_question_ids };
      return json(route, activeAttempt);
    }
    if (path.includes("/rpc/start_or_resume_exam_attempt")) {
      const payload = JSON.parse(request.postData() || "{}");
      activeAttempt = { ...examAttempt, exam_id: payload.p_exam_id, question_ids: payload.p_question_ids };
      return json(route, activeAttempt);
    }
    if (path.includes("/rpc/sync_active_attempt")) {
      const payload = JSON.parse(request.postData() || "{}");
      const pending = payload.p_pending_snapshot || {};
      if (Number.isInteger(pending.position)) activeAttempt = { ...activeAttempt, current_position: pending.position };
      if (typeof pending.is_paused === "boolean") activeAttempt = { ...activeAttempt, is_paused: pending.is_paused };
      return json(route, { attempt: activeAttempt, answers: [] });
    }
    if (path.endsWith("/personal_attempt_history")) return json(route, [historicalAttempt]);
    if (path.endsWith("/attempts") || path.endsWith("/question_progress")) return json(route, []);
    if (path.endsWith("/attempt_question_sources") || path.endsWith("/attempt_answers")) return json(route, []);
    return json(route, { message: `Lectura inesperada: ${path}` }, 500);
  });

  await page.route("**/auth/v1/token?*", (route) => json(route, {
    access_token: "fixture-access-token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "fixture-refresh-token",
    user: fixtureUser,
  }));

  await page.route("**/data/exams/**", (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname.split("/data/exams/")[1];
    if (relative === "catalog.json") {
      return json(route, {
        exams: registryRows.map(({ exam_id: id, exam_version_id: latestVersion, exam_version_path: latestPath }) => ({ id, latestVersion, latestPath })),
      });
    }
    if (packageByPath.has(relative)) return json(route, packageByPath.get(relative));
    const asset = assetByPath.get(relative);
    if (asset) {
      if (broken && relative.includes(BROKEN_EXAM)) return route.fulfill({ status: 404, body: "asset ausente" });
      return route.fulfill({ status: 200, contentType: asset.contentType, body: asset.bytes });
    }
    return route.fulfill({ status: 404, body: "no encontrado" });
  });
}

async function login(page) {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill("fixture@metis.local");
  await page.getByLabel("Contraseña").fill("Fixture-Metis-2026");
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("el caso comparte imágenes ordenadas, ampliables con teclado y la revisión queda fijada a su versión", async ({ page }) => {
  await interceptApplication(page);
  await login(page);
  await expect(page.locator(".exam-card", { hasText: "Examen RX (fixture E2E)" })).toBeVisible();
  await page.locator(".exam-card", { hasText: "Examen RX (fixture E2E)" }).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: "Empezar estudio normal" }).click();

  await expect(page.locator("#question-media img")).toHaveCount(1);
  await expect(page.locator("#question-media img").first()).toHaveAttribute("alt", ALT_1);

  await page.locator(".question-media-item").first().click();
  await expect(page.locator("dialog[open] img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".question-media-item").first()).toBeFocused();

  await page.getByRole("button", { name: "Saltar" }).click();
  await expect(page.locator("#question-media img")).toHaveCount(3);
  const sources = await page.locator("#question-media img").evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  expect(sources[0]).toContain("asset-1");
  expect(sources[1]).toContain("asset-2");
  expect(sources[2]).toContain("asset-3");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("button", { name: "← Salir y guardar" }).click();
  await page.getByRole("button", { name: "Historial" }).click();
  await page.locator("#history-list .history-entry button", { hasText: "Abrir en solo lectura" }).first().click();
  await expect(page.locator("#history-detail-version")).toContainText(V1.id);
  await expect(page.locator("#history-questions img").first()).toBeVisible();
  const historySource = await page.locator("#history-questions img").first().getAttribute("src");
  expect(historySource).toContain(V1.id);

  await page.locator("#history-detail-back").click();
  await page.locator("#history-catalog-button").click();
  await page.locator(".exam-card", { hasText: "Examen RX (fixture E2E)" }).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: "Empezar Modo examen" }).click();
  await expect(page.locator("#question-media img")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Entregar examen" })).toBeVisible();
});

test("un asset ausente rechaza la carga del catálogo con un error explícito", async ({ page }) => {
  await interceptApplication(page, { broken: true });
  await login(page);
  await expect(page.locator("#catalog-status")).toContainText(BROKEN_EXAM);
  await expect(page.locator(".exam-card", { hasText: "Examen RX (fixture E2E)" })).toHaveCount(0);
});
