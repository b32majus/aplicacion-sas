import { createClient } from "@supabase/supabase-js";
import { loadPinnedExam, loadPublishedCatalog } from "./catalog.js";
import { shuffled } from "./quiz-core.js";
import { ExamSession, formatActiveTime, NormalStudySession } from "./study-session.js";
import "./styles.css";

const ids = [
  "loading-view", "login-view", "catalog-view", "exam-view", "study-view", "summary-view",
  "login-form", "login-button", "login-error", "logout-button", "catalog-status", "exam-grid",
  "back-button", "exam-title", "exam-count", "exam-duration", "exam-study-status", "exam-error",
  "start-study-button", "start-random-study-button", "start-exam-button", "exit-study-button", "pause-button", "study-panel", "study-exam-title",
  "study-progress", "active-time", "version-pin", "pause-message", "question-content",
  "question-label", "question-text", "answer-options", "correction", "study-error", "confirm-button",
  "skip-button", "next-pending-button", "complete-button", "question-numbers", "summary-title",
  "summary-correct", "summary-wrong", "summary-accuracy", "summary-time", "summary-pending",
  "summary-mastered", "summary-catalog-button", "study-strategy-label", "strategy-warning",
  "strategy-warning-copy", "cancel-strategy-change", "confirm-strategy-change",
  "all-failed-button", "all-failed-count", "all-failed-error", "exam-failed-count",
  "start-failed-button", "study-source", "summary-pending-label", "summary-mastered-label",
  "summary-pending-list-wrap", "summary-pending-list", "clear-exam-answer", "navigation-legend",
  "submit-exam-button", "exam-submit-dialog", "exam-submit-counts", "cancel-exam-submit", "confirm-exam-submit",
  "summary-blank-wrap", "summary-blank", "summary-score-wrap", "summary-score", "summary-record",
  "summary-accuracy-wrap", "summary-time-label", "summary-pending-wrap", "summary-mastered-wrap",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const privateViews = [elements["catalog-view"], elements["exam-view"], elements["study-view"], elements["summary-view"]];
const allViews = [elements["loading-view"], elements["login-view"], ...privateViews];
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const bankBaseUrl = `${import.meta.env.BASE_URL}data/exams/`;
const RECENT_ACTIVITY_MS = 60_000;

let supabase;
let catalog = [];
let catalogPromise;
let selectedExam;
let study;
let statuses = new Map();
let activeStrategies = new Map();
let pendingFailures = new Map();
let bestExamScores = new Map();
let activeFailedAttempt;
let activeExamAttempt;
let pendingActiveSeconds = 0;
let lastActivityAt = Date.now();
let timer;
let routeSerial = 0;
let savePromise = Promise.resolve();
let pendingConfirmationPayload = null;
let confirmationRetryAvailable = false;
let pendingSavePayload = null;
let pendingStrategyChange = null;
let examServerOffsetMs = 0;
let examSavePromise = Promise.resolve();
let examFinalizing = false;

function showOnly(view) {
  allViews.forEach((candidate) => { candidate.hidden = candidate !== view; });
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function clearError(element) {
  element.textContent = "";
  element.hidden = true;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function statusFor(examId) { return statuses.get(examId) || "Sin empezar"; }

function formatScore(score) {
  return Number(score).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function eligibleFailureSources(scopeExamId = null) {
  const exams = scopeExamId ? catalog.filter(({ id }) => id === scopeExamId) : catalog;
  return exams.flatMap((exam) => exam.questions
    .filter(({ id }) => pendingFailures.get(exam.id)?.has(id))
    .map(({ id }) => ({
      exam_id: exam.id,
      exam_version_id: exam.version,
      exam_version_path: exam.versionPath,
      question_id: id,
    })));
}

async function refreshStatuses() {
  const { data, error } = await supabase
    .from("attempts")
    .select("id,exam_id,exam_version_id,exam_version_path,question_ids,status,completed_at,strategy,kind,failed_scope_exam_id,current_position,duration_minutes,started_at,deadline_at,score");
  if (error) throw error;

  const { data: progress, error: progressError } = await supabase
    .from("question_progress")
    .select("exam_id,question_id")
    .eq("pending_failure", true);
  if (progressError) throw progressError;

  statuses = new Map();
  activeStrategies = new Map();
  pendingFailures = new Map();
  bestExamScores = new Map();
  activeFailedAttempt = undefined;
  activeExamAttempt = undefined;
  for (const attempt of data) {
    if (attempt.kind === "failed") {
      if (attempt.status === "active") activeFailedAttempt = attempt;
      continue;
    }
    if (attempt.kind === "exam") {
      if (attempt.status === "active") activeExamAttempt = attempt;
      if (attempt.status === "completed") {
        statuses.set(attempt.exam_id, "Finalizado");
        const score = Number(attempt.score);
        if (Number.isFinite(score)) {
          bestExamScores.set(attempt.exam_id, Math.max(bestExamScores.get(attempt.exam_id) ?? -Infinity, score));
        }
      }
      continue;
    }
    if (attempt.status === "active") activeStrategies.set(attempt.exam_id, attempt.strategy);
    if (attempt.status === "completed") statuses.set(attempt.exam_id, "Finalizado");
  }
  for (const examId of activeStrategies.keys()) {
    if (!statuses.has(examId)) statuses.set(examId, "En curso");
  }
  for (const row of progress) {
    if (!pendingFailures.has(row.exam_id)) pendingFailures.set(row.exam_id, new Set());
    pendingFailures.get(row.exam_id).add(row.question_id);
  }
}

function renderCatalog() {
  elements["exam-grid"].replaceChildren(...catalog.map((exam) => {
    const card = document.createElement("article");
    card.className = "exam-card";
    card.dataset.examId = exam.id;

    const heading = document.createElement("h2");
    heading.textContent = exam.title;
    const facts = document.createElement("p");
    facts.className = "card-facts";
    facts.textContent = `${exam.activeCount} Preguntas activas · ${formatDuration(exam.durationMinutes)}`;
    const state = document.createElement("p");
    state.className = "card-status";
    state.textContent = statusFor(exam.id);
    const failures = document.createElement("p");
    failures.className = "card-failures";
    failures.textContent = `${eligibleFailureSources(exam.id).length} Falladas pendientes`;
    const best = document.createElement("p");
    best.className = "card-best-score";
    best.hidden = !bestExamScores.has(exam.id);
    best.textContent = best.hidden ? "" : `Mejor nota: ${formatScore(bestExamScores.get(exam.id))} / 100`;
    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    button.textContent = "Elegir examen";
    button.addEventListener("click", () => selectExam(exam.id));
    card.append(heading, facts, state, failures, best, button);
    return card;
  }));
  elements["catalog-status"].hidden = true;
  const allFailedCount = eligibleFailureSources().length;
  elements["all-failed-count"].textContent = allFailedCount;
  elements["all-failed-button"].disabled = !activeFailedAttempt && allFailedCount === 0;
  elements["all-failed-button"].textContent = activeFailedAttempt
    ? "Continuar Sesión de falladas activa"
    : "Empezar Todas mis falladas";
  if (activeExamAttempt && Date.parse(activeExamAttempt.deadline_at) > Date.now()) {
    elements["all-failed-button"].disabled = true;
  }
  elements["exam-grid"].hidden = false;
}

async function ensureCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadPublishedCatalog(fetch, bankBaseUrl)
      .then((loaded) => { catalog = loaded; return loaded; })
      .catch((error) => {
        catalogPromise = undefined;
        showError(elements["catalog-status"], error.message);
        throw error;
      });
  }
  return catalogPromise;
}

async function showCatalog() {
  study = undefined;
  selectedExam = undefined;
  window.location.hash = "catalog";
  showOnly(elements["catalog-view"]);
  try {
    await Promise.all([ensureCatalog(), refreshStatuses()]);
    renderCatalog();
  } catch (error) {
    showError(elements["catalog-status"], `No se pudo preparar el catálogo privado. ${error.message}`);
  }
}

async function selectExam(id, { updateHash = true } = {}) {
  const exams = await ensureCatalog();
  const exam = exams.find((candidate) => candidate.id === id);
  if (!exam) return showCatalog();
  selectedExam = exam;
  clearError(elements["exam-error"]);
  elements["exam-title"].textContent = exam.title;
  elements["exam-count"].textContent = exam.activeCount;
  elements["exam-duration"].textContent = formatDuration(exam.durationMinutes);
  const failedCount = eligibleFailureSources(exam.id).length;
  elements["exam-failed-count"].textContent = failedCount;
  const state = statusFor(exam.id);
  elements["exam-study-status"].textContent = state;
  const activeStrategy = activeStrategies.get(exam.id);
  elements["start-study-button"].textContent = activeStrategy === "normal"
    ? "Continuar estudio normal"
    : activeStrategy ? "Cambiar a estudio normal" : "Empezar estudio normal";
  elements["start-random-study-button"].textContent = activeStrategy === "random"
    ? "Continuar estudio aleatorio"
    : activeStrategy ? "Cambiar a estudio aleatorio" : "Empezar estudio aleatorio";
  elements["start-failed-button"].disabled = !activeFailedAttempt && failedCount === 0;
  elements["start-failed-button"].textContent = activeFailedAttempt
    ? "Continuar Sesión de falladas activa"
    : "Empezar Solo falladas";
  const examIsActive = activeExamAttempt && Date.parse(activeExamAttempt.deadline_at) > Date.now();
  elements["start-study-button"].disabled = Boolean(examIsActive);
  elements["start-random-study-button"].disabled = Boolean(examIsActive);
  if (examIsActive) elements["start-failed-button"].disabled = true;
  elements["start-exam-button"].textContent = activeExamAttempt
    ? "Continuar Modo examen activo"
    : "Empezar Modo examen";
  if (updateHash) window.location.hash = `exam=${encodeURIComponent(exam.id)}`;
  showOnly(elements["exam-view"]);
}

function normalizeRow(data) { return Array.isArray(data) ? data[0] : data; }
function studyStorageKey() {
  if (!study) return null;
  return `${study.attempt.kind === "failed" ? "failed-study" : "normal-study"}:${study.attempt.id}`;
}

function restoreLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(studyStorageKey()) || "null");
    if (!saved) return null;
    for (const [questionId, optionId] of Object.entries(saved.provisional || {})) {
      const question = study.questions.find(({ id }) => id === questionId);
      if (question?.options.some(({ id }) => id === optionId)) study.provisional.set(questionId, optionId);
    }
    pendingActiveSeconds = Math.max(0, Math.min(Number(saved.activeSeconds) || 0, 300));
    pendingSavePayload = saved.pendingSave || null;
    if (Number.isInteger(saved.position) && saved.position >= 0 && saved.position < study.questions.length) {
      study.goTo(saved.position);
    }
    if (typeof saved.isPaused === "boolean") study.attempt.is_paused = saved.isPaused;
    pendingConfirmationPayload = saved.pendingConfirmation || null;
    return pendingConfirmationPayload;
  } catch {
    localStorage.removeItem(studyStorageKey());
    return null;
  }
}

