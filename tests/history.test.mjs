import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { historyDurationSeconds, loadHistoryReplay } from "../app/src/history.js";
import { loadPublishedCatalog } from "../app/src/catalog.js";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userA = "10000000-0000-4000-8000-000000000080";
const userB = "10000000-0000-4000-8000-000000000081";

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
  for (const migration of migrations) {
    await db.exec(await readFile(new URL(migration, migrationsUrl), "utf8"));
  }
  await db.query("insert into auth.users(id) values ($1), ($2)", [userA, userB]);
  return db;
}

test("Seam 2: Historial muestra solo intentos propios finalizados e incompletos con sus métricas", async () => {
  const db = await migratedDatabase();
  try {
    await db.query(
      `insert into public.attempts(
         id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
         status, active_seconds, completed_at, abandoned_at
       ) values
         ('20000000-0000-4000-8000-000000000080', $1, 'exam-a', 'version-a',
          'exam-a/versions/version-a.json', array['exam-a-q001'], 'completed', 75, now(), null),
         ('20000000-0000-4000-8000-000000000081', $1, 'exam-a', 'version-a',
          'exam-a/versions/version-a.json', array['exam-a-q001'], 'abandoned', 20, null, now()),
         ('20000000-0000-4000-8000-000000000082', $2, 'exam-other', 'version-x',
          'exam-other/versions/version-x.json', array['exam-other-q001'], 'completed', 999, now(), null)`,
      [userA, userB],
    );
    await db.query(
      `insert into public.attempt_answers(
         id, attempt_id, user_id, question_id, answer_sequence,
         selected_option, correct_option, is_correct
       ) values (
          '30000000-0000-4000-8000-000000000080',
          '20000000-0000-4000-8000-000000000080', $1,
          'exam-a-q001', 1, 'B', 'B', true
       ), (
          '30000000-0000-4000-8000-000000000081',
          '20000000-0000-4000-8000-000000000082', $2,
          'exam-other-q001', 1, 'A', 'B', false
       )`,
      [userA, userB],
    );
    await db.query(
      `insert into public.attempt_question_sources(
         attempt_id, user_id, position, exam_id, exam_version_id, exam_version_path, question_id
       ) values (
         '20000000-0000-4000-8000-000000000082', $1, 0, 'exam-other', 'version-x',
         'exam-other/versions/version-x.json', 'exam-other-q001'
       )`,
      [userB],
    );

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userA]);
    await db.exec("set role authenticated");
    const { rows } = await db.query(
      "select exam_id, status, active_seconds, correct_answers, answered_questions from public.personal_attempt_history order by status",
    );
    assert.deepEqual(rows, [
      { exam_id: "exam-a", status: "abandoned", active_seconds: 20, correct_answers: 0, answered_questions: 0 },
      { exam_id: "exam-a", status: "completed", active_seconds: 75, correct_answers: 1, answered_questions: 1 },
    ]);
    const { rows: [privileges] } = await db.query(`select
      has_table_privilege('authenticated', 'public.personal_attempt_history', 'select') as can_select,
      has_table_privilege('authenticated', 'public.personal_attempt_history', 'update') as can_update,
      has_table_privilege('authenticated', 'public.attempts', 'delete') as can_delete`);
    assert.deepEqual(privileges, { can_select: true, can_update: false, can_delete: false });
    const { rows: hiddenAnswers } = await db.query(
      "select id from public.attempt_answers where attempt_id = '20000000-0000-4000-8000-000000000082'",
    );
    const { rows: hiddenSources } = await db.query(
      "select question_id from public.attempt_question_sources where attempt_id = '20000000-0000-4000-8000-000000000082'",
    );
    assert.deepEqual(hiddenAnswers, []);
    assert.deepEqual(hiddenSources, []);
  } finally {
    await db.close();
  }
});

