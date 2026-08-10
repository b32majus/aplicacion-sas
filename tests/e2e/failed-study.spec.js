import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalogFile = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const exams = await Promise.all(catalogFile.exams.map(async (entry) => {
  const exam = JSON.parse(await readFile(new URL(entry.latestPath, bankUrl), "utf8"));
  return {
    ...entry,
    package: exam,
    questions: exam.questions.filter(({ active }) => active),
  };
}));
const [firstExam, secondExam] = exams;
const questions = new Map(exams.flatMap((exam) => exam.questions.map((question) => [question.id, question])));

async function apiSession(request) {
  const response = await request.post(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    data: {
      email: process.env.SAS_TEST_EMAIL_3,
      password: process.env.SAS_TEST_PASSWORD_3,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).access_token;
}

function headers(token) {
  return {
    apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function sourceFor(exam, question) {
  return {
    exam_id: exam.id,
    exam_version_id: exam.latestVersion,
    exam_version_path: exam.latestPath,
    question_id: question.id,
  };
}

async function postRpc(request, token, name, data) {
  const response = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: headers(token),
    data,
  });
  const text = await response.text();
  expect(response.ok(), `${name}: ${text}`).toBe(true);
  const body = JSON.parse(text);
  return Array.isArray(body) ? body[0] : body;
}

async function completeActiveFailedSession(request, token) {
  const activeResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?kind=eq.failed&status=eq.active&select=id`,
    { headers: headers(token) },
  );
  expect(activeResponse.ok()).toBe(true);
  const [active] = await activeResponse.json();
  if (!active) return;

  const [sourcesResponse, answersResponse] = await Promise.all([
    request.get(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_question_sources?attempt_id=eq.${active.id}&select=question_id`,
      { headers: headers(token) },
    ),
    request.get(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${active.id}&select=question_id`,
      { headers: headers(token) },
    ),
  ]);
  expect(sourcesResponse.ok()).toBe(true);
  expect(answersResponse.ok()).toBe(true);
  const answered = new Set((await answersResponse.json()).map(({ question_id: id }) => id));
  for (const { question_id: questionId } of await sourcesResponse.json()) {
    if (answered.has(questionId)) continue;
    const question = questions.get(questionId);
    await postRpc(request, token, "confirm_failed_answer", {
      p_confirmation_id: crypto.randomUUID(),
      p_attempt_id: active.id,
      p_question_id: question.id,
      p_selected_option: question.correctOption,
      p_correct_option: question.correctOption,
    });
  }
  await postRpc(request, token, "complete_failed_attempt", { p_attempt_id: active.id });
}

async function forcePendingFailure(request, token, exam, question) {
  const activeResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?kind=eq.normal&exam_id=eq.${exam.id}&status=eq.active&select=strategy`,
    { headers: headers(token) },
  );
  expect(activeResponse.ok()).toBe(true);
  const [active] = await activeResponse.json();
  const strategy = active?.strategy === "normal" ? "random" : "normal";
  const attempt = await postRpc(request, token, "start_or_replace_principal_attempt", {
    p_exam_id: exam.id,
    p_exam_version_id: exam.latestVersion,
    p_exam_version_path: exam.latestPath,
    p_question_ids: exam.questions.map(({ id }) => id),
    p_strategy: strategy,
    p_replace_active: true,
  });
  const wrongOption = question.options.find(({ id }) => id !== question.correctOption).id;
  await postRpc(request, token, "confirm_normal_answer", {
    p_confirmation_id: crypto.randomUUID(),
    p_attempt_id: attempt.id,
    p_question_id: question.id,
    p_selected_option: wrongOption,
    p_correct_option: question.correctOption,
  });
  return attempt.id;
}

async function startIsolatedFailed(request, token, scopeExamId, sources) {
  return postRpc(request, token, "start_or_resume_failed_attempt", {
    p_scope_exam_id: scopeExamId,
    p_sources: sources,
  });
}

async function login(page) {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill(process.env.SAS_TEST_EMAIL_3);
  await page.getByLabel("Contraseña").fill(process.env.SAS_TEST_PASSWORD_3);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
}

async function answer(page, question, option = question.correctOption) {
  await page.locator(`#answer-options input[value="${option}"]`).check();
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
}

