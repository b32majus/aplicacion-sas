import test from "node:test";
import assert from "node:assert/strict";
import { QuizSession, shuffled } from "../app/src/quiz-core.js";
import { readFile } from "node:fs/promises";

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

test("consume un paquete real del importador usando solo su conjunto activo", async () => {
  const bankUrl = new URL("../app/public/data/exams/", import.meta.url);
  const catalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
  const entry = catalog.exams.find(({ id }) => id === "sas-administrativo-2021-turno-libre");
  assert.ok(entry, "el catálogo debe exponer el examen real generado de 2021");
  const exam = JSON.parse(await readFile(new URL(entry.latestPath, bankUrl), "utf8"));
  const session = new QuizSession(exam);
  assert.equal(exam.source.pdf, "Examen_ADM_L_2021.pdf");
  assert.equal(session.progress.total, exam.scorableSet.count);
  assert.equal(session.questions.every(({ active }) => active), true);
  assert.equal(session.questions.some(({ status }) => status === "annulled"), false);
  assert.equal(session.questions.filter(({ status }) => status === "reserve").length, 3);
});

test("consume el examen 2023 sin incluir anuladas ni reservas no usadas", async () => {
  const exam = JSON.parse(await readFile(
    new URL("../app/public/data/exams/sas-administrativo-2023-turno-libre.json", import.meta.url),
    "utf8",
  ));
  const session = new QuizSession(exam);
  assert.equal(exam.qa.state, "publicable");
  assert.equal(exam.questions.some(({ active }) => !active), true);
  assert.equal(session.questions.length, exam.scorableSet.count);
  assert.equal(session.questions.every(({ active }) => active), true);
});
