import { createClient } from "@supabase/supabase-js";
import { ActiveAttemptPersistence } from "./active-attempt-persistence.js";
import { materializeArtificialSources } from "./artificial-exam.js";
import { loadPinnedExam, loadPublishedCatalog } from "./catalog.js";
import { loadDashboard, percent, score } from "./dashboard.js";
import {
  HISTORY_KIND_LABELS,
  HISTORY_MODE_LABELS,
  HISTORY_STATUS_LABELS,
  historyDurationSeconds,
  loadHistoryReplay,
  loadPersonalHistory,
} from "./history.js";
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
  "sync-status", "sync-recovery", "dashboard-button", "dashboard-view", "dashboard-catalog-button",
  "dashboard-status", "dashboard-content", "dashboard-global", "dashboard-shared", "dashboard-rankings",
  "dashboard-exams", "dashboard-questions", "dashboard-common", "history-button", "history-view", "history-catalog-button",
  "history-status", "history-list", "history-detail-view", "history-detail-back",
  "history-detail-title", "history-detail-meta", "history-detail-metrics", "history-detail-version",
  "history-questions", "history-detail-error",
  "artificial-study-button", "artificial-exam-button", "artificial-error",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const privateViews = [
  elements["catalog-view"], elements["exam-view"], elements["study-view"], elements["summary-view"],
  elements["dashboard-view"], elements["history-view"], elements["history-detail-view"],
];
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
let confirmationRetryAvailable = false;
let pendingStrategyChange = null;
let examServerOffsetMs = 0;
let examSavePromise = Promise.resolve();
let examFinalizing = false;
let persistence;
let persistenceUserId;
let history = [];
let dashboard;

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

function formatHistoryDate(value) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function historyTime(attempt) {
  const seconds = historyDurationSeconds(attempt);
  return seconds == null ? null : formatActiveTime(seconds);
}

function historyMetrics(attempt) {
  const metrics = [`${attempt.answered_questions} respondidas`];
  const resultsAvailable = attempt.kind !== "exam" || attempt.status === "completed";
  if (resultsAvailable) {
    metrics.push(`${attempt.correct_answers} correctas`, `${attempt.wrong_answers} incorrectas`);
  }
  if (resultsAvailable && attempt.blank_answers != null) metrics.push(`${attempt.blank_answers} en blanco`);
  if (attempt.score != null) metrics.push(`${formatScore(attempt.score)} / 100`);
  const time = historyTime(attempt);
  if (time) metrics.push(`${attempt.kind === "exam" ? "Tiempo de examen" : "Tiempo activo"}: ${time}`);
  return metrics;
}

function historyKindLabel(attempt) {
  return HISTORY_KIND_LABELS[attempt.origin === "artificial" ? "artificial" : attempt.kind] || attempt.kind;
}

function historyModeLabel(attempt) {
  return HISTORY_MODE_LABELS[attempt.strategy] || attempt.strategy;
}

function renderHistory() {
  elements["history-list"].replaceChildren(...history.map((attempt) => {
    const entry = document.createElement("article");
    entry.className = "history-entry";
    entry.dataset.attemptId = attempt.id;
    const copy = document.createElement("div");
    const date = document.createElement("p");
    date.className = "eyebrow";
    date.textContent = formatHistoryDate(attempt.created_at);
    const title = document.createElement("h2");
    title.textContent = attempt.origin === "artificial"
      ? "Examen artificial"
      : attempt.kind === "failed" && !attempt.failed_scope_exam_id
      ? "Todas mis falladas"
      : `Banco oficial · ${attempt.failed_scope_exam_id || attempt.exam_id}`;
    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = `${historyKindLabel(attempt)} · ${historyModeLabel(attempt)} · ${HISTORY_STATUS_LABELS[attempt.status] || attempt.status}`;
    const metrics = document.createElement("p");
    metrics.className = "history-metrics";
    metrics.textContent = historyMetrics(attempt).join(" · ");
    copy.append(date, title, meta, metrics);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Abrir en solo lectura";
    button.addEventListener("click", () => showHistoryDetail(attempt.id));
    entry.append(copy, button);
    return entry;
  }));
  elements["history-status"].hidden = history.length > 0;
  elements["history-status"].textContent = history.length ? "" : "Todavía no hay intentos persistidos.";
  elements["history-list"].hidden = history.length === 0;
}

async function showHistory() {
  study = undefined;
  window.location.hash = "history";
  showOnly(elements["history-view"]);
  elements["history-status"].hidden = false;
  elements["history-status"].textContent = "Cargando Historial…";
  elements["history-list"].hidden = true;
  try {
    history = await loadPersonalHistory(supabase);
    renderHistory();
  } catch (error) {
    showError(elements["history-status"], `No se pudo cargar el Historial personal. ${error.message}`);
  }
}

function metricNode(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  wrapper.append(term, detail);
  return wrapper;
}

function dashboardExamTitle(examId) {
  return catalog.find(({ id }) => id === examId)?.title || examId;
}

