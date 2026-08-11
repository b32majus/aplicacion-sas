import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const entry = catalog.exams.find(({ id }) => id === "sas-administrativo-2021-turno-libre");
const exam = JSON.parse(await readFile(new URL(entry.latestPath, bankUrl), "utf8"));
const questions = exam.questions.filter(({ active }) => active);

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function studyState() {
  return {
    online: true,
    successfulSyncs: 0,
    rejectedSyncs: [],
    syncedSnapshots: [],
    attempt: {
      id: "20000000-0000-4000-8000-000000000071",
      user_id: "10000000-0000-4000-8000-000000000071",
      exam_id: exam.id,
      exam_version_id: exam.version.id,
      exam_version_path: entry.latestPath,
      question_ids: questions.map(({ id }) => id),
      kind: "normal",
      principal: true,
      strategy: "normal",
      status: "active",
      current_position: 0,
      active_seconds: 0,
      is_paused: false,
      revision: 0,
    },
    answers: [],
  };
}

async function mockStudyPersistence(page, state = studyState()) {
  await installConnectivitySeam(page);
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!state.online) return route.abort("connectionreset");
    if (path.endsWith("/rpc/get_published_official_exam_versions")) return json(route, catalog.exams.map((item) => ({
      exam_id: item.id, exam_version_id: item.latestVersion, exam_version_path: item.latestPath,
    })));
    if (request.method() === "GET" && path.endsWith("/attempts")) return json(route, [state.attempt]);
    if (request.method() === "GET" && path.endsWith("/question_progress")) return json(route, state.progress || []);
    if (request.method() === "GET" && path.endsWith("/attempt_answers")) return json(route, state.answers);
    if (request.method() === "GET" && path.endsWith("/attempt_question_sources")) return json(route, state.sources || []);
    if (path.endsWith("/rpc/start_or_replace_principal_attempt")) return json(route, state.attempt);
    if (path.endsWith("/rpc/start_or_resume_failed_attempt")) return json(route, state.attempt);
    if (path.endsWith("/rpc/sync_active_attempt")) {
      const payload = request.postDataJSON();
      if (payload.p_base_revision !== state.attempt.revision) {
        state.rejectedSyncs.push({
          baseRevision: payload.p_base_revision,
          remoteRevision: state.attempt.revision,
          snapshot: payload.p_pending_snapshot,
        });
        return json(route, {
          message: `STALE_ATTEMPT_REVISION: la revisión remota vigente es ${state.attempt.revision}.`,
        }, 409);
      }
      state.successfulSyncs += 1;
      state.syncedSnapshots.push(payload.p_pending_snapshot);
      for (const confirmation of payload.p_pending_snapshot.study_confirmations) {
        if (state.answers.some(({ id }) => id === confirmation.id)) continue;
        state.answers.push({
          id: confirmation.id,
          attempt_id: state.attempt.id,
          question_id: confirmation.question_id,
          answer_sequence: 1,
          selected_option: confirmation.selected_option,
          correct_option: confirmation.correct_option,
          is_correct: confirmation.selected_option === confirmation.correct_option,
          confirmed_at: new Date().toISOString(),
        });
      }
      state.attempt.current_position = payload.p_pending_snapshot.position;
      state.attempt.is_paused = payload.p_pending_snapshot.is_paused;
      state.attempt.active_seconds += payload.p_pending_snapshot.active_increments
        .reduce((total, increment) => total + increment.seconds, 0);
      state.attempt.revision += 1;
      return json(route, { attempt: state.attempt, answers: state.answers, summary: null });
    }
    return json(route, { message: `Unexpected test request: ${request.method()} ${path}` }, 500);
  });
  return state;
}

