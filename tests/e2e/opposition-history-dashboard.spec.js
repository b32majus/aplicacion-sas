import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Pruebas de navegador EXCLUSIVAMENTE aisladas de la unidad
// m04-historial-dashboard: sin credenciales y sin llamadas a Supabase alojado.
// Toda la red se intercepta con fixtures de dos oposiciones (Administrativo y
// una segunda oposición SOLO de fixture) y se comprueba que el Historial y el
// Dashboard consultan la oposición seleccionada en servidor, que los estados
// vacíos la mencionan, que la revisión histórica queda fijada y no muta nada,
// y que la compatibilidad legacy se conserva (endpoint
// personal_attempt_history y aviso contextual del Dashboard).

const oppositions = [
  { id: "administrativo", name: "Administrativo" },
  { id: "rx-fixture", name: "Radiodiagnóstico (fixture)" },
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
const registryRows = [
  {
    exam_id: admPackage.id,
    exam_version_id: admPackage.version.id,
    exam_version_path: `fixture-adm-examen/versions/${admPackage.version.id}.json`,
    opposition_id: "administrativo",
    opposition_name: "Administrativo",
  },
  {
    exam_id: rxPackage.id,
    exam_version_id: rxPackage.version.id,
    exam_version_path: `fixture-rx-examen/versions/${rxPackage.version.id}.json`,
    opposition_id: "rx-fixture",
    opposition_name: "Radiodiagnóstico (fixture)",
  },
];
const attempt = {
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
};
const answers = [{
  id: "30000000-0000-4000-8000-0000000000ad",
  question_id: "fixture-adm-examen-q1",
  answer_sequence: 1,
  selected_option: "A",
  correct_option: "B",
  is_correct: false,
  confirmed_at: "2026-11-17T09:01:00Z",
}];
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
      ? [{ exam_id: admPackage.id, attempt_count: 1, best_score: 75, average_score: 75, best_time_ms: 1_800_000, accuracy: 50, pending_failures: 0, dominated_count: 0, latest_attempt_at: attempt.completed_at, latest_attempt_status: "completed", latest_attempt_score: 75 }]
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

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

// Instala los interceptores de red: hace de Supabase de fixture, cuenta las
// peticiones al endpoint del Historial y vigila cualquier mutación.
async function interceptApplication(page, { dashboardError = null } = {}) {
  const writes = [];
  const historyRequests = [];
  const dashboardRequests = [];

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== "GET" && !path.includes("/rpc/")) {
      writes.push({ method: request.method(), path });
      return json(route, { message: "Historial y Dashboard son de solo lectura" }, 500);
    }
    if (path.includes("/rpc/get_published_official_exam_versions_v2")) {
      return json(route, registryRows);
    }
    if (path.includes("/rpc/get_opposition_dashboard_v2")) {
      dashboardRequests.push(JSON.parse(request.postData() || "{}").p_opposition_id ?? null);
      if (dashboardError) return json(route, { message: dashboardError.message }, dashboardError.status);
      const body = JSON.parse(request.postData() || "{}");
      return json(route, dashboardFor(body.p_opposition_id));
    }
    if (path.includes("/rpc/get_server_now")) return json(route, attempt.completed_at);
    if (path.endsWith("/personal_attempt_history")) {
      historyRequests.push(url.search);
      const wanted = (url.searchParams.get("opposition_id") || "").split("eq.")[1] || "";
      return json(route, [attempt].filter((row) => !wanted || row.opposition_id === wanted));
    }
    if (path.endsWith("/attempts") || path.endsWith("/question_progress")) return json(route, []);
    if (path.endsWith("/attempt_question_sources")) return json(route, []);
    if (path.endsWith("/attempt_answers")) return json(route, structuredClone(answers));
    return json(route, { message: `Unexpected read: ${path}` }, 500);
  });
  await page.route("**/auth/v1/token?*", (route) => json(route, {
    access_token: "fixture-access-token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "fixture-refresh-token",
    user: fixtureUser,
  }));
  await page.route("**/data/exams/catalog.json", (route) => json(route, {
    exams: registryRows.map((row) => ({
      id: row.exam_id,
      title: row.exam_id === admPackage.id ? admPackage.title : rxPackage.title,
      latestVersion: row.exam_version_id,
      latestPath: row.exam_version_path,
    })),
  }));
  await page.route(`**/data/exams/${registryRows[0].exam_version_path}`, (route) => json(route, admPackage));
  await page.route(`**/data/exams/${registryRows[1].exam_version_path}`, (route) => json(route, rxPackage));

  return { writes, historyRequests, dashboardRequests };
}