function dashboardTable(headers, rows) {
  const table = document.createElement("table");
  table.className = "dashboard-table";
  const head = document.createElement("thead");
  const heading = document.createElement("tr");
  heading.append(...headers.map((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    return cell;
  }));
  head.append(heading);
  const body = document.createElement("tbody");
  body.append(...rows.map((values) => {
    const row = document.createElement("tr");
    row.append(...values.map((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      return cell;
    }));
    return row;
  }));
  table.append(head, body);
  return table;
}

function dashboardEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "panel compact dashboard-empty";
  empty.textContent = message;
  return empty;
}

function renderDashboard() {
  const global = dashboard.personal.global;
  elements["dashboard-global"].replaceChildren(
    metricNode("Respuestas", global.answer_count),
    metricNode("Tasa de acierto", percent(global.accuracy)),
    metricNode("Tiempo activo de estudio", formatActiveTime(global.study_active_seconds)),
    metricNode("Nota media oficial", score(global.average_score)),
    metricNode("Mejor nota oficial", score(global.best_score)),
    metricNode("Preguntas dominadas", global.dominated_count),
  );

  elements["dashboard-shared"].replaceChildren(dashboardTable(
    ["Participante", "Respuestas", "Acierto", "Estudio", "Nota media", "Mejor nota", "Dominadas"],
    dashboard.shared.profiles.map((profile) => [
      profile.alias,
      profile.answer_count,
      percent(profile.accuracy),
      formatActiveTime(profile.study_active_seconds),
      score(profile.average_score),
      score(profile.best_score),
      profile.dominated_count,
    ]),
  ));

  const rankings = new Map();
  dashboard.shared.official_exam_rankings.forEach((entry) => {
    if (!rankings.has(entry.exam_id)) rankings.set(entry.exam_id, []);
    rankings.get(entry.exam_id).push(entry);
  });
  elements["dashboard-rankings"].replaceChildren(...(
    rankings.size ? [...rankings].map(([examId, entries]) => {
      const card = document.createElement("article");
      card.className = "panel compact dashboard-card";
      const title = document.createElement("h3");
      title.textContent = dashboardExamTitle(examId);
      card.append(title, dashboardTable(
        ["Posición", "Participante", "Mejor nota", "Tiempo del récord"],
        entries.map((entry) => [
          entry.rank,
          entry.alias,
          score(entry.score),
          formatActiveTime(entry.exam_elapsed_ms / 1000),
        ]),
      ));
      return card;
    }) : [dashboardEmpty("Todavía no hay intentos oficiales puntuados para construir un ranking.")]
  ));

  elements["dashboard-exams"].replaceChildren(...dashboard.personal.official_exams.map((exam) => {
    const card = document.createElement("article");
    card.className = "panel compact dashboard-card";
    const title = document.createElement("h3");
    title.textContent = dashboardExamTitle(exam.exam_id);
    const latest = exam.latest_attempt_at
      ? `${formatHistoryDate(exam.latest_attempt_at)} · ${HISTORY_STATUS_LABELS[exam.latest_attempt_status] || exam.latest_attempt_status}${exam.latest_attempt_score == null ? "" : ` · ${score(exam.latest_attempt_score)}`}`
      : "Sin intentos";
    const metrics = document.createElement("dl");
    metrics.className = "dashboard-exam-metrics";
    metrics.append(
      metricNode("Intentos", exam.attempt_count),
      metricNode("Mejor nota", score(exam.best_score)),
      metricNode("Nota media", score(exam.average_score)),
      metricNode("Mejor tiempo", exam.best_time_ms == null ? "Sin intentos" : formatActiveTime(exam.best_time_ms / 1000)),
      metricNode("Tasa de acierto", percent(exam.accuracy)),
      metricNode("Falladas pendientes", exam.pending_failures),
      metricNode("Dominadas", exam.dominated_count),
      metricNode("Último intento", latest),
    );
    card.append(title, metrics);
    return card;
  }));

  elements["dashboard-questions"].replaceChildren(...(
    dashboard.personal.questions.length ? [dashboardTable(
      ["Pregunta", "Intentos", "Aciertos", "Errores", "Acierto", "Dominio"],
      dashboard.personal.questions.map((question) => [
        question.question_id,
        question.attempts,
        question.correct,
        question.wrong,
        percent(question.accuracy),
        { mastered: "Dominada", pending: "Fallada pendiente", never_failed: "Nunca fallada" }[question.mastery],
      ]),
    )] : [dashboardEmpty("Todavía no hay progreso por pregunta.")]
  ));

  elements["dashboard-common"].replaceChildren(...(
    dashboard.shared.failed_by_all.length ? dashboard.shared.failed_by_all.map((question) => {
      const item = document.createElement("article");
      item.className = "dashboard-common-item";
      const title = document.createElement("strong");
      title.textContent = question.question_id;
      const context = document.createElement("span");
      context.textContent = `${dashboardExamTitle(question.exam_id)} · Fallada por 3 de 3`;
      item.append(title, context);
      return item;
    }) : [dashboardEmpty("No hay preguntas falladas por los tres participantes.")]
  ));
  elements["dashboard-status"].hidden = true;
  elements["dashboard-content"].hidden = false;
}

