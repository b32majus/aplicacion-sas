import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000014";

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  const migrations = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) await db.exec(await readFile(new URL(migration, migrationsUrl), "utf8"));
  await db.query("insert into auth.users(id) values ($1)", [userId]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  return db;
}

function packageData(examId, count, start = 1) {
  const questionIds = Array.from({ length: count }, (_, index) => `${examId}-q${start + index}`);
  return {
    examId,
    versionId: `${examId}-version`,
    versionPath: `${examId}/versions/${examId}-version.json`,
    questionIds,
    answerKey: Object.fromEntries(questionIds.map((id) => [id, "B"])),
  };
}

async function registerPackage(db, source) {
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key
     ) values ($1, $2, $3, 180, $4, $5::jsonb)`,
    [source.examId, source.versionId, source.versionPath, source.questionIds, JSON.stringify(source.answerKey)],
  );
}

function sourceRows(packages) {
  return packages.flatMap((source) => source.questionIds.map((questionId) => ({
    exam_id: source.examId,
    exam_version_id: source.versionId,
    exam_version_path: source.versionPath,
    question_id: questionId,
  })));
}

async function startArtificial(db, mode, sources) {
  const { rows: [{ start_or_resume_artificial_attempt: attempt }] } = await db.query(
    "select public.start_or_resume_artificial_attempt($1, $2::jsonb)",
    [mode, JSON.stringify(sources)],
  );
  return attempt;
}

test("Seam 2: bloquea pools parciales y referencias anuladas, de reserva no usada o no publicadas", async () => {
  const db = await migratedDatabase();
  try {
    const published = packageData("published", 75);
    const unpublished = packageData("unpublished", 1);
    await registerPackage(db, published);
    await registerPackage(db, unpublished);
    await db.query(
      "update public.official_exam_versions set is_published = false where exam_id = $1",
      [unpublished.examId],
    );

    await assert.rejects(startArtificial(db, "study", sourceRows([published]).slice(0, 74)), /exactamente 75/i);
    const invalid = sourceRows([published]);
    invalid[0] = sourceRows([unpublished])[0];
    await assert.rejects(startArtificial(db, "study", invalid), /Preguntas activas.*actualmente publicad/i);
    invalid[0] = { ...invalid[1], question_id: "published-reserva-no-usada" };
    await assert.rejects(startArtificial(db, "study", invalid), /Preguntas activas.*actualmente publicad/i);

    const { rows: [{ count }] } = await db.query(
      "select count(*)::integer as count from public.attempts where user_id = $1 and origin = 'artificial'",
      [userId],
    );
    assert.equal(count, 0);
  } finally {
    await db.close();
  }
});

test("Seam 2: estudio y examen reutilizan motores, fijan 75 orígenes y aplican progreso una sola vez", async () => {
  const db = await migratedDatabase();
  try {
    const packages = [packageData("exam-a", 40), packageData("exam-b", 40)];
    for (const source of packages) await registerPackage(db, source);
    const sources = sourceRows(packages).slice(0, 75);
    const questionIds = sources.map(({ question_id: questionId }) => questionId);

    const study = await startArtificial(db, "study", sources);
    assert.equal(study.kind, "normal");
    assert.equal(study.origin, "artificial");
    assert.equal(study.strategy, "artificial_study");
    assert.equal(study.duration_minutes, null);
    assert.equal(study.question_ids.length, 75);

    const { rows: materialized } = await db.query(
      `select position, exam_id, exam_version_id, exam_version_path, question_id
       from public.attempt_question_sources where attempt_id = $1 order by position`,
      [study.id],
    );
    assert.deepEqual(materialized, sources.map((source, position) => ({ position, ...source })));

    for (let index = 0; index < questionIds.length; index += 1) {
      const confirmationId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      await db.query(
        "select public.confirm_normal_answer($1, $2, $3, $4, 'B')",
        [confirmationId, study.id, questionIds[index], index === 1 ? "A" : "B"],
      );
      if (index === 0) {
        await db.query(
          "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
          [confirmationId, study.id, questionIds[index]],
        );
      }
    }
    const { rows: [{ complete_normal_attempt: studySummary }] } = await db.query(
      "select public.complete_normal_attempt($1)",
      [study.id],
    );
    assert.deepEqual({ correct: studySummary.correct, wrong: studySummary.wrong }, { correct: 74, wrong: 1 });

    const { rows: [principal] } = await db.query(
      `select (public.start_or_replace_principal_attempt(
        $1, $2, $3, $4, 'normal', false
      )).*`,
      [packages[0].examId, packages[0].versionId, packages[0].versionPath, [questionIds[2]]],
    );
    const { rows: [failed] } = await db.query(
      "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
      [packages[0].examId, JSON.stringify([sources[1]])],
    );

    const timed = await startArtificial(db, "exam", sources);
    assert.equal(timed.kind, "exam");
    assert.equal(timed.origin, "artificial");
    assert.equal(timed.strategy, "artificial_exam");
    assert.equal(timed.duration_minutes, 120);
    assert.equal(Date.parse(timed.deadline_at) - Date.parse(timed.started_at), 120 * 60_000);
    const { rows: [{ start_or_resume_exam_attempt: globallyResumed }] } = await db.query(
      "select public.start_or_resume_exam_attempt('other', 'other', 'other.json', array['other-q1'], 90)",
    );
    assert.equal(globallyResumed.id, timed.id);
    await assert.rejects(
      db.query(
        "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
        ["21000000-0000-4000-8000-000000000001", principal.id, questionIds[2]],
      ),
      /Modo examen activo/,
    );
    await assert.rejects(
      db.query(
        "select public.confirm_failed_answer($1, $2, $3, 'B', 'B')",
        ["21000000-0000-4000-8000-000000000002", failed.id, questionIds[1]],
      ),
      /Modo examen activo/,
    );
    await db.query(
      "select public.save_exam_answer($1, $2, $3, 'B', 0)",
      ["30000000-0000-4000-8000-000000000001", timed.id, questionIds[0]],
    );
    const { rows: [{ finish_exam_attempt: examSummary }] } = await db.query(
      "select public.finish_exam_attempt($1)",
      [timed.id],
    );
    assert.deepEqual(
      { correct: examSummary.correct, wrong: examSummary.wrong, blank: examSummary.blank, score: examSummary.score },
      { correct: 1, wrong: 0, blank: 74, score: 1.33 },
    );
    const { rows: [{ finish_exam_attempt: repeated }] } = await db.query(
      "select public.finish_exam_attempt($1)",
      [timed.id],
    );
    assert.deepEqual(repeated, examSummary);

    const { rows: progress } = await db.query(
      `select exam_id, question_id, correct_count, wrong_count, current_streak, mastered, pending_failure
       from public.question_progress where user_id = $1 and question_id = any($2)
       order by question_id limit 2`,
      [userId, [questionIds[0], questionIds[1]]],
    );
    assert.deepEqual(progress, [
      {
        exam_id: "exam-a", question_id: questionIds[0], correct_count: 2, wrong_count: 0,
        current_streak: 2, mastered: false, pending_failure: false,
      },
      {
        exam_id: "exam-a", question_id: questionIds[1], correct_count: 0, wrong_count: 2,
        current_streak: 0, mastered: false, pending_failure: true,
      },
    ]);
    const { rows: [{ official_completed: officialCompleted }] } = await db.query(
      `select count(*)::integer as official_completed from public.attempts attempt
       join public.official_exam_versions official on official.exam_id = attempt.exam_id
       where attempt.user_id = $1 and attempt.status = 'completed' and attempt.kind = 'exam'`,
      [userId],
    );
    assert.equal(officialCompleted, 0);
  } finally {
    await db.close();
  }
});