function examState({ nowMs = Date.now(), deadlineMs = 60 * 60 * 1000 } = {}) {
  const startedAt = new Date(nowMs).toISOString();
  return {
    online: true,
    successfulSyncs: 0,
    finalizations: 0,
    syncedSnapshots: [],
    blockNextSync: false,
    syncStarted: false,
    releaseSync: null,
    rejectNonFinalizing: false,
    rejectExamAnswers: false,
    rejectedLateAnswers: 0,
    attempt: {
      id: "20000000-0000-4000-8000-000000000072",
      user_id: "10000000-0000-4000-8000-000000000071",
      exam_id: exam.id,
      exam_version_id: exam.version.id,
      exam_version_path: entry.latestPath,
      question_ids: questions.map(({ id }) => id),
      kind: "exam",
      principal: false,
      strategy: "exam",
      status: "active",
      current_position: 0,
      duration_minutes: exam.durationMinutes,
      started_at: startedAt,
      deadline_at: new Date(nowMs + deadlineMs).toISOString(),
      server_now: startedAt,
      score: null,
      revision: 0,
    },
    answers: [],
  };
}

async function mockExamPersistence(page, state = examState()) {
  await installConnectivitySeam(page);
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!state.online) return route.abort("connectionreset");
    if (path.endsWith("/rpc/get_published_official_exam_versions")) return json(route, catalog.exams.map((item) => ({
      exam_id: item.id, exam_version_id: item.latestVersion, exam_version_path: item.latestPath,
    })));
    if (request.method() === "GET" && path.endsWith("/attempts")) return json(route, [state.attempt]);
    if (request.method() === "GET" && path.endsWith("/question_progress")) return json(route, []);
    if (request.method() === "GET" && path.endsWith("/attempt_answers")) return json(route, state.answers);
    if (path.endsWith("/rpc/start_or_resume_exam_attempt")) return json(route, state.attempt);
    if (path.endsWith("/rpc/finish_expired_exam_attempt")) return json(route, null);
    if (path.endsWith("/rpc/sync_active_attempt")) {
      const payload = request.postDataJSON();
      if (state.blockNextSync) {
        state.blockNextSync = false;
        state.syncStarted = true;
        await new Promise((resolve) => { state.releaseSync = resolve; });
      }
      if (state.rejectExamAnswers && payload.p_pending_snapshot.exam_answers.length > 0) {
        state.rejectedLateAnswers += 1;
        return json(route, { message: "El deadline del Modo examen ya ha vencido." }, 409);
      }
      if (state.rejectNonFinalizing && !payload.p_pending_snapshot.finalize) {
        return json(route, { message: "El deadline del Modo examen ya ha vencido." }, 409);
      }
      if (state.attempt.status !== "active") {
        return json(route, { message: "El intento ya no está activo." }, 409);
      }
      if (payload.p_base_revision !== state.attempt.revision) {
        return json(route, {
          message: `STALE_ATTEMPT_REVISION: la revisión remota vigente es ${state.attempt.revision}.`,
        }, 409);
      }
      state.successfulSyncs += 1;
      state.syncedSnapshots.push(payload.p_pending_snapshot);
      for (const pending of payload.p_pending_snapshot.exam_answers) {
        if (state.answers.some(({ id }) => id === pending.id)) continue;
        state.answers.push({
          id: pending.id,
          attempt_id: state.attempt.id,
          question_id: pending.question_id,
          answer_sequence: state.answers.filter(({ question_id: id }) => id === pending.question_id).length + 1,
          selected_option: pending.selected_option,
          correct_option: null,
          is_correct: null,
          confirmed_at: new Date().toISOString(),
        });
      }
      state.attempt.current_position = payload.p_pending_snapshot.position;
      state.attempt.revision += 1;
      let summary = null;
      if (payload.p_pending_snapshot.finalize) {
        state.finalizations += 1;
        state.attempt.status = "completed";
        state.attempt.completed_at = new Date().toISOString();
        state.attempt.score = 100;
        summary = {
          attempt_id: state.attempt.id,
          correct: 2,
          wrong: 0,
          blank: questions.length - 2,
          score: 100,
          elapsed_ms: Date.parse(state.attempt.deadline_at) - Date.parse(state.attempt.started_at),
          new_personal_record: true,
          completed_at: state.attempt.completed_at,
        };
      }
      const returnedAttempt = { ...state.attempt };
      delete returnedAttempt.server_now;
      return json(route, { attempt: returnedAttempt, answers: state.answers, summary });
    }
    return json(route, { message: `Unexpected test request: ${request.method()} ${path}` }, 500);
  });
  return state;
}