function persistLocalState() {
  if (!study) return;
  localStorage.setItem(studyStorageKey(), JSON.stringify({
    provisional: Object.fromEntries(study.provisional),
    activeSeconds: pendingActiveSeconds,
    position: study.index,
    isPaused: study.attempt.is_paused,
    pendingConfirmation: pendingConfirmationPayload,
    pendingSave: pendingSavePayload,
  }));
}

async function fetchAttemptAnswers(attemptId) {
  const { data, error } = await supabase
    .from("attempt_answers")
    .select("id,question_id,answer_sequence,selected_option,correct_option,is_correct,newly_pending_failure,newly_mastered,confirmed_at")
    .eq("attempt_id", attemptId)
    .order("confirmed_at", { ascending: true });
  if (error) throw error;
  return data;
}

async function startExam() {
  if (!selectedExam) return;
  elements["start-exam-button"].disabled = true;
  clearError(elements["exam-error"]);
  try {
    const clockRequestAt = Date.now();
    const { data, error } = await supabase.rpc("start_or_resume_exam_attempt", {
      p_exam_id: selectedExam.id,
      p_exam_version_id: selectedExam.version,
      p_exam_version_path: selectedExam.versionPath,
      p_question_ids: selectedExam.questions.map(({ id }) => id),
      p_duration_minutes: selectedExam.durationMinutes,
    });
    if (error) throw error;
    const clockResponseAt = Date.now();
    const attempt = normalizeRow(data);
    const pinned = attempt.exam_version_id === selectedExam.version && attempt.exam_version_path === selectedExam.versionPath
      ? { exam: selectedExam.package }
      : await loadPinnedExam(fetch, bankBaseUrl, attempt);
    const catalogExam = catalog.find(({ id }) => id === attempt.exam_id);
    if (catalogExam) selectedExam = catalogExam;
    const answers = await fetchAttemptAnswers(attempt.id);
    study = new ExamSession(pinned.exam, attempt, answers);
    activeExamAttempt = attempt;
    examServerOffsetMs = Date.parse(attempt.server_now) - (clockRequestAt + clockResponseAt) / 2;
    examSavePromise = Promise.resolve();
    examFinalizing = false;
    const expired = Date.parse(attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    study.locked = expired;
    window.location.hash = `exam-mode=${encodeURIComponent(attempt.exam_id)}`;
    renderStudy();
    if (expired) finalizeExam();
  } catch (error) {
    showError(elements["exam-error"], `No se pudo iniciar o recuperar el Modo examen. ${error.message}`);
  } finally {
    elements["start-exam-button"].disabled = false;
  }
}

function saveExamSelection(questionId, selectedOption, position) {
  const payload = {
    p_answer_id: crypto.randomUUID(),
    p_attempt_id: study.attempt.id,
    p_question_id: questionId,
    p_selected_option: selectedOption,
    p_position: position,
  };
  const save = async () => {
    const { data, error } = await supabase.rpc("save_exam_answer", payload);
    if (error) throw error;
    study?.recordSaved(normalizeRow(data));
  };
  examSavePromise = examSavePromise.then(save, save);
  examSavePromise.catch((error) => {
    showError(elements["study-error"], `No se pudo autoguardar la respuesta. ${error.message}`);
  });
}

async function callConfirmation(payload) {
  const rpc = study.attempt.kind === "failed" ? "confirm_failed_answer" : "confirm_normal_answer";
  const { data, error } = await supabase.rpc(rpc, payload);
  if (error) throw error;
  return normalizeRow(data);
}

async function retryPendingConfirmation(payload) {
  if (!payload) return;
  confirmationRetryAvailable = false;
  try {
    study.applyConfirmation(await callConfirmation(payload));
    pendingConfirmationPayload = null;
    persistLocalState();
  } catch (error) {
    pendingConfirmationPayload = payload;
    confirmationRetryAvailable = true;
    persistLocalState();
    showError(elements["study-error"], `La confirmación sigue pendiente de conexión. ${error.message}`);
  }
}

function strategyName(strategy) {
  if (strategy === "failed") return "Solo falladas";
  return strategy === "random" ? "aleatorio" : "normal";
}

function warnBeforeStrategyChange(strategy) {
  pendingStrategyChange = strategy;
  const current = strategyName(activeStrategies.get(selectedExam.id));
  const requested = strategyName(strategy);
  elements["strategy-warning-copy"].textContent = `Cambiar de Orden ${current} a Orden ${requested} conservará el historial y las respuestas del recorrido actual, pero ya no podrás continuarlo.`;
  elements["strategy-warning"].showModal();
}

async function startStudy(strategy = activeStrategies.get(selectedExam?.id) || "normal", { replace = false } = {}) {
  if (!selectedExam) return;
  const activeStrategy = activeStrategies.get(selectedExam.id);
  if (activeStrategy && activeStrategy !== strategy && !replace) {
    warnBeforeStrategyChange(strategy);
    return;
  }
  elements["start-study-button"].disabled = true;
  elements["start-random-study-button"].disabled = true;
  clearError(elements["exam-error"]);
  try {
    const questionIds = selectedExam.questions.map(({ id }) => id);
    const { data, error } = await supabase.rpc("start_or_replace_principal_attempt", {
      p_exam_id: selectedExam.id,
      p_exam_version_id: selectedExam.version,
      p_exam_version_path: selectedExam.versionPath,
      p_question_ids: strategy === "random" ? shuffled(questionIds) : questionIds,
      p_strategy: strategy,
      p_replace_active: replace,
    });
    if (error) throw error;
    const attempt = normalizeRow(data);
    const pinned = attempt.exam_version_id === selectedExam.version && attempt.exam_version_path === selectedExam.versionPath
      ? { exam: selectedExam.package }
      : await loadPinnedExam(fetch, bankBaseUrl, attempt);
    const answers = await fetchAttemptAnswers(attempt.id);
    study = new NormalStudySession(pinned.exam, attempt, answers);
    activeStrategies.set(selectedExam.id, attempt.strategy);
    pendingActiveSeconds = 0;
    pendingConfirmationPayload = null;
    confirmationRetryAvailable = false;
    pendingSavePayload = null;
    const pendingConfirmation = restoreLocalState();
    window.location.hash = `study=${encodeURIComponent(selectedExam.id)}`;
    renderStudy();
    if (pendingSavePayload) {
      try {
        await saveAttempt();
      } catch (error) {
        showError(elements["study-error"], `El guardado de tiempo sigue pendiente de conexión. ${error.message}`);
      }
    }
    await retryPendingConfirmation(pendingConfirmation);
    renderStudy();
  } catch (error) {
    showError(elements["exam-error"], `No se pudo iniciar o recuperar el estudio. ${error.message}`);
  } finally {
    elements["start-study-button"].disabled = false;
    elements["start-random-study-button"].disabled = false;
  }
}

async function loadFailedSessionQuestions(attempt) {
  const { data: sources, error } = await supabase
    .from("attempt_question_sources")
    .select("position,exam_id,exam_version_id,exam_version_path,question_id")
    .eq("attempt_id", attempt.id)
    .order("position", { ascending: true });
  if (error) throw error;
  if (!sources?.length || sources.length !== attempt.question_ids.length) {
    throw new Error("La cola persistida de la Sesión de falladas no es válida.");
  }

  const pinnedExams = new Map();
  for (const source of sources) {
    const key = `${source.exam_id}\u0000${source.exam_version_id}\u0000${source.exam_version_path}`;
    if (pinnedExams.has(key)) continue;
    const current = catalog.find((exam) => (
      exam.id === source.exam_id
      && exam.version === source.exam_version_id
      && exam.versionPath === source.exam_version_path
    ));
    if (current) {
      pinnedExams.set(key, { exam: current.package, title: current.title });
    } else {
      const pinned = await loadPinnedExam(fetch, bankBaseUrl, {
        exam_id: source.exam_id,
        exam_version_id: source.exam_version_id,
        exam_version_path: source.exam_version_path,
      });
      pinnedExams.set(key, { exam: pinned.exam, title: pinned.exam.title });
    }
  }

  return sources.map((source) => {
    const key = `${source.exam_id}\u0000${source.exam_version_id}\u0000${source.exam_version_path}`;
    const pinned = pinnedExams.get(key);
    const question = pinned.exam.questions.find(({ id }) => id === source.question_id);
    if (!question) throw new Error("Una pregunta de la cola ya no existe en su versión fijada.");
    return {
      ...question,
      sourceExamId: source.exam_id,
      sourceExamTitle: pinned.title,
      sourceVersionId: source.exam_version_id,
      sourceVersionPath: source.exam_version_path,
    };
  });
}

async function startFailedStudy(scopeExamId = null) {
  const errorElement = scopeExamId ? elements["exam-error"] : elements["all-failed-error"];
  clearError(errorElement);
  elements["start-failed-button"].disabled = true;
  elements["all-failed-button"].disabled = true;
  try {
    const eligible = eligibleFailureSources(scopeExamId);
    const sources = scopeExamId ? eligible : shuffled(eligible);
    const { data, error } = await supabase.rpc("start_or_resume_failed_attempt", {
      p_scope_exam_id: scopeExamId,
      p_sources: sources,
    });
    if (error) throw error;
    const attempt = normalizeRow(data);
    const questions = await loadFailedSessionQuestions(attempt);
    const answers = await fetchAttemptAnswers(attempt.id);
    study = new NormalStudySession({
      id: attempt.exam_id,
      version: { id: attempt.exam_version_id },
      questions,
    }, attempt, answers);
    activeFailedAttempt = attempt;
    selectedExam = attempt.failed_scope_exam_id
      ? catalog.find(({ id }) => id === attempt.failed_scope_exam_id)
      : undefined;
    pendingActiveSeconds = 0;
    pendingConfirmationPayload = null;
    confirmationRetryAvailable = false;
    pendingSavePayload = null;
    const pendingConfirmation = restoreLocalState();
    window.location.hash = `failed=${encodeURIComponent(attempt.failed_scope_exam_id || "all")}`;
    renderStudy();
    if (pendingSavePayload) {
      try {
        await saveAttempt();
      } catch (saveError) {
        showError(elements["study-error"], `El guardado de tiempo sigue pendiente de conexión. ${saveError.message}`);
      }
    }
    await retryPendingConfirmation(pendingConfirmation);
    renderStudy();
  } catch (error) {
    showError(errorElement, `No se pudo iniciar o recuperar la Sesión de falladas. ${error.message}`);
  } finally {
    const count = eligibleFailureSources(scopeExamId).length;
    elements["start-failed-button"].disabled = !activeFailedAttempt && count === 0;
    elements["all-failed-button"].disabled = !activeFailedAttempt && eligibleFailureSources().length === 0;
  }
}

function renderNavigation() {
  elements["question-numbers"].replaceChildren(...study.questions.map((question, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(index + 1);
    const state = study.stateFor(question.id);
    button.className = `question-number ${state}`;
    if (index === study.index) button.classList.add("current");
    button.setAttribute("aria-label", study.attempt.kind === "exam"
      ? `Pregunta ${index + 1}: ${state === "answered" ? "contestada" : "pendiente"}`
      : `Pregunta ${index + 1}: ${state}`);
    button.addEventListener("click", async () => {
      study.goTo(index);
      renderStudy();
      if (study.attempt.kind === "exam") return;
      try {
        await saveAttempt();
      } catch (error) {
        showError(elements["study-error"], `La posición se guardará al recuperar conexión. ${error.message}`);
      }
    });
    return button;
  }));
}

function optionLabel(question, option, latest, corrected) {
  const label = document.createElement("label");
  label.className = "answer-option";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "study-answer";
  input.value = option.id;
  input.checked = corrected ? latest?.selected_option === option.id : study.selectedOption === option.id;
  const blockedByExam = study.attempt.kind !== "exam"
    && activeExamAttempt
    && Date.parse(activeExamAttempt.deadline_at) > Date.now();
  input.disabled = study.attempt.kind === "exam"
    ? study.locked
    : blockedByExam || corrected || study.attempt.is_paused || pendingConfirmationPayload?.p_question_id === question.id;
  input.addEventListener("change", () => {
    study.select(option.id);
    if (study.attempt.kind === "exam") {
      const questionId = study.currentQuestion.id;
      const position = study.index;
      renderStudy();
      saveExamSelection(questionId, option.id, position);
      return;
    }
    persistLocalState();
    renderStudy();
  });
  const text = document.createElement("span");
  text.textContent = `${option.id}. ${option.text}`;
  if (corrected && option.id === question.correctOption) label.classList.add("correct-option");
  if (corrected && !latest?.is_correct && option.id === latest?.selected_option) label.classList.add("wrong-option");
  label.append(input, text);
  return label;
}

function renderStudy() {
  showOnly(elements["study-view"]);
  const question = study.currentQuestion;
  const examMode = study.attempt.kind === "exam";
  const pending = !examMode && pendingConfirmationPayload?.p_question_id === question.id ? {
    id: pendingConfirmationPayload.p_confirmation_id,
    selected_option: pendingConfirmationPayload.p_selected_option,
    correct_option: question.correctOption,
    is_correct: pendingConfirmationPayload.p_selected_option === question.correctOption,
  } : null;
  const latest = examMode ? null : study.latestAnswers.get(question.id) || pending;
  const corrected = !examMode && Boolean(latest);
  const paused = !examMode && study.attempt.is_paused;
  elements["study-panel"].dataset.attemptId = study.attempt.id;
  elements["study-panel"].dataset.questionId = question.id;
  elements["study-panel"].dataset.strategy = study.attempt.strategy;
  elements["study-panel"].dataset.kind = study.attempt.kind;
  elements["study-panel"].dataset.sourceExamId = question.sourceExamId || study.attempt.exam_id;
  elements["study-exam-title"].textContent = study.attempt.kind === "failed"
    ? selectedExam?.title || "Todas mis falladas"
    : selectedExam?.title || study.attempt.exam_id;
  elements["study-strategy-label"].textContent = examMode
    ? "Modo examen"
    : study.attempt.kind === "failed"
    ? "Solo falladas"
    : `Estudio ${strategyName(study.attempt.strategy)}`;
  elements["study-progress"].textContent = `${study.index + 1} de ${study.questions.length}`;
  elements["active-time"].textContent = examMode
    ? `Tiempo restante: ${formatCountdown(Date.parse(study.attempt.deadline_at) - (Date.now() + examServerOffsetMs))}`
    : `Tiempo activo: ${formatActiveTime(study.attempt.active_seconds + pendingActiveSeconds)}`;
  const versionId = question.sourceVersionId || study.attempt.exam_version_id;
  const versionPath = question.sourceVersionPath || study.attempt.exam_version_path;
  elements["version-pin"].textContent = `Versión fijada: ${versionId}`;
  elements["version-pin"].dataset.versionPath = versionPath;
  elements["study-source"].hidden = study.attempt.kind !== "failed";
  elements["study-source"].textContent = study.attempt.kind === "failed"
    ? `Examen de origen: ${question.sourceExamTitle}`
    : "";
  elements["question-label"].textContent = question.displayLabel || `Pregunta ${question.sourceNumber}`;
  elements["question-text"].textContent = question.text;
  elements["answer-options"].replaceChildren(...question.options.map((option) => optionLabel(question, option, latest, corrected)));
  elements["pause-message"].hidden = !paused;
  elements["question-content"].classList.toggle("paused", paused);
  elements["pause-button"].hidden = examMode;
  elements["pause-button"].textContent = paused ? "Reanudar" : "Pausar";
  elements["exit-study-button"].textContent = examMode ? "← Salir del examen" : "← Salir y guardar";
  elements["navigation-legend"].textContent = examMode ? "Pendiente · contestada" : "Pendiente · correcta · incorrecta";

  elements["correction"].hidden = !corrected;
  if (corrected) {
    elements["correction"].className = `correction ${latest.is_correct ? "correct" : "incorrect"}`;
    elements["correction"].textContent = latest.is_correct
      ? `Correcta. La respuesta oficial es ${latest.correct_option}.`
      : `Incorrecta. La respuesta oficial es ${latest.correct_option}.`;
    elements["correction"].dataset.confirmationId = latest.id;
  } else {
    elements["correction"].textContent = "";
    delete elements["correction"].dataset.confirmationId;
  }

  elements["confirm-button"].hidden = examMode || (corrected && !confirmationRetryAvailable);
  elements["confirm-button"].textContent = confirmationRetryAvailable ? "Reintentar confirmación" : "Confirmar respuesta";
  const blockedByExam = !examMode && activeExamAttempt && Date.parse(activeExamAttempt.deadline_at) > Date.now();
  elements["confirm-button"].disabled = paused || Boolean(blockedByExam) || (!confirmationRetryAvailable && !study.selectedOption);
  elements["skip-button"].hidden = examMode || corrected;
  elements["skip-button"].disabled = paused || Boolean(pendingConfirmationPayload);
  elements["next-pending-button"].hidden = examMode || !corrected || study.isResolved;
  elements["complete-button"].hidden = examMode || !corrected || !study.isResolved;
  elements["complete-button"].disabled = paused;
  elements["clear-exam-answer"].hidden = !examMode || !study.selectedOption;
  elements["clear-exam-answer"].disabled = examMode && study.locked;
  elements["submit-exam-button"].hidden = !examMode;
  elements["submit-exam-button"].disabled = examMode && (study.locked || examFinalizing);
  renderNavigation();
}

async function confirmAnswer() {
  const question = study.currentQuestion;
  if (!study.selectedOption) return;
  clearError(elements["study-error"]);
  confirmationRetryAvailable = false;
  elements["confirm-button"].disabled = true;
  const payload = pendingConfirmationPayload || {
    p_confirmation_id: crypto.randomUUID(),
    p_attempt_id: study.attempt.id,
    p_question_id: question.id,
    p_selected_option: study.selectedOption,
    p_correct_option: question.correctOption,
  };
  pendingConfirmationPayload = payload;
  persistLocalState();
  renderStudy();
  try {
    study.applyConfirmation(await callConfirmation(payload));
    pendingConfirmationPayload = null;
    persistLocalState();
    renderStudy();
    if (study.isResolved) await completeStudy();
  } catch (error) {
    pendingConfirmationPayload = payload;
    confirmationRetryAvailable = true;
    persistLocalState();
    showError(elements["study-error"], `No se pudo confirmar. Se reintentará con la misma respuesta. ${error.message}`);
    renderStudy();
  }
}

async function saveAttemptNow() {
  if (!study || study.attempt.status !== "active") return;
  while (true) {
    if (!pendingSavePayload) {
      pendingSavePayload = {
        p_save_id: crypto.randomUUID(),
        p_attempt_id: study.attempt.id,
        p_position: study.index,
        p_active_seconds: Math.min(pendingActiveSeconds, 300),
        p_is_paused: study.attempt.is_paused,
      };
      persistLocalState();
    }
    const payload = pendingSavePayload;
    const { data, error } = await supabase.rpc("save_normal_attempt", payload);
    if (error) {
      persistLocalState();
      throw error;
    }
    const desiredPaused = study.attempt.is_paused;
    pendingActiveSeconds = Math.max(0, pendingActiveSeconds - payload.p_active_seconds);
    pendingSavePayload = null;
    study.attempt = normalizeRow(data);
    study.attempt.is_paused = desiredPaused;
    persistLocalState();
    if (study.index === payload.p_position && desiredPaused === payload.p_is_paused && pendingActiveSeconds === 0) return;
  }
}

function saveAttempt() {
  savePromise = savePromise.then(saveAttemptNow, saveAttemptNow);
  return savePromise;
}

async function moveNext({ skip = false } = {}) {
  if (skip) study.provisional.delete(study.currentQuestion.id);
  study.nextPending();
  renderStudy();
  try { await saveAttempt(); } catch (error) { showError(elements["study-error"], `La posición se guardará al recuperar conexión. ${error.message}`); }
}

async function togglePause() {
  study.attempt.is_paused = !study.attempt.is_paused;
  try { await saveAttempt(); } catch (error) { showError(elements["study-error"], `No se pudo guardar la pausa. ${error.message}`); }
  renderStudy();
}

async function exitStudy() {
  const exitingAttempt = study.attempt;
  if (exitingAttempt.kind === "exam") {
    try { await examSavePromise; } catch { /* The visible error keeps the failed autosave explicit. */ }
  } else {
    try { await saveAttempt(); } catch { /* Local state retains the unsaved delta and position. */ }
  }
  await refreshStatuses();
  if (exitingAttempt.kind === "failed" && !exitingAttempt.failed_scope_exam_id) {
    await showCatalog();
    return;
  }
  renderCatalog();
  await selectExam(exitingAttempt.failed_scope_exam_id || exitingAttempt.exam_id);
  study = undefined;
}

async function completeStudy() {
  if (!study.isResolved) return;
  elements["complete-button"].disabled = true;
  try {
    await saveAttempt();
    const rpc = study.attempt.kind === "failed" ? "complete_failed_attempt" : "complete_normal_attempt";
    const { data, error } = await supabase.rpc(rpc, { p_attempt_id: study.attempt.id });
    if (error) throw error;
    study.attempt.status = "completed";
    localStorage.removeItem(studyStorageKey());
    await refreshStatuses();
    showSummary(data);
  } catch (error) {
    showError(elements["study-error"], `No se pudo completar el intento. ${error.message}`);
    elements["complete-button"].disabled = false;
  }
}

async function finalizeExam() {
  if (examFinalizing || study?.attempt.kind !== "exam" || study.attempt.status !== "active") return;
  examFinalizing = true;
  study.locked = true;
  elements["exam-submit-dialog"].close();
  renderStudy();
  try {
    const expired = Date.parse(study.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    try {
      await examSavePromise;
    } catch (saveError) {
      if (!expired) throw saveError;
    }
    const { data, error } = await supabase.rpc("finish_exam_attempt", {
      p_attempt_id: study.attempt.id,
    });
    if (error) throw error;
    study.attempt.status = "completed";
    activeExamAttempt = undefined;
    await refreshStatuses();
    showExamSummary(normalizeRow(data));
  } catch (error) {
    examFinalizing = false;
    const expired = Date.parse(study.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    study.locked = expired;
    showError(elements["study-error"], `No se pudo finalizar el Modo examen. ${error.message}`);
    renderStudy();
  }
}

function showExamSummary(summary) {
  window.location.hash = `summary=${encodeURIComponent(study.attempt.id)}`;
  elements["summary-title"].textContent = `Resumen · ${selectedExam?.title || study.attempt.exam_id}`;
  elements["summary-correct"].textContent = summary.correct;
  elements["summary-wrong"].textContent = summary.wrong;
  elements["summary-blank"].textContent = summary.blank;
  elements["summary-score"].textContent = `${formatScore(summary.score)} / 100`;
  elements["summary-time"].textContent = formatActiveTime(summary.elapsed_ms / 1000);
  elements["summary-time-label"].textContent = "Tiempo empleado";
  elements["summary-blank-wrap"].hidden = false;
  elements["summary-score-wrap"].hidden = false;
  elements["summary-accuracy-wrap"].hidden = true;
  elements["summary-pending-wrap"].hidden = true;
  elements["summary-mastered-wrap"].hidden = true;
  elements["summary-record"].hidden = !summary.new_personal_record;
  elements["summary-pending-list-wrap"].hidden = true;
  elements["summary-pending"].textContent = "";
  elements["summary-mastered"].textContent = "";
  elements["summary-accuracy"].textContent = `${formatScore(summary.score)} / 100`;
  showOnly(elements["summary-view"]);
}

function showSummary(summary) {
  window.location.hash = `summary=${encodeURIComponent(study.attempt.id)}`;
  const failed = study.attempt.kind === "failed";
  elements["summary-title"].textContent = failed
    ? `Resumen · ${selectedExam?.title || "Todas mis falladas"}`
    : `Resumen · ${selectedExam?.title || `Estudio ${strategyName(study.attempt.strategy)}`}`;
  elements["summary-blank-wrap"].hidden = true;
  elements["summary-score-wrap"].hidden = true;
  elements["summary-record"].hidden = true;
  elements["summary-accuracy-wrap"].hidden = false;
  elements["summary-pending-wrap"].hidden = false;
  elements["summary-mastered-wrap"].hidden = false;
  elements["summary-time-label"].textContent = "Tiempo activo";
  elements["summary-correct"].textContent = summary.correct;
  elements["summary-wrong"].textContent = summary.wrong;
  elements["summary-accuracy"].textContent = `${summary.accuracy} %`;
  elements["summary-time"].textContent = formatActiveTime(summary.active_seconds);
  elements["summary-pending-label"].textContent = failed
    ? "Continúan pendientes"
    : "Nuevas falladas pendientes";
  elements["summary-mastered-label"].textContent = failed
    ? "Preguntas dominadas"
    : "Nuevas dominadas";
  elements["summary-pending"].textContent = failed ? summary.still_pending.length : summary.newly_pending_failures;
  elements["summary-mastered"].textContent = failed ? summary.mastered : summary.newly_mastered;
  elements["summary-pending-list-wrap"].hidden = !failed || summary.still_pending.length === 0;
  elements["summary-pending-list"].replaceChildren(...(failed ? summary.still_pending.map((pending) => {
    const question = study.questions.find((candidate) => (
      candidate.id === pending.question_id && candidate.sourceExamId === pending.exam_id
    ));
    const item = document.createElement("li");
    item.textContent = question
      ? `${question.sourceExamTitle} · ${question.displayLabel || `Pregunta ${question.sourceNumber}`}`
      : `${pending.exam_id} · ${pending.question_id}`;
    return item;
  }) : []));
  showOnly(elements["summary-view"]);
}

async function routePrivateView() {
  const serial = ++routeSerial;
  try {
    await Promise.all([ensureCatalog(), refreshStatuses()]);
    if (serial !== routeSerial) return;
    const studyId = window.location.hash.match(/^#study=([^&]+)$/)?.[1];
    const examModeId = window.location.hash.match(/^#exam-mode=([^&]+)$/)?.[1];
    const failedScope = window.location.hash.match(/^#failed=([^&]+)$/)?.[1];
    const examId = window.location.hash.match(/^#exam=([^&]+)$/)?.[1];
    if (activeExamAttempt && !examModeId) {
      const { data: expiredSummary, error: expiryError } = await supabase.rpc("finish_expired_exam_attempt", {
        p_attempt_id: activeExamAttempt.id,
      });
      if (expiryError) throw expiryError;
      if (expiredSummary) {
        await refreshStatuses();
        if (serial !== routeSerial) return;
        window.location.hash = "catalog";
        renderCatalog();
        showOnly(elements["catalog-view"]);
        return;
      }
    }
    if (examModeId) {
      await selectExam(decodeURIComponent(examModeId), { updateHash: false });
      await startExam();
    } else if (failedScope) {
      const scope = decodeURIComponent(failedScope);
      if (scope !== "all" && !catalog.some(({ id }) => id === scope)) return showCatalog();
      await startFailedStudy(scope === "all" ? null : scope);
    } else if (studyId) {
      await selectExam(decodeURIComponent(studyId), { updateHash: false });
      await startStudy();
    } else if (examId) {
      await selectExam(decodeURIComponent(examId), { updateHash: false });
    } else {
      await showCatalog();
    }
  } catch (error) {
    showOnly(elements["catalog-view"]);
    showError(elements["catalog-status"], `No se pudo abrir la vista privada. ${error.message}`);
  }
}

function renderAuthSession(session) {
  elements["logout-button"].hidden = !session;
  elements["login-error"].hidden = true;
  if (!session) {
    study = undefined;
    showOnly(elements["login-view"]);
    return;
  }
  routePrivateView();
}

async function submitLogin(event) {
  event.preventDefault();
  clearError(elements["login-error"]);
  elements["login-button"].disabled = true;
  const data = new FormData(elements["login-form"]);
  const { error } = await supabase.auth.signInWithPassword({ email: data.get("email"), password: data.get("password") });
  elements["login-button"].disabled = false;
  if (error) showError(elements["login-error"], "No se pudo iniciar sesión. Revisa tus datos.");
}

function recordActivity() { lastActivityAt = Date.now(); }

function tickActiveTime() {
  if (study?.attempt.kind === "exam") {
    const remaining = Date.parse(study.attempt.deadline_at) - (Date.now() + examServerOffsetMs);
    elements["active-time"].textContent = `Tiempo restante: ${formatCountdown(remaining)}`;
    if (remaining <= 0 && !study.locked) {
      study.locked = true;
      renderStudy();
      finalizeExam();
    }
    return;
  }
  if (
    study?.attempt.status === "active"
    && !study.attempt.is_paused
    && document.visibilityState === "visible"
    && Date.now() - lastActivityAt <= RECENT_ACTIVITY_MS
  ) {
    pendingActiveSeconds += 1;
    persistLocalState();
    elements["active-time"].textContent = `Tiempo activo: ${formatActiveTime(study.attempt.active_seconds + pendingActiveSeconds)}`;
    if (pendingActiveSeconds >= 15) saveAttempt().catch(() => {});
  }
}

async function boot() {
  if (!publishableKey?.startsWith("sb_publishable_")) {
    showOnly(elements["login-view"]);
    showError(elements["login-error"], "La aplicación no tiene configurado el acceso público autorizado.");
    elements["login-button"].disabled = true;
    return;
  }

  supabase = createClient(supabaseUrl, publishableKey);
  elements["login-form"].addEventListener("submit", submitLogin);
  elements["logout-button"].addEventListener("click", () => supabase.auth.signOut());
  elements["back-button"].addEventListener("click", showCatalog);
  elements["start-study-button"].addEventListener("click", () => startStudy("normal"));
  elements["start-random-study-button"].addEventListener("click", () => startStudy("random"));
  elements["start-exam-button"].addEventListener("click", startExam);
  elements["start-failed-button"].addEventListener("click", () => startFailedStudy(selectedExam?.id));
  elements["all-failed-button"].addEventListener("click", () => startFailedStudy(null));
  elements["cancel-strategy-change"].addEventListener("click", () => {
    pendingStrategyChange = null;
    elements["strategy-warning"].close();
  });
  elements["confirm-strategy-change"].addEventListener("click", () => {
    const strategy = pendingStrategyChange;
    pendingStrategyChange = null;
    elements["strategy-warning"].close();
    startStudy(strategy, { replace: true });
  });
  elements["confirm-button"].addEventListener("click", confirmAnswer);
  elements["skip-button"].addEventListener("click", () => moveNext({ skip: true }));
  elements["clear-exam-answer"].addEventListener("click", () => {
    const questionId = study.currentQuestion.id;
    const position = study.index;
    study.clear();
    renderStudy();
    saveExamSelection(questionId, null, position);
  });
  elements["submit-exam-button"].addEventListener("click", () => {
    const answered = study.answeredCount;
    const blank = study.questions.length - answered;
    elements["exam-submit-counts"].textContent = `${answered} contestada${answered === 1 ? "" : "s"} · ${blank} en blanco`;
    elements["exam-submit-dialog"].showModal();
  });
  elements["cancel-exam-submit"].addEventListener("click", () => elements["exam-submit-dialog"].close());
  elements["confirm-exam-submit"].addEventListener("click", finalizeExam);
  elements["next-pending-button"].addEventListener("click", () => moveNext());
  elements["complete-button"].addEventListener("click", completeStudy);
  elements["pause-button"].addEventListener("click", togglePause);
  elements["exit-study-button"].addEventListener("click", exitStudy);
  elements["summary-catalog-button"].addEventListener("click", showCatalog);
  ["pointerdown", "keydown", "touchstart"].forEach((name) => window.addEventListener(name, recordActivity, { passive: true }));
  document.addEventListener("visibilitychange", recordActivity);
  timer = window.setInterval(tickActiveTime, 1000);

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => renderAuthSession(session), 0);
  });
  window.addEventListener("pagehide", () => {
    window.clearInterval(timer);
    persistLocalState();
    subscription.unsubscribe();
  }, { once: true });

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    showOnly(elements["login-view"]);
    showError(elements["login-error"], "No se pudo comprobar la sesión. Inténtalo de nuevo.");
    return;
  }
  renderAuthSession(session);
}

boot();