test("un examen activo deriva su tiempo de examen sin mezclar tiempo activo de estudio", () => {
  const now = Date.parse("2026-08-11T10:02:00Z");
  assert.equal(historyDurationSeconds({
    kind: "exam",
    exam_elapsed_ms: null,
    started_at: "2026-08-11T10:00:00Z",
    deadline_at: "2026-08-11T13:00:00Z",
    ended_at: null,
    active_seconds: 999,
  }, now), 120);
  assert.equal(historyDurationSeconds({ kind: "normal", active_seconds: 45 }, now), 45);
});

test("la identidad de question_progress y el hito Finalizado sobreviven a versiones e intentos posteriores", async () => {
  const db = await migratedDatabase();
  try {
    await db.query(
      `insert into public.attempts(
         user_id, exam_id, exam_version_id, exam_version_path, question_ids,
         status, completed_at, abandoned_at
       ) values
         ($1, 'exam-a', 'version-a', 'exam-a/versions/version-a.json', array['exam-a-q001'], 'completed', now(), null),
         ($1, 'exam-a', 'version-b', 'exam-a/versions/version-b.json', array['exam-a-q001'], 'abandoned', null, now())`,
      [userA],
    );
    await db.query(
      `insert into public.question_progress(user_id, exam_id, question_id, correct_count)
       values ($1, 'exam-a', 'exam-a-q001', 2)`,
      [userA],
    );
    const { rows: [result] } = await db.query(
      `select
         (select count(*) from public.question_progress
          where user_id = $1 and exam_id = 'exam-a' and question_id = 'exam-a-q001') as progress_rows,
         exists(select 1 from public.attempts
                where user_id = $1 and exam_id = 'exam-a' and status = 'completed') as finalized`,
      [userA],
    );
    assert.deepEqual(result, { progress_rows: 1, finalized: true });
  } finally {
    await db.close();
  }
});

function examPackage(version, text) {
  return {
    id: "exam-a",
    title: `Examen ${version}`,
    durationMinutes: 90,
    version: { id: version },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 1, questionNumbers: [1] },
    questions: [{
      id: "exam-a-q001",
      sourceNumber: 1,
      active: true,
      text,
      options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }],
      correctOption: "B",
    }],
  };
}

test("Seam 2: tras cambiar el catálogo a B, Historial reproduce A sin escribir ni mutar respuestas", async () => {
  const packageA = examPackage("version-a", "Texto histórico A");
  const packageB = examPackage("version-b", "Texto actual B");
  const requested = [];
  const fetchImpl = async (path) => {
    requested.push(path);
    const body = path.endsWith("catalog.json")
      ? { exams: [{ id: "exam-a", title: "Examen B", latestVersion: "version-b", latestPath: "exam-a/versions/version-b.json" }] }
      : path.endsWith("version-a.json") ? packageA : packageB;
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  const answers = [{
    id: "answer-a",
    question_id: "exam-a-q001",
    answer_sequence: 1,
    selected_option: "A",
    correct_option: "B",
    is_correct: false,
    confirmed_at: "2026-08-11T10:00:00Z",
  }];
  const originalAnswers = structuredClone(answers);
  const reads = [];
  const client = {
    from(table) {
      reads.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order: async () => ({ data: structuredClone(answers), error: null }),
      };
      return builder;
    },
  };

  const current = await loadPublishedCatalog(fetchImpl, "/bank/");
  const replay = await loadHistoryReplay(client, fetchImpl, "/bank/", {
    id: "attempt-a",
    exam_id: "exam-a",
    exam_version_id: "version-a",
    exam_version_path: "exam-a/versions/version-a.json",
    question_ids: ["exam-a-q001"],
    kind: "exam",
  });

  assert.equal(current[0].version, "version-b");
  assert.equal(replay.questions[0].text, "Texto histórico A");
  assert.deepEqual(answers, originalAnswers);
  assert.deepEqual(reads, ["attempt_answers"]);
  assert.equal(requested.some((path) => path.endsWith("version-a.json")), true);
});