async function installConnectivitySeam(page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => localStorage.getItem("sas-test-offline") !== "true",
    });
  });
}

async function setBackendOffline(page, state, offline) {
  state.online = !offline;
  await page.evaluate((nextOffline) => {
    if (nextOffline) localStorage.setItem("sas-test-offline", "true");
    else localStorage.removeItem("sas-test-offline");
    window.dispatchEvent(new Event(nextOffline ? "offline" : "online"));
  }, offline);
}

async function login(page) {
  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill(process.env.SAS_TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(process.env.SAS_TEST_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
}

async function openStudy(page) {
  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /estudio normal/i }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "normal");
}

async function openExam(page) {
  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /Modo examen/i }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "exam");
}

async function confirmCurrent(page) {
  const questionId = await page.locator("#study-panel").getAttribute("data-question-id");
  const question = questions.find(({ id }) => id === questionId);
  await page.locator(`#answer-options input[value="${question.correctOption}"]`).check();
  await page.getByRole("button", { name: "Confirmar respuesta" }).click();
  await expect(page.locator("#correction")).toContainText("Correcta.");
}

test("Seam 2: corte breve, dos confirmaciones, reapertura y una sincronización", async ({ page }) => {
  const remote = await mockStudyPersistence(page);
  await login(page);
  await openStudy(page);

  await setBackendOffline(page, remote, true);
  await confirmCurrent(page);
  await expect(page.locator("#sync-status")).toContainText("Sin conexión");
  await expect(page.locator("#sync-status")).toContainText("Cambios pendientes");

  await page.getByRole("button", { name: "Siguiente pendiente" }).click();
  await confirmCurrent(page);
  const reopenedQuestionId = await page.locator("#study-panel").getAttribute("data-question-id");

  await page.reload();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", reopenedQuestionId);
  await expect(page.locator("#correction")).toContainText("Correcta.");
  await expect(page.locator("#sync-status")).toContainText("Cambios pendientes");

  await setBackendOffline(page, remote, false);
  await expect(page.locator("#sync-status")).toContainText("En línea · Sincronizado");
  await expect.poll(() => remote.answers.length).toBe(2);
  expect(remote.attempt.revision).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("sas-active-attempt:")))).toEqual([]);
});

test("Seam 2 regresión A: conserva 350 segundos activos como incrementos de máximo 300", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-10T10:00:00Z") });
  const remote = await mockStudyPersistence(page);
  await login(page);
  await openStudy(page);
  const pendingSeconds = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("sas-active-attempt:"));
    if (!key) return 0;
    return JSON.parse(localStorage.getItem(key)).pending.active_increments
      .reduce((total, increment) => total + increment.seconds, 0);
  });
  await setBackendOffline(page, remote, true);
  const initialSeconds = await pendingSeconds();
  for (let interval = 0; interval < 7; interval += 1) {
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown")));
    await page.clock.runFor(50_000);
  }
  await page.evaluate(() => document.querySelector("#pause-button").click());
  await expect(page.getByText("Estudio en pausa")).toBeVisible();
  expect(await pendingSeconds()).toBe(initialSeconds + 350);

  await page.reload();
  await expect(page.getByText("Estudio en pausa")).toBeVisible();
  expect(await pendingSeconds()).toBe(initialSeconds + 350);
  await setBackendOffline(page, remote, false);
  await expect(page.locator("#sync-status")).toContainText("En línea · Sincronizado");

  const increments = remote.syncedSnapshots.flatMap(({ active_increments: activeIncrements }) => activeIncrements);
  expect(increments.reduce((total, { seconds }) => total + seconds, 0)).toBe(initialSeconds + 350);
  expect(Math.max(...increments.map(({ seconds }) => seconds))).toBeLessThanOrEqual(300);
  expect(remote.attempt.active_seconds).toBe(initialSeconds + 350);

  await page.clock.fastForward("10:00");
  expect(remote.attempt.active_seconds).toBe(initialSeconds + 350);
});

