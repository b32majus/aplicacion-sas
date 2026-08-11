import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const catalogEntry = catalog.exams.find(({ id }) => id === "sas-administrativo-2021-turno-libre");
const exam = JSON.parse(await readFile(new URL(catalogEntry.latestPath, bankUrl), "utf8"));
const questions = new Map(exam.questions.filter(({ active }) => active).map((question) => [question.id, question]));

async function login(page, suffix = "") {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill(process.env[`SAS_TEST_EMAIL${suffix}`]);
  await page.getByLabel("Contraseña").fill(process.env[`SAS_TEST_PASSWORD${suffix}`]);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
}

async function apiSession(request, suffix) {
  const response = await request.post(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: {
      "apikey": process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
    "apikey": process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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

async function currentQuestion(page) {
  const id = await page.locator("#study-panel").getAttribute("data-question-id");
  return questions.get(id);
}

async function choose(page, optionId) {
  await page.locator(`#answer-options input[value="${optionId}"]`).check();
}

async function chooseCorrectAndConfirm(page) {
  const question = await currentQuestion(page);
  await choose(page, question.correctOption);
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
  await expect(page.locator("#correction")).toContainText("Correcta.");
}

async function openRealExam(page) {
  const card = page.locator(`[data-exam-id="${exam.id}"]`);
  await card.getByRole("button", { name: "Elegir examen" }).click();
  await expect(page.getByRole("heading", { name: exam.title })).toBeVisible();
  await page.getByRole("button", { name: /estudio normal/i }).click();
  await expect(page.locator("#study-panel")).toBeVisible();

  if (await page.getByRole("button", { name: "Completar y ver resumen" }).isVisible()) {
    await page.getByRole("button", { name: "Completar y ver resumen" }).click();
    await expect(page.getByText("Intento finalizado")).toBeVisible();
    await page.getByRole("button", { name: "Volver a exámenes" }).click();
    await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
    await page.getByRole("button", { name: /estudio normal/i }).click();
  }
}

test("Seam 2 regresión A: la última respuesta completa el estudio y muestra el resumen", async ({ page, request }) => {
  test.setTimeout(360_000);
  const token = await apiSession(request, "_3");
  await completeActiveAttempt(request, token);
  await login(page, "_3");
  await openRealExam(page);

  const attemptId = await page.locator("#study-panel").getAttribute("data-attempt-id");
  const attemptsResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${attemptId}&select=question_ids`,
    { headers: apiHeaders(token) },
  );
  expect(attemptsResponse.ok()).toBe(true);
  const [{ question_ids: questionIds }] = await attemptsResponse.json();
  const finalPendingId = await page.locator("#study-panel").getAttribute("data-question-id");

  for (const questionId of questionIds) {
    if (questionId === finalPendingId) continue;
    const question = questions.get(questionId);
    const confirmation = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/confirm_normal_answer`, {
      headers: apiHeaders(token),
      data: {
        p_confirmation_id: crypto.randomUUID(),
        p_attempt_id: attemptId,
        p_question_id: question.id,
        p_selected_option: question.correctOption,
        p_correct_option: question.correctOption,
      },
    });
    expect(confirmation.ok()).toBe(true);
  }

  await page.reload();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", finalPendingId);
  await choose(page, questions.get(finalPendingId).correctOption);
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();

  await expect(page.getByText("Intento finalizado")).toBeVisible();
});

test("Seam 2 regresión B: la navegación numerada muestra la pregunta antes de guardar", async ({ page, request }) => {
  const token = await apiSession(request, "_2");
  await completeActiveAttempt(request, token);
  await login(page, "_2");
  await openRealExam(page);

  let finishSave;
  const saveFinished = new Promise((resolve) => { finishSave = resolve; });
  await page.route("**/rest/v1/rpc/save_normal_attempt", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
    finishSave();
  });

  const targetQuestionId = [...questions.keys()][1];
  await page.getByRole("button", { name: "Pregunta 2: pending" }).click();

  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", targetQuestionId, { timeout: 500 });
  await saveFinished;
});

