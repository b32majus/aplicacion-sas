import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const entry = catalog.exams.find(({ id }) => id === "sas-administrativo-2021-turno-libre");
const exam = JSON.parse(await readFile(new URL(entry.latestPath, bankUrl), "utf8"));
const questions = exam.questions.filter(({ active }) => active);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockExamPersistence(page, { deadlineMs = 60 * 60 * 1000, finishDelay = 0 } = {}) {
  const state = {
    attempt: null,
    answers: [],
    startPayload: null,
    finishCalls: 0,
  };
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === "GET" && path.endsWith("/attempts")) {
      return json(route, state.attempt ? [state.attempt] : []);
    }
    if (request.method() === "GET" && path.endsWith("/question_progress")) {
      return json(route, []);
    }
    if (request.method() === "GET" && path.endsWith("/attempt_answers")) {
      return json(route, state.answers);
    }
    if (path.endsWith("/rpc/start_or_resume_exam_attempt")) {
      state.startPayload = request.postDataJSON();
      if (!state.attempt) {
        const startedAt = new Date();
        state.attempt = {
          id: "60000000-0000-4000-8000-000000000001",
          user_id: "10000000-0000-4000-8000-000000000001",
          exam_id: exam.id,
          exam_version_id: exam.version.id,
          exam_version_path: entry.latestPath,
          question_ids: [...state.startPayload.p_question_ids],
          kind: "exam",
          principal: false,
          strategy: "exam",
          status: "active",
          current_position: 0,
          duration_minutes: exam.durationMinutes,
          started_at: startedAt.toISOString(),
          deadline_at: new Date(startedAt.getTime() + deadlineMs).toISOString(),
          server_now: startedAt.toISOString(),
          score: null,
          revision: 0,
        };
      } else {
        state.attempt.server_now = new Date().toISOString();
      }
      return json(route, state.attempt);
    }
    if (path.endsWith("/rpc/sync_active_attempt")) {
      const payload = request.postDataJSON();
      if (payload.p_base_revision !== state.attempt.revision) {
        return json(route, {
          message: `STALE_ATTEMPT_REVISION: la revisión remota vigente es ${state.attempt.revision}.`,
        }, 409);
      }
      for (const pending of payload.p_pending_snapshot.exam_answers) {
        const sequence = state.answers.filter(({ question_id: id }) => id === pending.question_id).length + 1;
        state.answers.push({
          id: pending.id,
          attempt_id: state.attempt.id,
          question_id: pending.question_id,
          answer_sequence: sequence,
          selected_option: pending.selected_option,
          correct_option: null,
          is_correct: null,
          confirmed_at: new Date().toISOString(),
        });
      }
      state.attempt.current_position = payload.p_pending_snapshot.position;
      let summary = null;
      if (payload.p_pending_snapshot.finalize) {
        state.finishCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, finishDelay));
        state.attempt.status = "completed";
        state.attempt.completed_at = new Date().toISOString();
        state.attempt.score = 72.5;
        summary = {
          attempt_id: state.attempt.id,
          correct: 112,
          wrong: 30,
          blank: 8,
          score: 72.5,
          elapsed_ms: 1_250_000,
          new_personal_record: true,
          completed_at: state.attempt.completed_at,
        };
      }
      state.attempt.revision += 1;
      return json(route, { attempt: state.attempt, answers: state.answers, summary });
    }
    if (path.endsWith("/rpc/save_exam_answer")) {
      const payload = request.postDataJSON();
      await new Promise((resolve) => setTimeout(resolve, 600));
      const sequence = state.answers.filter(({ question_id: id }) => id === payload.p_question_id).length + 1;
      const answer = {
        id: payload.p_answer_id,
        attempt_id: state.attempt.id,
        question_id: payload.p_question_id,
        answer_sequence: sequence,
        selected_option: payload.p_selected_option,
        correct_option: null,
        is_correct: null,
        confirmed_at: new Date().toISOString(),
      };
      state.answers.push(answer);
      state.attempt.current_position = payload.p_position;
      return json(route, answer);
    }
    if (path.endsWith("/rpc/finish_expired_exam_attempt")) {
      if (!state.attempt || state.attempt.status !== "active" || Date.parse(state.attempt.deadline_at) > Date.now()) {
        return json(route, null);
      }
      state.finishCalls += 1;
      state.attempt.status = "completed";
      state.attempt.completed_at = new Date().toISOString();
      state.attempt.score = 72.5;
      return json(route, {
        attempt_id: state.attempt.id,
        correct: 112,
        wrong: 30,
        blank: 8,
        score: 72.5,
        elapsed_ms: 1_250_000,
        new_personal_record: true,
        completed_at: state.attempt.completed_at,
      });
    }
    if (path.endsWith("/rpc/finish_exam_attempt")) {
      state.finishCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, finishDelay));
      state.attempt.status = "completed";
      state.attempt.completed_at = new Date().toISOString();
      state.attempt.score = 72.5;
      return json(route, {
        attempt_id: state.attempt.id,
        correct: 112,
        wrong: 30,
        blank: 8,
        score: 72.5,
        elapsed_ms: 1_250_000,
        new_personal_record: true,
        completed_at: state.attempt.completed_at,
      });
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