async function login(page) {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill("fixture@metis.local");
  await page.getByLabel("Contraseña").fill("Fixture-Metis-2026");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Examen Administrativo (fixture)" })).toBeVisible();
}

test("Historial y Dashboard consultan la oposición seleccionada con estados vacíos, revisión fijada y sin mutaciones", async ({ page }) => {
  const { writes, historyRequests } = await interceptApplication(page);
  await login(page);

  // Historial de la oposición consultada: identificación visible y filtro de
  // oposición viajando al servidor sobre el endpoint personal_attempt_history.
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.locator("#history-opposition")).toHaveText("Oposición consultada: Administrativo");
  await expect(page.locator(".history-entry").first()).toBeVisible();
  await expect(page.getByText("Modo examen · Examen oficial · Finalizado")).toBeVisible();
  await expect(page.getByText("75,00 / 100")).toBeVisible();
  expect(historyRequests.at(-1)).toContain("opposition_id=eq.administrativo");

  // Revisión histórica fijada: solo lectura con la versión originaria.
  await page.getByRole("button", { name: "Abrir en solo lectura" }).click();
  await expect(page.locator("#history-detail-title")).toHaveText("Examen Administrativo (fixture)");
  await expect(page.getByText(`Versión histórica fijada: ${admPackage.version.id}`)).toBeVisible();
  await expect(page.locator("#history-questions input").first()).toBeDisabled();
  await expect(page.getByText("Incorrecta · Respuesta oficial: B")).toBeVisible();

  // Dashboard de la oposición consultada: resumen personal, comparativa de
  // participantes reales y secciones por examen/pregunta de ESA oposición.
  await page.locator("#history-detail-back").click();
  await page.locator("#history-catalog-button").click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.locator("#dashboard-opposition")).toHaveText("Oposición consultada: Administrativo");
  await expect(page.getByRole("heading", { name: "Mi actividad global" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Participante 1" })).toBeVisible();
  await expect(page.locator("#dashboard-exams h3")).toHaveText("Examen Administrativo (fixture)");
  await expect(page.locator("#dashboard-rankings h3")).toHaveText("Examen Administrativo (fixture)");
  await expect(page.getByText("Fallada por 0 de 1")).toHaveCount(0);

  // Segunda oposición seleccionada: el Historial queda vacío SIN ningún
  // intento de la selección anterior y el filtro viaja al servidor.
  await page.locator("#dashboard-catalog-button").click();
  await page.getByLabel("Oposición").selectOption({ label: "Radiodiagnóstico (fixture)" });
  await expect(page.getByRole("heading", { name: "Examen Radiodiagnóstico (fixture)" })).toBeVisible();
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.locator("#history-opposition")).toHaveText("Oposición consultada: Radiodiagnóstico (fixture)");
  await expect(page.locator("#history-status")).toContainText("Todavía no hay intentos persistidos");
  await expect(page.locator("#history-status")).toContainText("Radiodiagnóstico (fixture)");
  await expect(page.locator(".history-entry")).toHaveCount(0);
  expect(historyRequests.at(-1)).toContain("opposition_id=eq.rx-fixture");

  // Dashboard de la oposición vacía: identificación y estados vacíos
  // coherentes, sin comparativas, sin ranking y sin «Falladas por todos».
  await page.locator("#history-catalog-button").click();
  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.locator("#dashboard-opposition")).toHaveText("Oposición consultada: Radiodiagnóstico (fixture)");
  await expect(page.locator("#dashboard-exams")).toContainText("todavía no tiene exámenes oficiales publicados");
  await expect(page.locator("#dashboard-shared")).toContainText("Todavía no hay participantes con actividad");
  await expect(page.locator("#dashboard-rankings")).toContainText("Todavía no hay intentos oficiales puntuados");
  await expect(page.getByText("Fallada por")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Examen Administrativo (fixture)" })).toHaveCount(0);

  // Enlace directo de un intento de otra oposición tras cambiar la selección:
  // el fallback recarga el Historial propio SIN filtro de oposición, la
  // revisión conserva el paquete fijado y solo lee.
  await page.evaluate((id) => { window.location.hash = `history=${id}`; }, attempt.id);
  await page.reload();
  await expect(page.getByText(`Versión histórica fijada: ${admPackage.version.id}`)).toBeVisible();
  await expect(page.locator("#history-detail-title")).toHaveText("Examen Administrativo (fixture)");
  expect(historyRequests.at(-1)).not.toContain("opposition_id=eq.");
  await page.locator("#history-detail-back").click();
  await expect(page.locator("#history-opposition")).toHaveText("Oposición consultada: Radiodiagnóstico (fixture)");

  // Ninguna vista de Historial o Dashboard origina mutaciones.
  expect(writes).toEqual([]);
});

