import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalogFile = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const packages = await Promise.all(catalogFile.exams.map(async (entry) => ({
  entry,
  exam: JSON.parse(await readFile(new URL(entry.latestPath, bankUrl), "utf8")),
})));
const eligible = packages.flatMap(({ entry, exam }) => exam.questions
  .filter(({ active }) => active)
  .map((question) => ({ entry, exam, question })));

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockArtificialPersistence(page) {
  const state = { attempt: null, answers: [], sources: [], startPayload: null };
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/rpc/get_published_official_exam_versions")) return json(route, catalogFile.exams.map((item) => ({
      exam_id: item.id, exam_version_id: item.latestVersion, exam_version_path: item.latestPath,
    })));
    if (request.method() === "GET" && path.endsWith("/attempts")) {
      return json(route, state.attempt ? [state.attempt] : []);
    }
    if (request.method() === "GET" && path.endsWith("/question_progress")) return json(route, []);
    if (request.method() === "GET" && path.endsWith("/attempt_answers")) return json(route, state.answers);
    if (request.method() === "GET" && path.endsWith("/attempt_question_sources")) return json(route, state.sources);
    if (path.endsWith("/rpc/start_or_resume_artificial_attempt")) {
      state.startPayload = request.postDataJSON();
      const startedAt = new Date();
      state.sources = state.startPayload.p_sources.map((source, position) => ({
        position,
        ...source,
        question_id: `artificial-q${String(position + 1).padStart(3, "0")}`,
      }));
      state.attempt = {
        id: "60000000-0000-4000-8000-000000000014",
        user_id: "10000000-0000-4000-8000-000000000001",
        exam_id: "__artificial__",
        exam_version_id: "materialized-14",
        exam_version_path: "artificial/materialized-14.json",
        question_ids: state.sources.map(({ question_id: questionId }) => questionId),
        kind: state.startPayload.p_mode === "exam" ? "exam" : "normal",
        origin: "artificial",
        principal: false,
        strategy: state.startPayload.p_mode === "exam" ? "artificial_exam" : "artificial_study",
        status: "active",
        current_position: 0,
        active_seconds: 0,
        is_paused: false,
        duration_minutes: state.startPayload.p_mode === "exam" ? 120 : null,
        started_at: state.startPayload.p_mode === "exam" ? startedAt.toISOString() : null,
        deadline_at: state.startPayload.p_mode === "exam"
          ? new Date(startedAt.getTime() + 120 * 60_000).toISOString()
          : null,
        server_now: startedAt.toISOString(),
        revision: 0,
      };
      return json(route, state.attempt);
    }
    if (path.endsWith("/rpc/sync_active_attempt")) {
      const pending = request.postDataJSON().p_pending_snapshot;
      for (const confirmation of pending.study_confirmations) {
        state.answers.push({
          ...confirmation,
          attempt_id: state.attempt.id,
          answer_sequence: 1,
          is_correct: confirmation.selected_option === confirmation.correct_option,
          confirmed_at: new Date().toISOString(),
        });
      }
      for (const answer of pending.exam_answers) {
        state.answers.push({
          ...answer,
          attempt_id: state.attempt.id,
          answer_sequence: 1,
          correct_option: null,
          is_correct: null,
          confirmed_at: new Date().toISOString(),
        });
      }
      state.attempt.current_position = pending.position;
      state.attempt.revision += 1;
      let summary = null;
      if (pending.finalize) {
        state.attempt.status = "completed";
        summary = {
          attempt_id: state.attempt.id,
          correct: 1,
          wrong: 0,
          blank: 74,
          score: 1.33,
          elapsed_ms: 1000,
          new_personal_record: false,
          completed_at: new Date().toISOString(),
        };
      }
      return json(route, { attempt: state.attempt, answers: state.answers, summary });
    }
    return json(route, { message: `Unexpected test request: ${request.method()} ${path}` }, 500);
  });
  return state;
}

async function login(page) {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill(process.env.SAS_TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(process.env.SAS_TEST_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
}

function assertMaterializedSources(sources) {
  expect(sources).toHaveLength(75);
  expect(new Set(sources.map(({ exam_id: examId, source_question_id: questionId }) => `${examId}\0${questionId}`)).size).toBe(75);
  for (const source of sources) {
    const record = eligible.find(({ exam, question }) => exam.id === source.exam_id && question.id === source.source_question_id);
    expect(record).toBeTruthy();
    expect(source.exam_version_id).toBe(record.exam.version.id);
    expect(source.exam_version_path).toBe(record.entry.latestPath);
  }
}

test("Seam 2: Examen artificial entra en estudio con 75 orígenes fijados y corrección inmediata", async ({ page }) => {
  const persistence = await mockArtificialPersistence(page);
  await login(page);
  await page.getByRole("button", { name: "Generar en Modo estudio" }).click();

  await expect(page.locator("#study-panel")).toHaveAttribute("data-origin", "artificial");
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "normal");
  await expect(page.locator("#study-progress")).toHaveText("1 de 75");
  assertMaterializedSources(persistence.startPayload.p_sources);

  const first = persistence.sources[0];
  const record = eligible.find(({ exam, question }) => exam.id === first.exam_id && question.id === first.source_question_id);
  await page.locator(`#answer-options input[value="${record.question.correctOption}"]`).check();
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
  await expect(page.locator("#correction")).toContainText("Correcta");
  await expect(page.getByRole("button", { name: "Pregunta 1: correct" })).toBeVisible();
});

test("Seam 2: Examen artificial entra en T06 con deadline de 120 minutos, blancas y entrega", async ({ page }) => {
  const persistence = await mockArtificialPersistence(page);
  await login(page);
  await page.getByRole("button", { name: "Generar en Modo examen" }).click();

  await expect(page.locator("#study-panel")).toHaveAttribute("data-origin", "artificial");
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "exam");
  await expect(page.locator("#study-progress")).toHaveText("1 de 75");
  expect(persistence.attempt.duration_minutes).toBe(120);
  assertMaterializedSources(persistence.startPayload.p_sources);

  await page.getByRole("button", { name: "Pregunta 75: pendiente" }).click();
  await page.getByRole("button", { name: "Entregar examen" }).click();
  await expect(page.getByRole("dialog")).toContainText("75 en blanco");
  await page.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(page.locator("#summary-score")).toHaveText("1,33 / 100");
  await expect(page.locator("#summary-blank")).toHaveText("74");
  await expect(page.locator("#summary-record")).toBeHidden();
});