async function showDashboard() {
  ++routeSerial;
  study = undefined;
  window.location.hash = "dashboard";
  showOnly(elements["dashboard-view"]);
  elements["dashboard-status"].hidden = false;
  elements["dashboard-status"].textContent = "Cargando Dashboard…";
  elements["dashboard-content"].hidden = true;
  try {
    await ensureCatalog();
    dashboard = await loadDashboard(supabase);
    renderDashboard();
  } catch (error) {
    showError(elements["dashboard-status"], `No se pudo cargar el Dashboard. ${error.message}`);
  }
}

function renderHistoryQuestions(replay) {
  const latestAnswers = new Map();
  replay.answers.forEach((answer) => latestAnswers.set(answer.question_id, answer));
  return replay.questions.map((question, index) => {
    const answer = latestAnswers.get(question.id);
    const card = document.createElement("article");
    card.className = "history-question";
    const source = document.createElement("p");
    source.className = "step";
    source.textContent = question.sourceExamTitle
      ? `${question.sourceExamTitle} · ${question.displayLabel || `Pregunta ${question.sourceNumber}`}`
      : question.displayLabel || `Pregunta ${question.sourceNumber || index + 1}`;
    const title = document.createElement("h2");
    title.textContent = question.text;
    const options = document.createElement("div");
    options.className = "answer-options";
    options.replaceChildren(...question.options.map((option) => {
      const label = document.createElement("label");
      label.className = "answer-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.disabled = true;
      input.checked = answer?.selected_option === option.id;
      const text = document.createElement("span");
      text.textContent = `${option.id}. ${option.text}`;
      if (answer?.correct_option && option.id === answer.correct_option) label.classList.add("correct-option");
      if (answer?.is_correct === false && option.id === answer.selected_option) label.classList.add("wrong-option");
      label.append(input, text);
      return label;
    }));
    const state = document.createElement("p");
    state.className = "history-answer-state";
    state.textContent = !answer || answer.selected_option == null
      ? "Sin respuesta persistida"
      : answer.correct_option == null
      ? `Respuesta guardada: ${answer.selected_option}. Corrección no disponible mientras el intento sigue activo.`
      : answer.is_correct
      ? `Correcta · Respuesta oficial: ${answer.correct_option}`
      : `Incorrecta · Respuesta oficial: ${answer.correct_option}`;
    card.append(source, title, options, state);
    return card;
  });
}

