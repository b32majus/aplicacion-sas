import { loadPinnedExam } from "./catalog.js";

export const HISTORY_KIND_LABELS = {
  normal: "Modo estudio",
  failed: "Sesión de falladas",
  exam: "Modo examen",
  artificial: "Examen artificial",
};

export const HISTORY_MODE_LABELS = {
  normal: "Orden normal",
  random: "Orden aleatorio",
  failed: "Solo falladas",
  exam: "Examen oficial",
  artificial_study: "Modo estudio",
  artificial_exam: "Modo examen",
};

export const HISTORY_STATUS_LABELS = {
  completed: "Finalizado",
  abandoned: "Incompleto · abandonado",
  active: "Incompleto · en curso",
};

export function historyDurationSeconds(attempt, now = Date.now()) {
  if (attempt.kind !== "exam") return attempt.active_seconds;
  if (attempt.exam_elapsed_ms != null) return attempt.exam_elapsed_ms / 1000;
  const startedAt = Date.parse(attempt.started_at);
  if (!Number.isFinite(startedAt)) return null;
  const endedAt = attempt.ended_at ? Date.parse(attempt.ended_at) : now;
  const deadlineAt = attempt.deadline_at ? Date.parse(attempt.deadline_at) : endedAt;
  return Math.max(0, (Math.min(endedAt, deadlineAt) - startedAt) / 1000);
}

export async function loadPersonalHistory(client) {
  const { data, error } = await client
    .from("personal_attempt_history")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function loadAnswers(client, attemptId) {
  const { data, error } = await client
    .from("attempt_answers")
    .select("id,question_id,answer_sequence,selected_option,correct_option,is_correct,confirmed_at")
    .eq("attempt_id", attemptId)
    .order("answer_sequence", { ascending: true });
  if (error) throw error;
  return data;
}

export async function loadHistoryReplay(client, fetchImpl, bankBaseUrl, attempt) {
  const answers = await loadAnswers(client, attempt.id);
  if (attempt.kind !== "failed" && attempt.origin !== "artificial") {
    const pinned = await loadPinnedExam(fetchImpl, bankBaseUrl, attempt);
    const questions = attempt.question_ids.map((questionId) => {
      const question = pinned.exam.questions.find(({ id }) => id === questionId);
      if (!question) throw new Error("Una pregunta histórica ya no existe en su versión fijada.");
      return question;
    });
    return { attempt, answers, questions, title: pinned.exam.title };
  }

  const { data: sources, error } = await client
    .from("attempt_question_sources")
    .select("position,exam_id,exam_version_id,exam_version_path,question_id")
    .eq("attempt_id", attempt.id)
    .order("position", { ascending: true });
  if (error) throw error;
  if (sources.length !== attempt.question_ids.length) {
    throw new Error("La composición histórica del intento no es válida.");
  }

  const packages = new Map();
  for (const source of sources) {
    const key = `${source.exam_id}\u0000${source.exam_version_id}\u0000${source.exam_version_path}`;
    if (!packages.has(key)) {
      packages.set(key, await loadPinnedExam(fetchImpl, bankBaseUrl, source));
    }
  }
  const questions = sources.map((source) => {
    const key = `${source.exam_id}\u0000${source.exam_version_id}\u0000${source.exam_version_path}`;
    const pinned = packages.get(key);
    const question = pinned.exam.questions.find(({ id }) => id === source.question_id);
    if (!question) throw new Error("Una pregunta histórica ya no existe en su versión fijada.");
    return {
      ...question,
      sourceExamId: source.exam_id,
      sourceExamTitle: pinned.exam.title,
      sourceVersionId: source.exam_version_id,
      sourceVersionPath: source.exam_version_path,
    };
  });
  return {
    attempt,
    answers,
    questions,
    title: attempt.origin === "artificial"
      ? "Examen artificial"
      : attempt.failed_scope_exam_id ? packages.values().next().value.exam.title : "Todas mis falladas",
  };
}
