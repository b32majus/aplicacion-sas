import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const users = [
  "10000000-0000-4000-8000-0000000000a1",
  "10000000-0000-4000-8000-0000000000a2",
  "10000000-0000-4000-8000-0000000000a3",
];
const examId = "sas-administrativo-2026-turno-libre";
const versionId = "version-third-publication";
const versionPath = `${examId}/versions/${versionId}.json`;
const questionIds = Array.from({ length: 75 }, (_, index) => (
  `${examId}-q${String(index + 1).padStart(3, "0")}`
));
const answerKey = Object.fromEntries(questionIds.map((id) => [id, "B"]));

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
  await db.query("insert into auth.users(id) values ($1), ($2), ($3)", users);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[0]]);
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes,
       question_ids, answer_key, is_published
     ) values ($1, $2, $3, 120, $4, $5::jsonb, true)`,
    [examId, versionId, versionPath, questionIds, JSON.stringify(answerKey)],
  );
  return db;
}

test("un tercer registro oficial atraviesa inicio, scoring, artificial y dashboard sin exponer la clave", async () => {
  const db = await migratedDatabase();
  try {
    const { rows: registry } = await db.query("select * from public.get_published_official_exam_versions()");
    const third = registry.find((row) => row.exam_id === examId);
    assert.deepEqual(third, {
      exam_id: examId,
      exam_version_id: versionId,
      exam_version_path: versionPath,
    });
    assert.equal(Object.hasOwn(third, "answer_key"), false);
    const { rows: [{ table_access: tableAccess }] } = await db.query(
      "select has_table_privilege('authenticated', 'public.official_exam_versions', 'select') as table_access",
    );
    assert.equal(tableAccess, false);

    await assert.rejects(
      db.query(
        "select public.start_or_resume_exam_attempt($1, $2, $3, $4, 120)",
        [examId, versionId, `${examId}/versions/wrong.json`, questionIds],
      ),
      /versión oficial publicable/i,
    );
    const { rows: [{ start_or_resume_exam_attempt: attempt }] } = await db.query(
      "select public.start_or_resume_exam_attempt($1, $2, $3, $4, 120)",
      [examId, versionId, versionPath, questionIds],
    );
    await db.query(
      "select public.save_exam_answer($1, $2, $3, 'A', 0)",
      ["20000000-0000-4000-8000-0000000000a1", attempt.id, questionIds[0]],
    );
    const { rows: [{ finish_exam_attempt: result }] } = await db.query(
      "select public.finish_exam_attempt($1)",
      [attempt.id],
    );
    assert.deepEqual(
      { correct: result.correct, wrong: result.wrong, blank: result.blank },
      { correct: 0, wrong: 1, blank: 74 },
    );
    const { rows: [graded] } = await db.query(
      `select selected_option, correct_option, is_correct
       from public.attempt_answers
       where attempt_id = $1 and question_id = $2 and correct_option is not null`,
      [attempt.id, questionIds[0]],
    );
    assert.deepEqual(graded, { selected_option: "A", correct_option: "B", is_correct: false });

    const sources = questionIds.map((questionId) => ({
      exam_id: examId,
      exam_version_id: versionId,
      exam_version_path: versionPath,
      source_question_id: questionId,
    }));
    const { rows: [{ start_or_resume_artificial_attempt: artificial }] } = await db.query(
      "select public.start_or_resume_artificial_attempt('study', $1::jsonb)",
      [JSON.stringify(sources)],
    );
    assert.equal(artificial.origin, "artificial");
    assert.equal(artificial.question_ids.length, 75);

    const { rows: [{ get_dashboard: dashboard }] } = await db.query("select public.get_dashboard()");
    const metrics = dashboard.personal.official_exams.find((item) => item.exam_id === examId);
    assert.equal(metrics.attempt_count, 1);
    assert.equal(metrics.latest_attempt_status, "completed");
    const ranking = dashboard.shared.official_exam_rankings.find((item) => item.exam_id === examId);
    assert.equal(ranking.alias, "Participante 1");
    assert.equal(ranking.rank, 1);
  } finally {
    await db.close();
  }
});
