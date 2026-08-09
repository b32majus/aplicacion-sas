import test from "node:test";
import assert from "node:assert/strict";
import { QuizSession, shuffled } from "../app/src/quiz-core.js";

const question = (id, correctOption = "A", status = "valid") => ({
  id,
  number: Number(id.slice(1)),
  text: `Pregunta ${id}`,
  status,
  correctOption,
  options: ["A", "B", "C"].map((option) => ({ id: option, text: option })),
});

test("mantiene el orden en modo secuencial y una sola pregunta activa", () => {
  const session = new QuizSession([question("q1"), question("q2")]);
  assert.equal(session.currentQuestion.id, "q1");
  assert.deepEqual(session.progress, { current: 1, total: 2 });
  assert.throws(() => session.next(), /Responde/);
  session.answerCurrent("A");
  assert.equal(session.next().id, "q2");
});

test("baraja sin perder ni repetir preguntas", () => {
  const items = [question("q1"), question("q2"), question("q3")];
  const result = shuffled(items, () => 0);
  assert.deepEqual(result.map(({ id }) => id), ["q2", "q3", "q1"]);
  assert.equal(new Set(result.map(({ id }) => id)).size, items.length);
});

test("corrige inmediatamente, cuenta y bloquea una segunda respuesta", () => {
  const session = new QuizSession([question("q1", "B"), question("q2")]);
  assert.deepEqual(session.answerCurrent("A"), {
    optionId: "A", correctOption: "B", isCorrect: false, scores: true,
  });
  assert.equal(session.incorrectCount, 1);
  assert.deepEqual(session.failedIds, ["q1"]);
  assert.throws(() => session.answerCurrent("B"), /ya está corregida/);
  session.next();
  session.answerCurrent("A");
  assert.equal(session.correctCount, 1);
});

test("las anuladas no puntúan y las reservas se practican normalmente", () => {
  const session = new QuizSession([
    question("q1", "A", "annulled"),
    question("q2", "B", "reserve"),
  ]);
  assert.equal(session.answerCurrent("B").scores, false);
  assert.deepEqual([session.correctCount, session.incorrectCount], [0, 0]);
  session.next();
  session.answerCurrent("A");
  assert.deepEqual([session.correctCount, session.incorrectCount], [0, 1]);
});

test("finaliza y construye un nuevo conjunto solo con las falladas", () => {
  const questions = [question("q1"), question("q2", "B")];
  const session = new QuizSession(questions);
  session.answerCurrent("B");
  session.next();
  session.answerCurrent("B");
  assert.equal(session.next(), null);
  assert.equal(session.finished, true);
  assert.deepEqual(session.failedQuestions(questions).map(({ id }) => id), ["q1"]);
  const retry = new QuizSession(session.failedQuestions(questions));
  assert.equal(retry.currentQuestion.id, "q1");
});
