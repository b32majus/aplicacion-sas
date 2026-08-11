import { shuffled } from "./quiz-core.js";

export const ARTIFICIAL_QUESTION_COUNT = 75;

export function materializeArtificialSources(catalog, random = Math.random) {
  const pool = catalog.flatMap((exam) => exam.questions.map((question) => ({
    exam_id: exam.id,
    exam_version_id: exam.version,
    exam_version_path: exam.versionPath,
    source_question_id: question.id,
  })));

  if (pool.length < ARTIFICIAL_QUESTION_COUNT) {
    throw new Error(
      `Se necesitan al menos 75 Preguntas activas publicadas; el Banco actual solo contiene ${pool.length}.`,
    );
  }
  return shuffled(pool, random).slice(0, ARTIFICIAL_QUESTION_COUNT);
}