test("Seam 2: Solo falladas por examen y Todas mis falladas persisten dominio, origen y reanudación", async ({ page, request }) => {
  test.setTimeout(180_000);
  const token = await apiSession(request);
  await completeActiveFailedSession(request, token);
  const firstQuestion = firstExam.questions[0];
  const secondQuestion = secondExam.questions[0];
  const firstPrincipalId = await forcePendingFailure(request, token, firstExam, firstQuestion);
  const secondPrincipalId = await forcePendingFailure(request, token, secondExam, secondQuestion);

  await login(page);
  const progressResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?pending_failure=eq.true&select=exam_id,question_id`,
    { headers: headers(token) },
  );
  const pending = await progressResponse.json();
  for (const exam of exams) {
    const activeIds = new Set(exam.questions.map(({ id }) => id));
    const count = pending.filter((row) => row.exam_id === exam.id && activeIds.has(row.question_id)).length;
    await expect(page.locator(`[data-exam-id="${exam.id}"] .card-failures`)).toHaveText(`${count} Falladas pendientes`);
  }

  const firstSource = sourceFor(firstExam, firstQuestion);
  const firstFailed = await startIsolatedFailed(request, token, firstExam.id, [firstSource]);
  await page.locator(`[data-exam-id="${firstExam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /Solo falladas|Sesión de falladas activa/ }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-attempt-id", firstFailed.id);
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "failed");
  await expect(page.locator("#study-panel")).toHaveAttribute("data-source-exam-id", firstExam.id);
  await expect(page.locator("#study-source")).toContainText(firstExam.title);
  await answer(page, firstQuestion);
  await expect(page.getByText("Intento finalizado")).toBeVisible();
  await expect(page.locator("#summary-mastered")).toHaveText("0");
  await expect(page.locator("#summary-pending")).toHaveText("1");
  await expect(page.locator("#summary-pending-list")).toContainText(firstExam.title);

  const secondFailed = await startIsolatedFailed(request, token, firstExam.id, [firstSource]);
  await page.getByRole("button", { name: "Volver a exámenes" }).click();
  await page.locator(`[data-exam-id="${firstExam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /Solo falladas|Sesión de falladas activa/ }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-attempt-id", secondFailed.id);
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "failed");
  await answer(page, firstQuestion);
  await expect(page.locator("#summary-mastered")).toHaveText("1");
  await expect(page.locator("#summary-pending")).toHaveText("0");
  const confirmationId = await page.locator("#correction").getAttribute("data-confirmation-id");

  const masteredBefore = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${firstExam.id}&question_id=eq.${firstQuestion.id}&select=correct_count,wrong_count,current_streak,mastered,pending_failure`,
    { headers: headers(token) },
  );
  const [masteredProgress] = await masteredBefore.json();
  await postRpc(request, token, "confirm_failed_answer", {
    p_confirmation_id: confirmationId,
    p_attempt_id: await page.locator("#study-panel").getAttribute("data-attempt-id"),
    p_question_id: firstQuestion.id,
    p_selected_option: firstQuestion.correctOption,
    p_correct_option: firstQuestion.correctOption,
  });
  const masteredAfter = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${firstExam.id}&question_id=eq.${firstQuestion.id}&select=correct_count,wrong_count,current_streak,mastered,pending_failure`,
    { headers: headers(token) },
  );
  expect(await masteredAfter.json()).toEqual([masteredProgress]);

  await forcePendingFailure(request, token, firstExam, firstQuestion);
  const allFailed = await startIsolatedFailed(request, token, null, [firstSource, sourceFor(secondExam, secondQuestion)]);
  await page.getByRole("button", { name: "Volver a exámenes" }).click();
  await page.getByRole("button", { name: /Todas mis falladas|Sesión de falladas activa/ }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-attempt-id", allFailed.id);
  await answer(page, firstQuestion);
  await page.getByRole("button", { name: "Siguiente pendiente" }).click();
  await expect(page.locator("#study-source")).toContainText(secondExam.title);
  await page.getByRole("button", { name: "Pausar" }).click();
  await page.getByRole("button", { name: "Salir y guardar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /Todas mis falladas|Sesión de falladas activa/ }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-attempt-id", allFailed.id);
  await expect(page.getByText("Estudio en pausa")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pregunta 1: correct" })).toBeVisible();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", secondQuestion.id);
  await page.getByRole("button", { name: "Reanudar" }).click();
  const wrongOption = secondQuestion.options.find(({ id }) => id !== secondQuestion.correctOption).id;
  await answer(page, secondQuestion, wrongOption);
  await expect(page.locator("#summary-mastered")).toHaveText("0");
  await expect(page.locator("#summary-pending")).toHaveText("2");
  await expect(page.locator("#summary-pending-list")).toContainText(firstExam.title);
  await expect(page.locator("#summary-pending-list")).toContainText(secondExam.title);

  const principalResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=in.(${firstPrincipalId},${secondPrincipalId})&select=id,kind`,
    { headers: headers(token) },
  );
  expect(await principalResponse.json()).toEqual(expect.arrayContaining([
    { id: firstPrincipalId, kind: "normal" },
    { id: secondPrincipalId, kind: "normal" },
  ]));
});
