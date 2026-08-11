import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { materializeArtificialSources } from "../app/src/artificial-exam.js";
import { loadPublishedCatalog } from "../app/src/catalog.js";

const bankUrl = new URL("../app/public/data/exams/", import.meta.url);

async function fileFetch(path) {
  try {
    const body = await readFile(new URL(path, bankUrl), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404 };
  }
}

test("Seam 2: materializa 75 referencias únicas solo desde preguntas activas publicadas", async () => {
  const catalog = await loadPublishedCatalog(fileFetch, "./");
  const sources = materializeArtificialSources(catalog, () => 0.25);

  assert.equal(sources.length, 75);
  assert.equal(new Set(sources.map(({ exam_id: examId, source_question_id: questionId }) => `${examId}\0${questionId}`)).size, 75);
  for (const source of sources) {
    const exam = catalog.find(({ id }) => id === source.exam_id);
    const question = exam.package.questions.find(({ id }) => id === source.source_question_id);
    assert.equal(question.active, true);
    assert.equal(source.exam_version_id, exam.version);
    assert.equal(source.exam_version_path, exam.versionPath);
  }
});

test("bloquea claramente el pool menor de 75 sin repetir ni devolver una selección parcial", () => {
  const catalog = [{
    id: "exam-small",
    version: "version-small",
    versionPath: "exam-small/versions/version-small.json",
    questions: Array.from({ length: 74 }, (_, index) => ({ id: `q-${index + 1}`, active: true })),
  }];

  assert.throws(
    () => materializeArtificialSources(catalog),
    /al menos 75 Preguntas activas.*74/i,
  );
});

test("no deduplica registros semánticamente iguales ni IDs canónicos compartidos entre exámenes", () => {
  const catalog = ["exam-a", "exam-b"].map((examId, examIndex) => ({
    id: examId,
    version: `version-${examId}`,
    versionPath: `${examId}/versions/version-${examId}.json`,
    questions: Array.from({ length: examIndex === 0 ? 38 : 37 }, (_, index) => ({
      id: index === 0 ? "shared-q1" : `${examId}-q${index + 1}`,
      text: "El mismo enunciado literal",
      active: true,
    })),
  }));

  const sources = materializeArtificialSources(catalog, () => 0);
  assert.equal(sources.length, 75);
  assert.equal(new Set(sources.map(({ exam_id: examId }) => examId)).size, 2);
  assert.equal(sources.filter(({ source_question_id: id }) => id === "shared-q1").length, 2);
});