test("Dashboard poblado a 390 px: sin scroll horizontal de página y tablas desplazándose dentro de su contenedor", async ({ page }) => {
  const { writes } = await interceptApplication(page);
  await login(page);

  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.locator("#dashboard-opposition")).toHaveText("Oposición consultada: Administrativo");
  await expect(page.getByRole("rowheader", { name: "Participante 1" })).toBeVisible();
  await expect(page.locator("#dashboard-exams h3")).toHaveText("Examen Administrativo (fixture)");

  // La rejilla del contenido nunca se dimensiona por el ancho mínimo de una
  // tabla: grid-template-columns: minmax(0, 1fr) reservado en el marcado.
  expect(await page.locator("#dashboard-content").getAttribute("style"))
    .toContain("minmax(0, 1fr)");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#dashboard-content")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const shared = document.getElementById("dashboard-shared");
    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      sharedInternalScroll: shared.scrollWidth > shared.clientWidth,
    };
  });
  expect(overflow.pageOverflow).toBeLessThanOrEqual(0);
  expect(overflow.sharedInternalScroll).toBe(true);
  expect(writes).toEqual([]);
});

test("compatibilidad legacy: endpoint del Historial, RPC v2 por oposición y aviso contextual del Dashboard", async ({ page }) => {
  const { historyRequests, dashboardRequests, writes } = await interceptApplication(page, {
    dashboardError: { status: 400, message: "El perfil no pertenece al Dashboard compartido." },
  });

  // Contrato estructural conservado: el endpoint del Historial (módulo de
  // Historial) y el aviso contextual siguen cableados en el controlador del
  // Dashboard.
  const historySource = await readFile(new URL("../../app/src/history.js", import.meta.url), "utf8");
  expect(historySource).toContain("personal_attempt_history");
  const appSource = await readFile(new URL("../../app/src/app.js", import.meta.url), "utf8");
  expect(appSource).toContain('showError(elements["dashboard-status"], dashboardLoadStatus(error));');
  const definition = appSource.match(/function dashboardLoadStatus\(error\) \{[\s\S]*?\n\}/);
  expect(definition).toBeTruthy();
  const messageFor = runInNewContext(`(${definition[0]})`);
  expect(messageFor({ message: "El perfil no pertenece al Dashboard compartido." }))
    .toBe("El Dashboard comparativo está disponible exclusivamente para los tres participantes. Tu perfil no forma parte de esta comparación.");
  expect(messageFor({ message: "Error de red." })).toBe("No se pudo cargar el Dashboard. Error de red.");

  await login(page);
  await page.getByRole("button", { name: "Dashboard" }).click();

  // El aviso contextual se presenta tal cual ante el mensaje del servidor y
  // el Dashboard nunca invoca al legacy get_dashboard (la carga es por
  // oposición con la RPC v2), mientras el Historial sigue leyendo
  // personal_attempt_history.
  await expect(page.locator("#dashboard-status")).toContainText(
    "El Dashboard comparativo está disponible exclusivamente para los tres participantes.",
  );
  expect(dashboardRequests.length).toBeGreaterThan(0);
  expect(dashboardRequests.every((value) => value === "administrativo")).toBe(true);
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.locator("#history-opposition")).toHaveText("Oposición consultada: Administrativo");
  expect(historyRequests.length).toBeGreaterThan(0);
  expect(writes).toEqual([]);
});
