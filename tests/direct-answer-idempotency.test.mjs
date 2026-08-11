import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000021";

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

async function register(db, examId, questionIds) {
  const versionId = `${examId}-version`;
  const versionPath = `${examId}/versions/${versionId}.json`;
  const answerKey = Object.fromEntries(questionIds.map((id) => [id, "B"]));
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes,
       question_ids, answer_key, is_published
     ) values ($1, $2, $3, 90, $4, $5::jsonb, true)`,
    [examId, versionId, versionPath, questionIds, JSON.stringify(answerKey)],
  );
  return { examId, versionId, versionPath, questionIds };
}

test("concurrent exact UUID replay converges for every direct answer RPC", async () => {
  const db = await migratedDatabase();
  try {
    const principalPackage = await register(db, "replay-principal", ["replay-principal-q001"]);
    const { rows: [principal] } = await db.query(
      `select (public.start_or_replace_principal_attempt(
         $1, $2, $3, $4, 'normal', false
       )).*`,
      [
        principalPackage.examId,
        principalPackage.versionId,
        principalPackage.versionPath,
        principalPackage.questionIds,
      ],
    );
    const principalId = "20000000-0000-4000-8000-000000000021";
    await Promise.all(Array.from({ length: 4 }, () => db.query(
      "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
      [principalId, principal.id, principalPackage.questionIds[0]],
    )));
    await db.query("select public.complete_normal_attempt($1)", [principal.id]);
    await db.query(
      "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
      [principalId, principal.id, principalPackage.questionIds[0]],
    );
    await assert.rejects(
      db.query(
        "select public.confirm_normal_answer($1, $2, $3, 'A', 'B')",
        [principalId, principal.id, principalPackage.questionIds[0]],
      ),
      /otro resultado/i,
    );

    await db.query(
      `update public.question_progress
       set pending_failure = true, mastered = false
       where user_id = $1 and exam_id = $2 and question_id = $3`,
      [userId, principalPackage.examId, principalPackage.questionIds[0]],
    );
    const sources = JSON.stringify([{
      exam_id: principalPackage.examId,
      exam_version_id: principalPackage.versionId,
      exam_version_path: principalPackage.versionPath,
      question_id: principalPackage.questionIds[0],
    }]);
    const { rows: [failed] } = await db.query(
      "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
      [principalPackage.examId, sources],
    );
    const failedId = "20000000-0000-4000-8000-000000000022";
    await Promise.all(Array.from({ length: 4 }, () => db.query(
      "select public.confirm_failed_answer($1, $2, $3, 'B', 'B')",
      [failedId, failed.id, principalPackage.questionIds[0]],
    )));

    const artificialQuestionIds = Array.from({ length: 75 }, (_, index) => `replay-source-q${index + 1}`);
    const artificialPackage = await register(db, "replay-source", artificialQuestionIds);
    const artificialSources = artificialQuestionIds.map((questionId) => ({
      exam_id: artificialPackage.examId,
      exam_version_id: artificialPackage.versionId,
      exam_version_path: artificialPackage.versionPath,
      source_question_id: questionId,
    }));
    const { rows: [{ start_or_resume_artificial_attempt: artificial }] } = await db.query(
      "select public.start_or_resume_artificial_attempt('study', $1::jsonb)",
      [JSON.stringify(artificialSources)],
    );
    const artificialId = "20000000-0000-4000-8000-000000000023";
    await Promise.all(Array.from({ length: 4 }, () => db.query(
      "select public.confirm_normal_answer($1, $2, 'artificial-q001', 'B', 'B')",
      [artificialId, artificial.id],
    )));

    const examPackage = await register(db, "replay-exam", ["replay-exam-q001"]);
    const { rows: [{ start_or_resume_exam_attempt: exam }] } = await db.query(
      "select public.start_or_resume_exam_attempt($1, $2, $3, $4, 90)",
      [examPackage.examId, examPackage.versionId, examPackage.versionPath, examPackage.questionIds],
    );
    const draftId = "20000000-0000-4000-8000-000000000024";
    await Promise.all(Array.from({ length: 4 }, () => db.query(
      "select public.save_exam_answer($1, $2, $3, 'B', 0)",
      [draftId, exam.id, examPackage.questionIds[0]],
    )));
    await db.query("select public.finish_exam_attempt($1)", [exam.id]);
    await db.query(
      "select public.save_exam_answer($1, $2, $3, 'B', 0)",
      [draftId, exam.id, examPackage.questionIds[0]],
    );

    const { rows: counts } = await db.query(
      `select attempt_id, count(*)::integer as answer_count
       from public.attempt_answers
       where id in ($1, $2, $3, $4)
       group by attempt_id
       order by attempt_id`,
      [principalId, failedId, artificialId, draftId],
    );
    assert.equal(counts.length, 4);
    assert.equal(counts.every(({ answer_count: count }) => count === 1), true);
  } finally {
    await db.close();
  }
});