async function openExam(page) {
  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /Modo examen/ }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "exam");
}

test("Seam 2: Modo examen navega, cambia, borra y restaura respuestas sin mostrar corrección", async ({ page }) => {
  const persistence = await mockExamPersistence(page);
  await login(page);
  await openExam(page);

  expect(persistence.startPayload.p_question_ids).toEqual(questions.map(({ id }) => id));
  expect(persistence.startPayload.p_duration_minutes).toBe(exam.durationMinutes);
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", questions[0].id);
  await expect(page.locator("#correction")).toBeHidden();

  const firstOption = questions[0].options[0].id;
  await page.locator(`#answer-options input[value="${firstOption}"]`).check();
  await page.getByRole("button", { name: "Pregunta 2: pendiente" }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", questions[1].id, { timeout: 500 });
  await expect(page.getByRole("button", { name: "Pregunta 1: contestada" })).toBeVisible();

  await page.locator(`#answer-options input[value="${questions[1].options[0].id}"]`).check();
  await page.locator(`#answer-options input[value="${questions[1].options[1].id}"]`).check();
  await page.getByRole("button", { name: "Borrar respuesta" }).click();
  await expect(page.getByRole("button", { name: "Pregunta 2: pendiente" })).toBeVisible();
  await expect(page.locator("#correction")).toBeHidden();

  await expect.poll(() => persistence.answers.length).toBe(4);
  await page.reload();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", questions[1].id);
  await page.getByRole("button", { name: "Pregunta 1: contestada" }).click();
  await expect(page.locator(`#answer-options input[value="${firstOption}"]`)).toBeChecked();
  await expect(page.locator("#correction")).toBeHidden();
});

test("Seam 2: la entrega anticipada confirma contestadas y blancas antes de mostrar nota y récord", async ({ page }) => {
  const persistence = await mockExamPersistence(page);
  await login(page);
  await openExam(page);

  await page.locator(`#answer-options input[value="${questions[0].correctOption}"]`).check();
  await page.getByRole("button", { name: "Entregar examen" }).click();

  const dialog = page.getByRole("dialog", { name: "¿Entregar el examen ahora?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 contestada");
  await expect(dialog).toContainText("149 en blanco");
  expect(persistence.finishCalls).toBe(0);

  await dialog.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(page.getByText("Intento finalizado")).toBeVisible();
  await expect(page.locator("#summary-score")).toHaveText("72,50 / 100");
  await expect(page.locator("#summary-correct")).toHaveText("112");
  await expect(page.locator("#summary-wrong")).toHaveText("30");
  await expect(page.locator("#summary-blank")).toHaveText("8");
  await expect(page.locator("#summary-time")).toHaveText("20 min 50 s");
  await expect(page.getByText("Nuevo récord personal")).toBeVisible();
  expect(persistence.finishCalls).toBe(1);

  await page.getByRole("button", { name: "Volver a exámenes" }).click();
  const card = page.locator(`[data-exam-id="${exam.id}"]`);
  await expect(card.locator(".card-status")).toHaveText("Finalizado");
  await expect(card.locator(".card-best-score")).toHaveText("Mejor nota: 72,50 / 100");
});

test("Seam 2: reabrir tras el deadline bloquea la edición y auto-finaliza", async ({ page }) => {
  const persistence = await mockExamPersistence(page, { deadlineMs: -1000, finishDelay: 800 });
  await login(page);
  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /Modo examen/ }).click();

  await expect(page.locator("#answer-options input").first()).toBeDisabled({ timeout: 500 });
  await expect(page.locator("#active-time")).toHaveText("Tiempo restante: 00:00:00");
  await expect(page.getByText("Intento finalizado")).toBeVisible({ timeout: 10_000 });
  expect(persistence.finishCalls).toBe(1);
});

test("Seam 2: reabrir la ficha tras el deadline cierra el intento sin exigir entrar de nuevo", async ({ page }) => {
  const persistence = await mockExamPersistence(page);
  await login(page);
  await openExam(page);
  await page.getByRole("button", { name: "← Salir del examen" }).click();
  await expect(page.getByRole("heading", { name: exam.title })).toBeVisible();

  persistence.attempt.deadline_at = new Date(Date.now() - 1000).toISOString();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
  const card = page.locator(`[data-exam-id="${exam.id}"]`);
  await expect(card.locator(".card-status")).toHaveText("Finalizado");
  expect(persistence.finishCalls).toBe(1);
});
