import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const catalogEntry = catalog.exams.find(({ id }) => id === "sas-administrativo-2021-turno-libre");
const exam = JSON.parse(await readFile(new URL(catalogEntry.latestPath, bankUrl), "utf8"));
const questions = new Map(exam.questions.filter(({ active }) => active).map((question) => [question.id, question]));

async function login(page, suffix = "_3") {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill(process.env[`SAS_TEST_EMAIL${suffix}`]);
  await page.getByLabel("Contraseña").fill(process.env[`SAS_TEST_PASSWORD${suffix}`]);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
}

async function apiSession(request, suffix = "_3") {
  const response = await request.post(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    data: {
      email: process.env[`SAS_TEST_EMAIL${suffix}`],
      password: process.env[`SAS_TEST_PASSWORD${suffix}`],
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).access_token;
}

function apiHeaders(token) {
  return {
    apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function completeActiveAttempt(request, token) {
  const attemptsResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?exam_id=eq.${exam.id}&status=eq.active&select=id,question_ids`,
    { headers: apiHeaders(token) },
  );
  expect(attemptsResponse.ok()).toBe(true);
  const [attempt] = await attemptsResponse.json();
  if (!attempt) return;

  const answersResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${attempt.id}&select=question_id`,
    { headers: apiHeaders(token) },
  );
  expect(answersResponse.ok()).toBe(true);
  const answeredIds = new Set((await answersResponse.json()).map(({ question_id }) => question_id));

  for (const questionId of attempt.question_ids) {
    if (answeredIds.has(questionId)) continue;
    const question = questions.get(questionId);
    const confirmation = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/confirm_normal_answer`, {
      headers: apiHeaders(token),
      data: {
        p_confirmation_id: crypto.randomUUID(),
        p_attempt_id: attempt.id,
        p_question_id: question.id,
        p_selected_option: question.correctOption,
        p_correct_option: question.correctOption,
      },
    });
    expect(confirmation.ok()).toBe(true);
  }

  const completion = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/complete_normal_attempt`, {
    headers: apiHeaders(token),
    data: { p_attempt_id: attempt.id },
  });
  expect(completion.ok()).toBe(true);
}

async function openExam(page) {
  const card = page.locator(`[data-exam-id="${exam.id}"]`);
  await card.getByRole("button", { name: "Elegir examen" }).click();
  await expect(page.getByRole("heading", { name: exam.title })).toBeVisible();
}

async function progressFor(request, token, questionId) {
  const response = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${exam.id}&question_id=eq.${questionId}&select=correct_count,wrong_count,current_streak,mastered,pending_failure`,
    { headers: apiHeaders(token) },
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

test("Seam 2: orden aleatorio persiste, relega saltadas y completa sin repeticiones", async ({ page, request }) => {
  test.setTimeout(360_000);
  const token = await apiSession(request);
  await completeActiveAttempt(request, token);
  await login(page);
  await openExam(page);

  await page.getByRole("button", { name: "Empezar estudio aleatorio" }).click();
  await expect(page.getByText("Estudio aleatorio", { exact: true })).toBeVisible();

  const attemptId = await page.locator("#study-panel").getAttribute("data-attempt-id");
  const attemptResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${attemptId}&select=question_ids,strategy,status`,
    { headers: apiHeaders(token) },
  );
  expect(attemptResponse.ok()).toBe(true);
  const [createdAttempt] = await attemptResponse.json();
  expect(createdAttempt.strategy).toBe("random");
  expect(createdAttempt.status).toBe("active");
  expect(createdAttempt.question_ids).toHaveLength(questions.size);
  expect(new Set(createdAttempt.question_ids).size).toBe(questions.size);
  expect([...createdAttempt.question_ids].sort()).toEqual([...questions.keys()].sort());

  const skippedId = createdAttempt.question_ids[0];
  const progressBeforeSkip = await progressFor(request, token, skippedId);
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", skippedId);
  await page.getByRole("button", { name: "Saltar" }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", createdAttempt.question_ids[1]);

  const skippedAnswersResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${attemptId}&question_id=eq.${skippedId}&select=id`,
    { headers: apiHeaders(token) },
  );
  expect(skippedAnswersResponse.ok()).toBe(true);
  expect(await skippedAnswersResponse.json()).toEqual([]);
  expect(await progressFor(request, token, skippedId)).toEqual(progressBeforeSkip);

  await page.getByRole("button", { name: "Salir y guardar" }).click();
  await page.getByRole("button", { name: "Continuar estudio aleatorio" }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-attempt-id", attemptId);
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", createdAttempt.question_ids[1]);

  const reopenedResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${attemptId}&select=question_ids`,
    { headers: apiHeaders(token) },
  );
  expect(reopenedResponse.ok()).toBe(true);
  expect(await reopenedResponse.json()).toEqual([{ question_ids: createdAttempt.question_ids }]);

  for (const questionId of createdAttempt.question_ids.slice(1)) {
    const question = questions.get(questionId);
    const confirmation = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/confirm_normal_answer`, {
      headers: apiHeaders(token),
      data: {
        p_confirmation_id: crypto.randomUUID(),
        p_attempt_id: attemptId,
        p_question_id: questionId,
        p_selected_option: question.correctOption,
        p_correct_option: question.correctOption,
      },
    });
    expect(confirmation.ok()).toBe(true);
  }

  await page.reload();
  await page.getByRole("button", { name: "Siguiente pendiente" }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", skippedId);
  await page.locator(`#answer-options input[value="${questions.get(skippedId).correctOption}"]`).check();
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();

  await expect(page.getByText("Intento finalizado")).toBeVisible();
  await expect(page.locator(".question-number.pending")).toHaveCount(0);
  const completedResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${attemptId}&select=status`,
    { headers: apiHeaders(token) },
  );
  expect(await completedResponse.json()).toEqual([{ status: "completed" }]);
});

test("Seam 2: sustituye el recorrido principal con advertencia e historial intacto", async ({ page, request }) => {
  test.setTimeout(360_000);
  const token = await apiSession(request, "_2");
  await completeActiveAttempt(request, token);
  await login(page, "_2");
  await openExam(page);

  await page.getByRole("button", { name: "Empezar estudio normal" }).click();
  await expect(page.getByText("Estudio normal", { exact: true })).toBeVisible();
  const normalAttemptId = await page.locator("#study-panel").getAttribute("data-attempt-id");
  const normalQuestionId = await page.locator("#study-panel").getAttribute("data-question-id");
  const normalQuestion = questions.get(normalQuestionId);
  await page.locator(`#answer-options input[value="${normalQuestion.correctOption}"]`).check();
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
  await expect(page.locator("#correction")).toContainText("Correcta.");
  await page.getByRole("button", { name: "Salir y guardar" }).click();
  await expect(page.getByRole("button", { name: "Cambiar a estudio aleatorio" })).toBeVisible();

  const normalBeforeResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${normalAttemptId}&select=id,question_ids,current_position,active_seconds,strategy,status,completed_at`,
    { headers: apiHeaders(token) },
  );
  expect(normalBeforeResponse.ok()).toBe(true);
  const [normalBefore] = await normalBeforeResponse.json();
  const normalAnswersBeforeResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${normalAttemptId}&select=id,question_id,selected_option,correct_option,is_correct`,
    { headers: apiHeaders(token) },
  );
  expect(normalAnswersBeforeResponse.ok()).toBe(true);
  const normalAnswersBefore = await normalAnswersBeforeResponse.json();
  expect(normalAnswersBefore).toHaveLength(1);

  await page.getByRole("button", { name: "Cambiar a estudio aleatorio" }).click();
  const warning = page.getByRole("dialog", { name: "El recorrido actual quedará abandonado" });
  await expect(warning).toContainText("Cambiar de Orden normal a Orden aleatorio");
  await warning.getByRole("button", { name: "Cancelar" }).click();
  await expect(warning).not.toBeVisible();

  const unchangedResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${normalAttemptId}&select=id,question_ids,current_position,active_seconds,strategy,status,completed_at`,
    { headers: apiHeaders(token) },
  );
  expect(await unchangedResponse.json()).toEqual([normalBefore]);

  await page.getByRole("button", { name: "Cambiar a estudio aleatorio" }).click();
  await warning.getByRole("button", { name: "Cambiar estrategia" }).click();
  await expect(page.getByText("Estudio aleatorio", { exact: true })).toBeVisible();
  const randomAttemptId = await page.locator("#study-panel").getAttribute("data-attempt-id");
  expect(randomAttemptId).not.toBe(normalAttemptId);

  const abandonedNormalResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${normalAttemptId}&select=id,question_ids,current_position,active_seconds,strategy,status,completed_at,abandoned_at`,
    { headers: apiHeaders(token) },
  );
  const [abandonedNormal] = await abandonedNormalResponse.json();
  expect(abandonedNormal).toEqual({ ...normalBefore, status: "abandoned", abandoned_at: expect.any(String) });
  const normalAnswersAfterResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${normalAttemptId}&select=id,question_id,selected_option,correct_option,is_correct`,
    { headers: apiHeaders(token) },
  );
  expect(await normalAnswersAfterResponse.json()).toEqual(normalAnswersBefore);

  const activeRandomResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?exam_id=eq.${exam.id}&status=eq.active&select=id,strategy`,
    { headers: apiHeaders(token) },
  );
  expect(await activeRandomResponse.json()).toEqual([{ id: randomAttemptId, strategy: "random" }]);

  await page.getByRole("button", { name: "Salir y guardar" }).click();
  await page.getByRole("button", { name: "Cambiar a estudio normal" }).click();
  await expect(warning).toContainText("Cambiar de Orden aleatorio a Orden normal");
  await warning.getByRole("button", { name: "Cambiar estrategia" }).click();
  await expect(page.getByText("Estudio normal", { exact: true })).toBeVisible();
  const replacementNormalId = await page.locator("#study-panel").getAttribute("data-attempt-id");
  expect(replacementNormalId).not.toBe(randomAttemptId);

  const replacedRowsResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=in.(${randomAttemptId},${replacementNormalId})&select=id,strategy,status,abandoned_at`,
    { headers: apiHeaders(token) },
  );
  expect(replacedRowsResponse.ok()).toBe(true);
  const replacedRows = await replacedRowsResponse.json();
  expect(replacedRows).toEqual(expect.arrayContaining([
    { id: randomAttemptId, strategy: "random", status: "abandoned", abandoned_at: expect.any(String) },
    { id: replacementNormalId, strategy: "normal", status: "active", abandoned_at: null },
  ]));
  expect(replacedRows).toHaveLength(2);
});
