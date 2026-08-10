import test from "node:test";
import assert from "node:assert/strict";
import { formatActiveTime, NormalStudySession } from "../app/src/study-session.js";

const questions = [1, 2, 3].map((number) => ({
  id: `exam-q${number}`,
  sourceNumber: number,
  text: `Pregunta ${number}`,
  active: true,
  correctOption: "B",
  options: ["A", "B", "C"].map((id) => ({ id, text: id })),
}));
const exam = { id: "exam", version: { id: "version-1" }, questions };
const attempt = {
  id: "attempt-1",
  exam_id: "exam",
  exam_version_id: "version-1",
  exam_version_path: "exam/versions/version-1.json",
  question_ids: questions.map(({ id }) => id),
  current_position: 0,
  active_seconds: 0,
  is_paused: false,
  status: "active",
};

function answer(id, questionId, sequence, selectedOption) {
  return {
    id,
    question_id: questionId,
    answer_sequence: sequence,
    selected_option: selectedOption,
    correct_option: "B",
    is_correct: selectedOption === "B",
    confirmed_at: `2026-08-10T00:00:0${sequence}Z`,
  };
}

test("fija versión, identidad y orden oficial del intento", () => {
  const session = new NormalStudySession(exam, attempt);
  assert.deepEqual(session.questions.map(({ id }) => id), attempt.question_ids);
  assert.throws(
    () => new NormalStudySession(exam, { ...attempt, exam_version_id: "otra" }),
    /versión fijada/,
  );
  assert.throws(
    () => new NormalStudySession(exam, { ...attempt, question_ids: ["exam-q1", "ausente"] }),
    /orden de preguntas/,
  );
});

test("la selección provisional cambia sin resultado hasta confirmar", () => {
  const session = new NormalStudySession(exam, attempt);
  session.select("A");
  session.select("B");
  assert.equal(session.selectedOption, "B");
  assert.equal(session.stateFor("exam-q1"), "pending");
  session.applyConfirmation(answer("confirmation-1", "exam-q1", 1, "B"));
  assert.equal(session.stateFor("exam-q1"), "correct");
  assert.throws(() => session.select("A"), /corregida/);
});

test("confirmaciones repetidas son idempotentes en la sesión local", () => {
  const session = new NormalStudySession(exam, attempt);
  const confirmation = answer("same-id", "exam-q1", 1, "A");
  session.applyConfirmation(confirmation);
  session.applyConfirmation(confirmation);
  assert.equal(session.answers.length, 1);
  assert.equal(session.stateFor("exam-q1"), "incorrect");
  assert.throws(() => session.select("B"), /corregida/);
});

test("salta y recorre solo preguntas sin respuesta confirmada", () => {
  const session = new NormalStudySession(exam, attempt, [answer("wrong", "exam-q1", 1, "A")]);
  assert.deepEqual(session.pendingIds, ["exam-q2", "exam-q3"]);
  assert.equal(session.nextPending().id, "exam-q2");
  assert.equal(session.nextPending().id, "exam-q3");
  session.applyConfirmation(answer("correct-2", "exam-q2", 1, "B"));
  session.applyConfirmation(answer("correct-3", "exam-q3", 1, "B"));
  assert.equal(session.nextPending(), null);
  assert.equal(session.isResolved, true);
});

test("formatea únicamente tiempo activo acumulado", () => {
  assert.equal(formatActiveTime(9), "9 s");
  assert.equal(formatActiveTime(65), "1 min 05 s");
  assert.equal(formatActiveTime(3660), "1 h 01 min");
});