test("Seam 2: una Sesión de falladas conserva su pregunta de origen al reabrir sin conexión", async ({ page }) => {
  const remote = studyState();
  const question = questions[0];
  Object.assign(remote.attempt, {
    kind: "failed",
    principal: false,
    strategy: "failed",
    failed_scope_exam_id: exam.id,
    question_ids: [question.id],
  });
  remote.progress = [{ exam_id: exam.id, question_id: question.id }];
  remote.sources = [{
    position: 0,
    exam_id: exam.id,
    exam_version_id: exam.version.id,
    exam_version_path: entry.latestPath,
    question_id: question.id,
    source_question_id: question.id,
  }];
  await mockStudyPersistence(page, remote);
  await login(page);
  await page.locator(`[data-exam-id="${exam.id}"]`).getByRole("button", { name: "Elegir examen" }).click();
  await page.getByRole("button", { name: /Solo falladas|Sesión de falladas activa/ }).click();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "failed");

  await setBackendOffline(page, remote, true);
  await confirmCurrent(page);
  await page.reload();

  await expect(page.locator("#study-panel")).toHaveAttribute("data-kind", "failed");
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", question.id);
  await expect(page.locator("#study-source")).toContainText(exam.title);
  await expect(page.locator("#correction")).toContainText("Correcta.");
  await expect(page.locator("#sync-status")).toContainText("Sin conexión · Cambios pendientes");
});

test("Seam 2: corte breve de examen conserva el último cambio y el borrado antes de sincronizar", async ({ page }) => {
  const remote = await mockExamPersistence(page);
  await login(page);
  await openExam(page);

  await setBackendOffline(page, remote, true);
  const firstLatestOption = questions[0].options[1].id;
  await page.locator(`#answer-options input[value="${questions[0].options[0].id}"]`).check();
  await page.locator(`#answer-options input[value="${firstLatestOption}"]`).check();
  await page.getByRole("button", { name: "Pregunta 2: pendiente" }).click();
  await page.locator(`#answer-options input[value="${questions[1].options[0].id}"]`).check();
  await page.getByRole("button", { name: "Borrar respuesta" }).click();
  await expect(page.locator("#sync-status")).toContainText("Cambios pendientes");

  await page.reload();
  await expect(page.locator("#study-panel")).toHaveAttribute("data-question-id", questions[1].id);
  await expect(page.getByRole("button", { name: "Pregunta 2: pendiente" })).toBeVisible();
  await page.getByRole("button", { name: "Pregunta 1: contestada" }).click();
  await expect(page.locator(`#answer-options input[value="${firstLatestOption}"]`)).toBeChecked();

  await setBackendOffline(page, remote, false);
  await expect(page.locator("#sync-status")).toContainText("En línea · Sincronizado");
  expect(remote.answers.map(({ question_id: questionId, selected_option: selectedOption }) => ({
    questionId, selectedOption,
  }))).toEqual([
    { questionId: questions[0].id, selectedOption: firstLatestOption },
    { questionId: questions[1].id, selectedOption: null },
  ]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("sas-active-attempt:")))).toEqual([]);
});