async function showHistoryDetail(attemptId) {
  let attempt = history.find(({ id }) => id === attemptId);
  if (!attempt) {
    history = await loadPersonalHistory(supabase);
    attempt = history.find(({ id }) => id === attemptId);
  }
  if (!attempt) return showHistory();
  window.location.hash = `history=${encodeURIComponent(attempt.id)}`;
  showOnly(elements["history-detail-view"]);
  clearError(elements["history-detail-error"]);
  elements["history-detail-title"].textContent = attempt.exam_id;
  elements["history-detail-meta"].textContent = "Cargando la versión exacta del intento…";
  elements["history-detail-metrics"].replaceChildren();
  elements["history-questions"].replaceChildren();
  try {
    const replay = await loadHistoryReplay(supabase, fetch, bankBaseUrl, attempt);
    elements["history-detail-title"].textContent = replay.title;
    elements["history-detail-meta"].textContent = `${formatHistoryDate(attempt.created_at)} · ${historyKindLabel(attempt)} · ${historyModeLabel(attempt)} · ${HISTORY_STATUS_LABELS[attempt.status] || attempt.status}`;
    const metricValues = [metricNode("Respondidas", attempt.answered_questions)];
    const resultsAvailable = attempt.kind !== "exam" || attempt.status === "completed";
    if (resultsAvailable) {
      metricValues.push(
        metricNode("Correctas", attempt.correct_answers),
        metricNode("Incorrectas", attempt.wrong_answers),
      );
    }
    if (resultsAvailable && attempt.blank_answers != null) metricValues.push(metricNode("En blanco", attempt.blank_answers));
    if (attempt.score != null) metricValues.push(metricNode("Nota", `${formatScore(attempt.score)} / 100`));
    const time = historyTime(attempt);
    if (time) metricValues.push(metricNode(attempt.kind === "exam" ? "Tiempo de examen" : "Tiempo activo", time));
    elements["history-detail-metrics"].replaceChildren(...metricValues);
    elements["history-detail-version"].textContent = (attempt.kind === "failed" && !attempt.failed_scope_exam_id) || attempt.origin === "artificial"
      ? "Versiones históricas fijadas por pregunta"
      : `Versión histórica fijada: ${attempt.exam_version_id}`;
    if ((attempt.kind === "failed" && !attempt.failed_scope_exam_id) || attempt.origin === "artificial") {
      delete elements["history-detail-version"].dataset.versionPath;
    } else {
      elements["history-detail-version"].dataset.versionPath = attempt.exam_version_path;
    }
    elements["history-questions"].replaceChildren(...renderHistoryQuestions(replay));
  } catch (error) {
    showError(elements["history-detail-error"], `No se pudo abrir la revisión histórica. ${error.message}`);
  }
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
    attempt.origin ||= attempt.exam_id === "__artificial__" ? "artificial" : "official";
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
  const artificialAvailable = catalog.reduce((total, exam) => total + exam.questions.length, 0) >= 75;
  const examIsActive = activeExamAttempt && Date.parse(activeExamAttempt.deadline_at) > Date.now();
  elements["artificial-study-button"].disabled = !artificialAvailable || Boolean(examIsActive);
  elements["artificial-exam-button"].disabled = !artificialAvailable;
  elements["artificial-exam-button"].textContent = activeExamAttempt?.origin === "artificial"
    ? "Continuar Modo examen artificial"
    : "Generar en Modo examen";
  if (!artificialAvailable) {
    showError(elements["artificial-error"], "El Banco publicado no contiene al menos 75 Preguntas activas distintas.");
  } else {
    clearError(elements["artificial-error"]);
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

function currentPersistenceState() {
  return { position: study.index, isPaused: Boolean(study.attempt.is_paused) };
}

function renderSyncStatus({ online, pending, conflict }) {
  elements["sync-status"].hidden = false;
  elements["sync-status"].className = `sync-status${online ? "" : " offline"}${pending ? " pending" : ""}`;
  elements["sync-status"].textContent = online
    ? pending ? "Cambios pendientes" : "En línea · Sincronizado"
    : pending ? "Sin conexión · Cambios pendientes" : "Sin conexión";
  if (!conflict) return;
  elements["sync-recovery"].textContent = "Otro dispositivo guardó un avance más reciente. Se ha recargado el estado de Supabase sin mezclar ni sobrescribir cambios. La edición simultánea del mismo intento no está soportada.";
  elements["sync-recovery"].hidden = false;
}

function ensurePersistence(session) {
  const userId = session?.user?.id;
  if (!userId || (persistence && persistenceUserId === userId)) return;
  persistence?.destroy();
  persistenceUserId = userId;
  persistence = new ActiveAttemptPersistence({
    client: supabase,
    storage: localStorage,
    userId,
    onStatus: renderSyncStatus,
    onReconnect: () => syncPendingAttempt().catch(() => {}),
  });
}

function applyPendingView(view) {
  const pending = view.pending;
  pendingActiveSeconds = persistence?.pendingActiveSeconds || 0;
  if (!pending) return;
  if (study.attempt.kind === "exam") {
    for (const answer of pending.exam_answers) {
      study.selections.set(answer.question_id, answer.selected_option);
    }
  } else {
    for (const confirmation of pending.study_confirmations) {
      study.applyConfirmation({
        id: confirmation.id,
        question_id: confirmation.question_id,
        answer_sequence: 1,
        selected_option: confirmation.selected_option,
        correct_option: confirmation.correct_option,
        is_correct: confirmation.selected_option === confirmation.correct_option,
        confirmed_at: new Date(0).toISOString(),
      });
    }
    study.attempt.is_paused = pending.is_paused;
  }
  if (Number.isInteger(pending.position) && pending.position >= 0 && pending.position < study.questions.length) {
    study.goTo(pending.position);
  }
  if (study.attempt.kind === "exam" && pending.finalize) study.locked = true;
}

async function applyPersistenceResult(result) {
  if (!result || !study || result.attempt.id !== study.attempt.id) return;
  const questions = study.questions;
  const attempt = result.attempt;
  const pinned = { id: attempt.exam_id, version: { id: attempt.exam_version_id }, questions };
  study = attempt.kind === "exam"
    ? new ExamSession(pinned, attempt, result.answers)
    : new NormalStudySession(pinned, attempt, result.answers);
  pendingActiveSeconds = persistence?.pendingActiveSeconds || 0;
  if (result.conflict) {
    elements["sync-recovery"].textContent = "Otro dispositivo guardó un avance más reciente. Se ha recargado el estado de Supabase sin mezclar ni sobrescribir cambios. La edición simultánea del mismo intento no está soportada.";
    elements["sync-recovery"].hidden = false;
  }
  if (result.summary) {
    if (attempt.kind === "exam") showExamSummary(result.summary);
    else showSummary(result.summary);
    return;
  }
  renderStudy();
}

async function syncPendingAttempt() {
  if (!persistence?.hasPending) return null;
  try {
    const result = await persistence.sync();
    confirmationRetryAvailable = false;
    await applyPersistenceResult(result);
    return result;
  } catch (error) {
    confirmationRetryAvailable = true;
    if (study) {
      showError(elements["study-error"], `Cambios pendientes de sincronizar. ${error.message}`);
      renderStudy();
    }
    throw error;
  }
}

async function flushPendingBeforeAttemptChange(errorElement) {
  if (!persistence?.hasPending) return true;
  try {
    await syncPendingAttempt();
  } catch (error) {
    showError(errorElement, `Sincroniza los Cambios pendientes antes de abrir otro intento. ${error.message}`);
    return false;
  }
  return !persistence.hasPending;
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
  if (!await flushPendingBeforeAttemptChange(elements["exam-error"])) return;
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
    attempt.server_clock_offset_ms = Date.parse(attempt.server_now) - (clockRequestAt + clockResponseAt) / 2;
    const pinned = attempt.exam_version_id === selectedExam.version && attempt.exam_version_path === selectedExam.versionPath
      ? { exam: selectedExam.package }
      : await loadPinnedExam(fetch, bankBaseUrl, attempt);
    const catalogExam = catalog.find(({ id }) => id === attempt.exam_id);
    if (catalogExam) selectedExam = catalogExam;
    const answers = await fetchAttemptAnswers(attempt.id);
    const view = persistence.begin(attempt, answers);
    study = new ExamSession(pinned.exam, view.attempt, view.answers);
    applyPendingView(view);
    activeExamAttempt = attempt;
    examServerOffsetMs = view.attempt.server_clock_offset_ms;
    examSavePromise = Promise.resolve();
    examFinalizing = false;
    const expired = Date.parse(view.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    study.locked = expired;
    window.location.hash = `exam-mode=${encodeURIComponent(view.attempt.exam_id)}`;
    renderStudy();
    if (expired) persistence.queueFinalization(currentPersistenceState());
    if (persistence.hasPending) syncPendingAttempt().catch(() => {});
  } catch (error) {
    const view = persistence?.restore({ examId: selectedExam.id, kind: "exam" });
    if (!view) {
      showError(elements["exam-error"], `No se pudo iniciar o recuperar el Modo examen. ${error.message}`);
      return;
    }
    study = new ExamSession(selectedExam.package, view.attempt, view.answers);
    examServerOffsetMs = view.attempt.server_clock_offset_ms || 0;
    applyPendingView(view);
    activeExamAttempt = view.attempt;
    examSavePromise = Promise.resolve();
    examFinalizing = false;
    study.locked = Date.parse(view.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    window.location.hash = `exam-mode=${encodeURIComponent(view.attempt.exam_id)}`;
    if (study.locked && !view.pending?.finalize) persistence.queueFinalization(currentPersistenceState());
    renderStudy();
    showError(elements["study-error"], "Sin conexión. El intento se ha recuperado en este dispositivo y mantiene cambios pendientes.");
  } finally {
    elements["start-exam-button"].disabled = false;
  }
}

function saveExamSelection(questionId, selectedOption, position) {
  persistence.queueExamAnswer({
    id: crypto.randomUUID(), questionId, selectedOption,
  }, { position, isPaused: false });
  const save = () => syncPendingAttempt();
  examSavePromise = examSavePromise.then(save, save);
  examSavePromise.catch((error) => {
    showError(elements["study-error"], `La respuesta queda en Cambios pendientes. ${error.message}`);
  });
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
  if (!await flushPendingBeforeAttemptChange(elements["exam-error"])) return;
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
    const view = persistence.begin(attempt, answers);
    study = new NormalStudySession(pinned.exam, view.attempt, view.answers);
    activeStrategies.set(selectedExam.id, attempt.strategy);
    pendingActiveSeconds = 0;
    confirmationRetryAvailable = false;
    applyPendingView(view);
    window.location.hash = `study=${encodeURIComponent(selectedExam.id)}`;
    renderStudy();
    if (persistence.hasPending) syncPendingAttempt().catch(() => {});
  } catch (error) {
    const view = persistence?.restore({ examId: selectedExam.id, kind: "normal" });
    if (!view) {
      showError(elements["exam-error"], `No se pudo iniciar o recuperar el estudio. ${error.message}`);
      return;
    }
    study = new NormalStudySession(selectedExam.package, view.attempt, view.answers);
    activeStrategies.set(selectedExam.id, view.attempt.strategy);
    confirmationRetryAvailable = true;
    applyPendingView(view);
    window.location.hash = `study=${encodeURIComponent(selectedExam.id)}`;
    renderStudy();
    showError(elements["study-error"], "Sin conexión. El intento se ha recuperado en este dispositivo y mantiene Cambios pendientes.");
  } finally {
    elements["start-study-button"].disabled = false;
    elements["start-random-study-button"].disabled = false;
  }
}

async function loadCompositeQuestions(attempt) {
  const { data: sources, error } = await supabase
    .from("attempt_question_sources")
    .select("position,exam_id,exam_version_id,exam_version_path,question_id")
    .eq("attempt_id", attempt.id)
    .order("position", { ascending: true });
  if (error) throw error;
  if (!sources?.length || sources.length !== attempt.question_ids.length) {
    throw new Error("La composición persistida del intento no es válida.");
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

async function startArtificial(mode) {
  clearError(elements["artificial-error"]);
  if (!await flushPendingBeforeAttemptChange(elements["artificial-error"])) return;
  elements["artificial-study-button"].disabled = true;
  elements["artificial-exam-button"].disabled = true;
  try {
    const sources = materializeArtificialSources(catalog);
    const clockRequestAt = Date.now();
    const { data, error } = await supabase.rpc("start_or_resume_artificial_attempt", {
      p_mode: mode,
      p_sources: sources,
    });
    if (error) throw error;
    const clockResponseAt = Date.now();
    const attempt = normalizeRow(data);
    if (attempt.kind === "exam") {
      attempt.server_clock_offset_ms = Date.parse(attempt.server_now) - (clockRequestAt + clockResponseAt) / 2;
    }
    const questions = await loadCompositeQuestions(attempt);
    const composedExam = { id: attempt.exam_id, version: { id: attempt.exam_version_id }, questions };
    const answers = await fetchAttemptAnswers(attempt.id);
    const view = persistence.begin(attempt, answers, { questions });
    study = attempt.kind === "exam"
      ? new ExamSession(composedExam, view.attempt, view.answers)
      : new NormalStudySession(composedExam, view.attempt, view.answers);
    selectedExam = undefined;
    applyPendingView(view);
    if (attempt.kind === "exam") {
      activeExamAttempt = attempt;
      examServerOffsetMs = view.attempt.server_clock_offset_ms;
      study.locked = Date.parse(view.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
      if (study.locked) persistence.queueFinalization(currentPersistenceState());
    } else {
      pendingActiveSeconds = 0;
    }
    window.location.hash = `artificial-${mode}`;
    renderStudy();
    if (persistence.hasPending) syncPendingAttempt().catch(() => {});
  } catch (error) {
    const kind = mode === "exam" ? "exam" : "normal";
    const view = persistence?.restore({ kind });
    if (!view || view.attempt.origin !== "artificial" || !view.questions?.length) {
      showError(elements["artificial-error"], `No se pudo generar el Examen artificial. ${error.message}`);
      return;
    }
    const composedExam = {
      id: view.attempt.exam_id,
      version: { id: view.attempt.exam_version_id },
      questions: view.questions,
    };
    study = kind === "exam"
      ? new ExamSession(composedExam, view.attempt, view.answers)
      : new NormalStudySession(composedExam, view.attempt, view.answers);
    selectedExam = undefined;
    applyPendingView(view);
    if (kind === "exam") {
      activeExamAttempt = view.attempt;
      examServerOffsetMs = view.attempt.server_clock_offset_ms || 0;
      study.locked = Date.parse(view.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    }
    window.location.hash = `artificial-${mode}`;
    renderStudy();
    showError(elements["study-error"], "Sin conexión. El Examen artificial conserva sus Cambios pendientes en este dispositivo.");
  } finally {
    elements["artificial-study-button"].disabled = false;
    elements["artificial-exam-button"].disabled = false;
  }
}

async function startFailedStudy(scopeExamId = null) {
  const errorElement = scopeExamId ? elements["exam-error"] : elements["all-failed-error"];
  clearError(errorElement);
  if (!await flushPendingBeforeAttemptChange(errorElement)) return;
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
    const questions = await loadCompositeQuestions(attempt);
    const answers = await fetchAttemptAnswers(attempt.id);
    const view = persistence.begin(attempt, answers, { questions });
    study = new NormalStudySession({
      id: attempt.exam_id,
      version: { id: attempt.exam_version_id },
      questions,
    }, view.attempt, view.answers);
    activeFailedAttempt = attempt;
    selectedExam = attempt.failed_scope_exam_id
      ? catalog.find(({ id }) => id === attempt.failed_scope_exam_id)
      : undefined;
    pendingActiveSeconds = 0;
    confirmationRetryAvailable = false;
    applyPendingView(view);
    window.location.hash = `failed=${encodeURIComponent(attempt.failed_scope_exam_id || "all")}`;
    renderStudy();
    if (persistence.hasPending) syncPendingAttempt().catch(() => {});
  } catch (error) {
    const view = persistence?.restore({ kind: "failed" });
    const expectedScope = scopeExamId || null;
    if (!view || (view.attempt.failed_scope_exam_id || null) !== expectedScope || !view.questions?.length) {
      showError(errorElement, `No se pudo iniciar o recuperar la Sesión de falladas. ${error.message}`);
      return;
    }
    study = new NormalStudySession({
      id: view.attempt.exam_id,
      version: { id: view.attempt.exam_version_id },
      questions: view.questions,
    }, view.attempt, view.answers);
    activeFailedAttempt = view.attempt;
    selectedExam = expectedScope ? catalog.find(({ id }) => id === expectedScope) : undefined;
    confirmationRetryAvailable = true;
    applyPendingView(view);
    window.location.hash = `failed=${encodeURIComponent(expectedScope || "all")}`;
    renderStudy();
    showError(elements["study-error"], "Sin conexión. La Sesión de falladas mantiene Cambios pendientes en este dispositivo.");
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
      try {
        if (study.attempt.kind === "exam") {
          persistence.queueState(currentPersistenceState());
          await syncPendingAttempt();
        } else {
          await saveAttempt();
        }
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
    : blockedByExam || corrected || study.attempt.is_paused;
  input.addEventListener("change", () => {
    study.select(option.id);
    if (study.attempt.kind === "exam") {
      const questionId = study.currentQuestion.id;
      const position = study.index;
      renderStudy();
      saveExamSelection(questionId, option.id, position);
      return;
    }
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
  const latest = examMode ? null : study.latestAnswers.get(question.id);
  const corrected = !examMode && Boolean(latest);
  const paused = !examMode && study.attempt.is_paused;
  elements["study-panel"].dataset.attemptId = study.attempt.id;
  elements["study-panel"].dataset.questionId = question.id;
  elements["study-panel"].dataset.strategy = study.attempt.strategy;
  elements["study-panel"].dataset.kind = study.attempt.kind;
  elements["study-panel"].dataset.origin = study.attempt.origin || "official";
  elements["study-panel"].dataset.sourceExamId = question.sourceExamId || study.attempt.exam_id;
  elements["study-exam-title"].textContent = study.attempt.origin === "artificial"
    ? "Examen artificial"
    : study.attempt.kind === "failed"
    ? selectedExam?.title || "Todas mis falladas"
    : selectedExam?.title || study.attempt.exam_id;
  elements["study-strategy-label"].textContent = examMode
    ? study.attempt.origin === "artificial" ? "Examen artificial · Modo examen" : "Modo examen"
    : study.attempt.origin === "artificial"
    ? "Examen artificial · Modo estudio"
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
  const showsSource = study.attempt.kind === "failed" || study.attempt.origin === "artificial";
  elements["study-source"].hidden = !showsSource;
  elements["study-source"].textContent = showsSource
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

  const retryVisible = corrected && confirmationRetryAvailable && persistence?.hasPending;
  elements["confirm-button"].hidden = examMode || (corrected && !retryVisible);
  elements["confirm-button"].textContent = retryVisible ? "Reintentar sincronización" : "Confirmar respuesta";
  const blockedByExam = !examMode && activeExamAttempt && Date.parse(activeExamAttempt.deadline_at) > Date.now();
  elements["confirm-button"].disabled = paused || Boolean(blockedByExam) || (!retryVisible && !study.selectedOption);
  elements["skip-button"].hidden = examMode || corrected;
  elements["skip-button"].disabled = paused;
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
  if (study.latestAnswers.has(question.id) && persistence?.hasPending) {
    await syncPendingAttempt().catch(() => {});
    return;
  }
  if (!study.selectedOption) return;
  clearError(elements["study-error"]);
  confirmationRetryAvailable = false;
  elements["confirm-button"].disabled = true;
  const payload = {
    p_confirmation_id: crypto.randomUUID(),
    p_attempt_id: study.attempt.id,
    p_question_id: question.id,
    p_selected_option: study.selectedOption,
    p_correct_option: question.correctOption,
  };
  study.applyConfirmation({
    id: payload.p_confirmation_id,
    question_id: payload.p_question_id,
    answer_sequence: 1,
    selected_option: payload.p_selected_option,
    correct_option: payload.p_correct_option,
    is_correct: payload.p_selected_option === payload.p_correct_option,
    confirmed_at: new Date().toISOString(),
  });
  persistence.queueStudyConfirmation(payload, currentPersistenceState());
  if (study.isResolved) persistence.queueFinalization(currentPersistenceState());
  renderStudy();
  try {
    await syncPendingAttempt();
  } catch (error) {
    confirmationRetryAvailable = true;
    showError(elements["study-error"], `Respuesta confirmada localmente. Queda en Cambios pendientes. ${error.message}`);
    renderStudy();
  }
}

async function saveAttemptNow() {
  if (!study || study.attempt.status !== "active") return;
  persistence.queueState(currentPersistenceState());
  const result = await persistence.sync();
  await applyPersistenceResult(result);
  return result;
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
  study = undefined;
  await refreshStatuses();
  if (exitingAttempt.origin === "artificial") {
    await showCatalog();
    return;
  }
  if (exitingAttempt.kind === "failed" && !exitingAttempt.failed_scope_exam_id) {
    await showCatalog();
    return;
  }
  renderCatalog();
  await selectExam(exitingAttempt.failed_scope_exam_id || exitingAttempt.exam_id);
}

async function completeStudy() {
  if (!study.isResolved) return;
  elements["complete-button"].disabled = true;
  try {
    persistence.queueFinalization(currentPersistenceState());
    const result = await persistence.sync();
    await applyPersistenceResult(result);
    await refreshStatuses();
  } catch (error) {
    showError(elements["study-error"], `La finalización queda en Cambios pendientes. ${error.message}`);
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
    persistence.queueFinalization(currentPersistenceState());
    const result = await persistence.sync();
    await applyPersistenceResult(result);
    activeExamAttempt = undefined;
    await refreshStatuses();
  } catch (error) {
    examFinalizing = false;
    const expired = Date.parse(study.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
    study.locked = expired;
    showError(elements["study-error"], `La finalización queda en Cambios pendientes. ${error.message}`);
    renderStudy();
  }
}

function showExamSummary(summary) {
  window.location.hash = `summary=${encodeURIComponent(study.attempt.id)}`;
  elements["summary-title"].textContent = `Resumen · ${study.attempt.origin === "artificial" ? "Examen artificial" : selectedExam?.title || study.attempt.exam_id}`;
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
  elements["summary-title"].textContent = study.attempt.origin === "artificial"
    ? "Resumen · Examen artificial"
    : failed
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
    const pendingStudyId = window.location.hash.match(/^#study=([^&]+)$/)?.[1];
    const pendingExamId = window.location.hash.match(/^#exam-mode=([^&]+)$/)?.[1];
    const pendingFailedScope = window.location.hash.match(/^#failed=([^&]+)$/)?.[1];
    const requestedHistoryId = window.location.hash.match(/^#history=([^&]+)$/)?.[1];
    const artificialMode = window.location.hash.match(/^#artificial-(study|exam)$/)?.[1];
    if (window.location.hash === "#dashboard") {
      await showDashboard();
      return;
    }
    if (requestedHistoryId) {
      history = await loadPersonalHistory(supabase);
      await showHistoryDetail(decodeURIComponent(requestedHistoryId));
      return;
    }
    if (window.location.hash === "#history") {
      await showHistory();
      return;
    }
    if (persistence?.hasPending && pendingFailedScope) {
      const scope = decodeURIComponent(pendingFailedScope);
      const expectedScope = scope === "all" ? null : scope;
      const view = persistence.restore({ kind: "failed" });
      if (view && (view.attempt.failed_scope_exam_id || null) === expectedScope && view.questions?.length) {
        const source = view.questions.find(({ sourceExamId }) => sourceExamId === expectedScope);
        selectedExam = expectedScope ? { id: expectedScope, title: source?.sourceExamTitle || expectedScope } : undefined;
        study = new NormalStudySession({
          id: view.attempt.exam_id,
          version: { id: view.attempt.exam_version_id },
          questions: view.questions,
        }, view.attempt, view.answers);
        activeFailedAttempt = view.attempt;
        applyPendingView(view);
        renderStudy();
        syncPendingAttempt().catch(() => {});
        return;
      }
    }
    if (persistence?.hasPending && artificialMode) {
      const kind = artificialMode === "exam" ? "exam" : "normal";
      const view = persistence.restore({ kind });
      if (view?.attempt.origin === "artificial" && view.questions?.length) {
        const composedExam = {
          id: view.attempt.exam_id,
          version: { id: view.attempt.exam_version_id },
          questions: view.questions,
        };
        study = kind === "exam"
          ? new ExamSession(composedExam, view.attempt, view.answers)
          : new NormalStudySession(composedExam, view.attempt, view.answers);
        selectedExam = undefined;
        applyPendingView(view);
        if (kind === "exam") {
          activeExamAttempt = view.attempt;
          examServerOffsetMs = view.attempt.server_clock_offset_ms || 0;
          study.locked = Date.parse(view.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
        }
        renderStudy();
        syncPendingAttempt().catch(() => {});
        return;
      }
    }
    await ensureCatalog();
    if (persistence?.hasPending && (pendingStudyId || pendingExamId || pendingFailedScope)) {
      if (pendingStudyId || pendingExamId) {
        const examId = decodeURIComponent(pendingStudyId || pendingExamId);
        await selectExam(examId, { updateHash: false });
        const kind = pendingExamId ? "exam" : "normal";
        const view = persistence.restore({ examId, kind });
        if (view) {
          study = kind === "exam"
            ? new ExamSession(selectedExam.package, view.attempt, view.answers)
            : new NormalStudySession(selectedExam.package, view.attempt, view.answers);
          applyPendingView(view);
          if (kind === "exam") {
            activeExamAttempt = view.attempt;
            examServerOffsetMs = view.attempt.server_clock_offset_ms || 0;
            study.locked = Date.parse(view.attempt.deadline_at) <= Date.now() + examServerOffsetMs;
            if (study.locked && !view.pending?.finalize) persistence.queueFinalization(currentPersistenceState());
          } else {
            activeStrategies.set(examId, view.attempt.strategy);
          }
          renderStudy();
          syncPendingAttempt().catch(() => {});
          return;
        }
      }
    }
    try {
      await refreshStatuses();
    } catch (error) {
      if (!persistence?.hasPending) throw error;
    }
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
    if (artificialMode) {
      await startArtificial(artificialMode);
    } else if (examModeId) {
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
  elements["history-button"].hidden = !session;
  elements["dashboard-button"].hidden = !session;
  elements["sync-status"].hidden = !session;
  elements["login-error"].hidden = true;
  if (!session) {
    study = undefined;
    showOnly(elements["login-view"]);
    return;
  }
  ensurePersistence(session);
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
    if (study.attempt.status !== "active") return;
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
    try {
      persistence.queueActiveSecond(currentPersistenceState());
    } catch (error) {
      showError(elements["study-error"], error.message);
      study.attempt.is_paused = true;
      renderStudy();
      return;
    }
    pendingActiveSeconds = persistence.pendingActiveSeconds;
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
  elements["history-button"].addEventListener("click", showHistory);
  elements["dashboard-button"].addEventListener("click", showDashboard);
  elements["dashboard-catalog-button"].addEventListener("click", showCatalog);
  elements["history-catalog-button"].addEventListener("click", showCatalog);
  elements["history-detail-back"].addEventListener("click", showHistory);
  elements["start-study-button"].addEventListener("click", () => startStudy("normal"));
  elements["start-random-study-button"].addEventListener("click", () => startStudy("random"));
  elements["start-exam-button"].addEventListener("click", startExam);
  elements["start-failed-button"].addEventListener("click", () => startFailedStudy(selectedExam?.id));
  elements["all-failed-button"].addEventListener("click", () => startFailedStudy(null));
  elements["artificial-study-button"].addEventListener("click", () => startArtificial("study"));
  elements["artificial-exam-button"].addEventListener("click", () => startArtificial("exam"));
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