test("Seam 2 regresión C: confirmar corrige y bloquea localmente antes de persistir", async ({ page, request }) => {
  const token = await apiSession(request, "");
  await completeActiveAttempt(request, token);
  await login(page);
  await openRealExam(page);

  await page.route("**/rest/v1/rpc/confirm_normal_answer", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  const question = await currentQuestion(page);
  const wrongOption = question.options.find(({ id }) => id !== question.correctOption).id;
  await choose(page, wrongOption);
  const confirmationFinished = page.waitForResponse((response) => (
    response.url().endsWith("/rest/v1/rpc/confirm_normal_answer")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();

  await expect(page.locator("#correction")).toContainText(
    `Incorrecta. La respuesta oficial es ${question.correctOption}.`,
    { timeout: 500 },
  );
  await expect(page.locator(`#answer-options input[value="${wrongOption}"]`)).toBeDisabled({ timeout: 500 });
  expect((await confirmationFinished).ok()).toBe(true);
});

test("Seam 2 regresión D: una confirmación incierta se reintenta sin recargar y sin duplicar efectos", async ({ page, request }) => {
  const token = await apiSession(request, "");
  await completeActiveAttempt(request, token);
  await login(page);
  await openRealExam(page);

  const attemptId = await page.locator("#study-panel").getAttribute("data-attempt-id");
  const question = await currentQuestion(page);
  const wrongOption = question.options.find(({ id }) => id !== question.correctOption).id;
  const progressResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${exam.id}&question_id=eq.${question.id}&select=correct_count,wrong_count,current_streak,mastered,pending_failure`,
    { headers: apiHeaders(token) },
  );
  expect(progressResponse.ok()).toBe(true);
  const [existingProgress] = await progressResponse.json();
  const progressBefore = existingProgress || {
    correct_count: 0,
    wrong_count: 0,
    current_streak: 0,
    mastered: false,
    pending_failure: false,
  };

  const confirmationPayloads = [];
  let firstRequestFinished;
  const firstRequestReachedServer = new Promise((resolve) => { firstRequestFinished = resolve; });
  await page.route("**/rest/v1/rpc/confirm_normal_answer", async (route) => {
    confirmationPayloads.push(route.request().postDataJSON());
    if (confirmationPayloads.length === 1) {
      const response = await route.fetch();
      firstRequestFinished(response.status());
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await choose(page, wrongOption);
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();

  expect(await firstRequestReachedServer).toBe(200);
  await expect(page.locator("#correction")).toContainText(
    `Incorrecta. La respuesta oficial es ${question.correctOption}.`,
  );
  await expect(page.locator(`#answer-options input[value="${wrongOption}"]`)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reintentar confirmación" })).toBeVisible();

  const retryFinished = page.waitForResponse((response) => (
    response.url().endsWith("/rest/v1/rpc/confirm_normal_answer")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Reintentar confirmación" }).click();
  expect((await retryFinished).ok()).toBe(true);
  expect(confirmationPayloads).toHaveLength(2);
  expect(confirmationPayloads[1]).toEqual(confirmationPayloads[0]);

  const [{ p_confirmation_id: confirmationId }] = confirmationPayloads;
  const answersResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${attemptId}&question_id=eq.${question.id}&select=id,selected_option,correct_option,is_correct`,
    { headers: apiHeaders(token) },
  );
  expect(answersResponse.ok()).toBe(true);
  expect(await answersResponse.json()).toEqual([{
    id: confirmationId,
    selected_option: wrongOption,
    correct_option: question.correctOption,
    is_correct: false,
  }]);

  const progressAfterResponse = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${exam.id}&question_id=eq.${question.id}&select=correct_count,wrong_count,current_streak,mastered,pending_failure`,
    { headers: apiHeaders(token) },
  );
  expect(progressAfterResponse.ok()).toBe(true);
  expect(await progressAfterResponse.json()).toEqual([{
    correct_count: progressBefore.correct_count,
    wrong_count: progressBefore.wrong_count + 1,
    current_streak: 0,
    mastered: false,
    pending_failure: true,
  }]);
});

test("Seam 2: estudio normal real, persistencia, idempotencia, RLS y resumen", async ({ page, request }) => {
  test.setTimeout(360_000);
  const ownerToken = await apiSession(request, "_3");
  await completeActiveAttempt(request, ownerToken);
  await login(page, "_3");
  await openRealExam(page);

  await expect(page.locator("#version-pin")).toContainText(exam.version.id);
  await expect(page.locator("#version-pin")).toHaveAttribute("data-version-path", catalogEntry.latestPath);
  const attemptId = await page.locator("#study-panel").getAttribute("data-attempt-id");

  if (await page.locator("#correction").isVisible()) {
    await page.getByRole("button", { name: "Siguiente pendiente" }).click();
  }

  const first = await currentQuestion(page);
  const firstWrong = first.options.find(({ id }) => id !== first.correctOption).id;
  await choose(page, firstWrong);
  await choose(page, first.correctOption);
  await expect(page.locator(`#answer-options input[value="${first.correctOption}"]`)).toBeChecked();
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
  await expect(page.locator("#correction")).toContainText(`Correcta. La respuesta oficial es ${first.correctOption}.`);

  await page.getByRole("button", { name: "Siguiente pendiente" }).click();
  const failed = await currentQuestion(page);
  const failedWrong = failed.options.find(({ id }) => id !== failed.correctOption).id;
  await choose(page, failedWrong);
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
  await expect(page.locator("#correction")).toContainText(`Incorrecta. La respuesta oficial es ${failed.correctOption}.`);
  const confirmationId = await page.locator("#correction").getAttribute("data-confirmation-id");

  const progressBefore = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${exam.id}&question_id=eq.${failed.id}&select=wrong_count,current_streak,pending_failure`,
    { headers: apiHeaders(ownerToken) },
  );
  expect(progressBefore.ok()).toBe(true);
  const beforeRows = await progressBefore.json();
  expect(beforeRows).toHaveLength(1);

  const duplicate = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/confirm_normal_answer`, {
    headers: apiHeaders(ownerToken),
    data: {
      p_confirmation_id: confirmationId,
      p_attempt_id: attemptId,
      p_question_id: failed.id,
      p_selected_option: failedWrong,
      p_correct_option: failed.correctOption,
    },
  });
  expect(duplicate.ok()).toBe(true);
  const duplicateRows = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?id=eq.${confirmationId}&select=id`,
    { headers: apiHeaders(ownerToken) },
  );
  expect(await duplicateRows.json()).toHaveLength(1);
  const secondConfirmation = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/confirm_normal_answer`, {
    headers: apiHeaders(ownerToken),
    data: {
      p_confirmation_id: crypto.randomUUID(),
      p_attempt_id: attemptId,
      p_question_id: failed.id,
      p_selected_option: failed.correctOption,
      p_correct_option: failed.correctOption,
    },
  });
  expect(secondConfirmation.ok()).toBe(false);
  const lockedRows = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${attemptId}&question_id=eq.${failed.id}&select=id`,
    { headers: apiHeaders(ownerToken) },
  );
  expect(await lockedRows.json()).toHaveLength(1);
  const progressAfter = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/question_progress?exam_id=eq.${exam.id}&question_id=eq.${failed.id}&select=wrong_count,current_streak,pending_failure`,
    { headers: apiHeaders(ownerToken) },
  );
  expect(await progressAfter.json()).toEqual(beforeRows);

  await page.getByRole("button", { name: "Siguiente pendiente" }).click();
  const skippedId = await page.locator("#study-panel").getAttribute("data-question-id");
  const positionText = await page.locator("#study-progress").textContent();
  const skippedPosition = Number(positionText.match(/^(\d+)/)[1]);
  await page.getByRole("button", { name: "Saltar" }).click();
  await expect(page.getByRole("button", { name: `Pregunta ${skippedPosition}: pending` })).toBeVisible();
  await page.getByRole("button", { name: `Pregunta ${skippedPosition}: pending` }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", skippedId);

  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByText("Estudio en pausa")).toBeVisible();
  await page.reload();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-attempt-id", attemptId);
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", skippedId);
  await expect(page.getByText("Estudio en pausa")).toBeVisible();
  await page.getByRole("button", { name: "Reanudar" }).click();

  const otherToken = await apiSession(request, "_2");
  const hiddenAttempt = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempts?id=eq.${attemptId}&select=id`,
    { headers: apiHeaders(otherToken) },
  );
  expect(hiddenAttempt.ok()).toBe(true);
  expect(await hiddenAttempt.json()).toEqual([]);
  const hiddenAnswers = await request.get(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/attempt_answers?attempt_id=eq.${attemptId}&select=id`,
    { headers: apiHeaders(otherToken) },
  );
  expect(hiddenAnswers.ok()).toBe(true);
  expect(await hiddenAnswers.json()).toEqual([]);
  const forbiddenSave = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/save_normal_attempt`, {
    headers: apiHeaders(otherToken),
    data: { p_save_id: crypto.randomUUID(), p_attempt_id: attemptId, p_position: 0, p_active_seconds: 0, p_is_paused: false },
  });
  expect(forbiddenSave.ok()).toBe(false);

  for (let guard = 0; guard < 400; guard += 1) {
    if (await page.getByText("Intento finalizado").isVisible()) break;
    if (await page.getByRole("button", { name: "Completar y ver resumen" }).isVisible()) {
      await expect(page.getByText("Intento finalizado")).toBeVisible();
      break;
    }
    if (await page.locator("#correction").isVisible()) {
      await page.getByRole("button", { name: "Siguiente pendiente" }).click();
    } else {
      await chooseCorrectAndConfirm(page);
    }
  }

  await expect(page.getByText("Intento finalizado")).toBeVisible();
  await expect(page.locator(".question-number.pending")).toHaveCount(0);
  await expect(page.locator(".question-number.incorrect")).not.toHaveCount(0);
  await expect(page.locator("#summary-correct")).not.toHaveText("0");
  await expect(page.locator("#summary-wrong")).not.toHaveText("0");
  await expect(page.locator("#summary-accuracy")).toContainText("%");
  await expect(page.locator("#summary-time")).toBeVisible();
  await expect(page.locator("#summary-pending")).toBeVisible();
  await expect(page.locator("#summary-mastered")).toBeVisible();

  await page.getByRole("button", { name: "Volver a exámenes" }).click();
  await expect(page.locator(`[data-exam-id="${exam.id}"] .card-status`)).toHaveText("Finalizado");

  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /estudio normal/i }).click();
  await expect(page.locator("#study-panel")).toBeVisible();
  await page.getByRole("button", { name: /Salir y guardar/ }).click();
  await page.getByRole("button", { name: "Volver a exámenes" }).click();
  await expect(page.locator(`[data-exam-id="${exam.id}"] .card-status`)).toHaveText("Finalizado");
  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await expect(page.getByRole("button", { name: "Continuar estudio normal" })).toBeVisible();
});