test("Seam 2: expiración offline bloquea, sobrevive a recarga y finaliza una vez al reconectar", async ({ page }) => {
  const serverNow = new Date("2026-08-10T12:00:00Z");
  await page.clock.install({ time: new Date(serverNow.getTime() - 60_000) });
  const remote = await mockExamPersistence(page, examState({ nowMs: serverNow.getTime(), deadlineMs: 5_000 }));
  await login(page);
  await openExam(page);

  await page.locator(`#answer-options input[value="${questions[0].options[0].id}"]`).check();
  await expect(page.locator("#sync-status")).toContainText("En línea · Sincronizado");
  await setBackendOffline(page, remote, true);
  await page.locator(`#answer-options input[value="${questions[0].options[1].id}"]`).check();
  await page.clock.runFor(5_100);
  await expect(page.locator("#answer-options input").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Entregar examen" })).toBeDisabled();
  await expect(page.locator("#active-time")).toHaveText("Tiempo restante: 00:00:00");
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("sas-active-attempt:"));
    return key ? JSON.parse(localStorage.getItem(key)).pending.finalize : false;
  })).toBe(true);

  await page.reload();
  await expect(page.locator("#answer-options input").first()).toBeDisabled();
  await expect(page.locator("#sync-status")).toContainText("Cambios pendientes");
  expect(remote.finalizations).toBe(0);

  remote.rejectExamAnswers = true;
  await setBackendOffline(page, remote, false);
  await expect(page.getByText("Intento finalizado")).toBeVisible();
  expect(remote.finalizations).toBe(1);
  expect(remote.rejectedLateAnswers).toBe(1);
  expect(remote.answers).toHaveLength(1);
  expect(remote.syncedSnapshots.at(-1).exam_answers).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("sas-active-attempt:")))).toEqual([]);
});

test("Seam 2: un autoguardado que cruza el deadline reintenta la finalización sin reconectar", async ({ page }) => {
  const now = new Date("2026-08-10T14:00:00Z");
  await page.clock.install({ time: now });
  const remote = await mockExamPersistence(page, examState({ nowMs: now.getTime(), deadlineMs: 1_000 }));
  await login(page);
  await openExam(page);

  remote.blockNextSync = true;
  await page.locator(`#answer-options input[value="${questions[0].options[0].id}"]`).check();
  await expect.poll(() => remote.syncStarted).toBe(true);
  await page.clock.runFor(1_100);
  remote.rejectNonFinalizing = true;
  remote.rejectExamAnswers = true;
  remote.releaseSync();

  await expect(page.getByText("Intento finalizado")).toBeVisible();
  expect(remote.finalizations).toBe(1);
  expect(remote.syncedSnapshots.at(-1).finalize).toBe(true);
  expect(remote.syncedSnapshots.at(-1).exam_answers).toEqual([]);
  expect(remote.rejectedLateAnswers).toBe(1);
});

test("Seam 2: dos dispositivos rechazan la revisión obsoleta y muestran el estado canónico", async ({ page: deviceA, browser }, testInfo) => {
  const remote = studyState();
  await mockStudyPersistence(deviceA, remote);
  const contextB = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const deviceB = await contextB.newPage();
  await mockStudyPersistence(deviceB, remote);

  try {
    await login(deviceA);
    await openStudy(deviceA);
    await login(deviceB);
    await openStudy(deviceB);

    const canonicalOption = questions[0].options[1].id;
    const staleOption = questions[0].options[0].id;
    await deviceB.locator(`#answer-options input[value="${canonicalOption}"]`).check();
    await deviceB.getByRole("button", { name: "Confirmar respuesta" }).click();
    await expect.poll(() => remote.attempt.revision).toBe(1);

    await deviceA.locator(`#answer-options input[value="${staleOption}"]`).check();
    await deviceA.getByRole("button", { name: "Confirmar respuesta" }).click();
    await expect(deviceA.locator("#sync-recovery")).toContainText("Otro dispositivo guardó un avance más reciente");
    await expect(deviceA.locator("#sync-recovery")).toContainText("sin mezclar ni sobrescribir");
    await expect(deviceA.locator(`#answer-options input[value="${canonicalOption}"]`)).toBeChecked();
    await expect(deviceA.locator(`#answer-options input[value="${staleOption}"]`)).not.toBeChecked();

    expect(remote.rejectedSyncs).toEqual([expect.objectContaining({ baseRevision: 0, remoteRevision: 1 })]);
    expect(remote.attempt.revision).toBe(1);
    expect(remote.answers).toHaveLength(1);
    expect(remote.answers[0].selected_option).toBe(canonicalOption);
    expect(await deviceA.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("sas-active-attempt:"));
      if (!key) return [];
      return JSON.parse(localStorage.getItem(key)).pending.study_confirmations;
    })).toEqual([]);
  } finally {
    await contextB.close();
  }
});
