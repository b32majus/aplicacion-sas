import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { loadDashboard, percent, score } from "../app/src/dashboard.js";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const users = [
  "10000000-0000-4000-8000-000000000091",
  "10000000-0000-4000-8000-000000000092",
  "10000000-0000-4000-8000-000000000093",
];
const examId = "exam-dashboard";
const versionId = "version-dashboard";
const versionPath = `${examId}/versions/${versionId}.json`;
const questions = [`${examId}-q001`, `${examId}-q002`];

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
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key
     ) values ($1, $2, $3, 90, $4, $5::jsonb)`,
    [examId, versionId, versionPath, questions, JSON.stringify({ [questions[0]]: "B", [questions[1]]: "B" })],
  );
  await db.query("insert into auth.users(id) values ($1), ($2), ($3)", users);
  return db;
}

async function seedDashboard(db) {
  const attempts = [
    ["20000000-0000-4000-8000-000000000091", users[0], 90, 70_000, "2026-08-11T09:00:00Z"],
    ["20000000-0000-4000-8000-000000000092", users[0], 90, 50_000, "2026-08-11T10:00:00Z"],
    ["20000000-0000-4000-8000-000000000093", users[1], 90, 60_000, "2026-08-11T11:00:00Z"],
    ["20000000-0000-4000-8000-000000000094", users[2], 80, 40_000, "2026-08-11T12:00:00Z"],
  ];
  for (const [id, userId, attemptScore, elapsed, completedAt] of attempts) {
    await db.query(
      `insert into public.attempts(
         id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
         kind, principal, strategy, status, duration_minutes, started_at, deadline_at,
         created_at, completed_at, score, correct_answers, wrong_answers, blank_answers, exam_elapsed_ms
       ) values ($1, $2, $3, $4, $5, $6, 'exam', false, 'exam', 'completed', 90,
         $7::timestamptz - interval '90 minutes', $7, $7, $7, $8, 1, 1, 0, $9)`,
      [id, userId, examId, versionId, versionPath, questions, completedAt, attemptScore, elapsed],
    );
  }
  await db.query(
    `insert into public.attempts(
       id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
       status, created_at, completed_at, active_seconds
     ) values ('20000000-0000-4000-8000-000000000095', $1, $2, $3, $4, $5,
       'completed', '2026-08-11T13:00:00Z', '2026-08-11T13:05:00Z', 125)`,
    [users[0], examId, versionId, versionPath, questions],
  );
  await db.query(
    `insert into public.attempts(
       id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
       kind, principal, strategy, status, duration_minutes, started_at, deadline_at,
       completed_at, score, correct_answers, wrong_answers, blank_answers, exam_elapsed_ms, origin
      ) values ('20000000-0000-4000-8000-000000000096', $1, 'artificial-exam',
        'artificial-version', 'artificial-exam/versions/artificial-version.json', $2,
        'exam', false, 'artificial_exam', 'completed', 120, now() - interval '120 minutes', now(),
        now(), 100, 2, 0, 0, 1000, 'artificial')`,
    [users[2], questions],
  );
  await db.query(
    `insert into public.question_progress(
       user_id, exam_id, question_id, correct_count, wrong_count, current_streak, mastered, pending_failure
     ) values
       ($1, $4, $5, 3, 1, 2, true, false),
       ($2, $4, $5, 1, 2, 0, false, true),
       ($3, $4, $5, 0, 1, 0, false, true),
       ($1, $4, $6, 1, 0, 1, false, false)`,
    [...users, examId, ...questions],
  );
  await db.query(
    `insert into public.attempt_answers(
       id, attempt_id, user_id, question_id, answer_sequence,
       selected_option, correct_option, is_correct
     ) values
       ('30000000-0000-4000-8000-000000000091', '20000000-0000-4000-8000-000000000095', $1, $2, 1, 'B', 'B', true),
       ('30000000-0000-4000-8000-000000000092', '20000000-0000-4000-8000-000000000095', $1, $3, 1, 'A', 'B', false)`,
    [users[0], ...questions],
  );
}

test("Seam 2: Dashboard deriva métricas propias y compara exactamente tres alias controlados", async () => {
  const db = await migratedDatabase();
  try {
    await seedDashboard(db);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[0]]);
    const { rows: [{ get_dashboard: dashboard }] } = await db.query("select public.get_dashboard()");

    assert.deepEqual(dashboard.personal.global, {
      accuracy: 50,
      answer_count: 2,
      average_score: 90,
      best_score: 90,
      dominated_count: 1,
      study_active_seconds: 125,
    });
    const { latest_attempt_at: latestAttemptAt, ...examMetrics } = dashboard.personal.official_exams[0];
    assert.equal(Date.parse(latestAttemptAt), Date.parse("2026-08-11T13:00:00Z"));
    assert.deepEqual(examMetrics, {
      exam_id: examId,
      attempt_count: 3,
      best_score: 90,
      average_score: 90,
      best_time_ms: 50_000,
      accuracy: 80,
      pending_failures: 0,
      dominated_count: 1,
      latest_attempt_status: "completed",
      latest_attempt_score: null,
    });
    assert.deepEqual(dashboard.personal.questions.find(({ question_id: id }) => id === questions[0]), {
      exam_id: examId, question_id: questions[0], attempts: 4,
      correct: 3, wrong: 1, accuracy: 75, mastery: "mastered",
    });
    assert.deepEqual(dashboard.shared.profiles.map(({ alias }) => alias), [
      "Participante 1", "Participante 2", "Participante 3",
    ]);
    assert.deepEqual(
      dashboard.shared.failed_by_all,
      [{ exam_id: examId, question_id: questions[0], failed_profile_count: 3 }],
    );
  } finally {
    await db.close();
  }
});

test("Seam 2: ranking usa el tiempo del mismo mejor intento y no inventa participantes", async () => {
  const db = await migratedDatabase();
  try {
    await seedDashboard(db);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[0]]);
    const { rows: [{ get_dashboard: dashboard }] } = await db.query("select public.get_dashboard()");
    assert.deepEqual(dashboard.shared.official_exam_rankings, [
      { exam_id: examId, alias: "Participante 1", score: 90, exam_elapsed_ms: 50_000, rank: 1 },
      { exam_id: examId, alias: "Participante 2", score: 90, exam_elapsed_ms: 60_000, rank: 2 },
      { exam_id: examId, alias: "Participante 3", score: 80, exam_elapsed_ms: 40_000, rank: 3 },
    ]);
    assert.equal(dashboard.personal.official_exams[0].attempt_count, 3);
    assert.equal(dashboard.personal.official_exams[0].best_score, 90);
    assert.equal(dashboard.personal.official_exams[0].average_score, 90);
    assert.equal(dashboard.shared.official_exam_rankings.some(({ exam_id: id }) => id === "artificial-exam"), false);
    await db.query("delete from public.attempts where user_id = $1 and kind = 'exam'", [users[2]]);
    const { rows: [{ get_dashboard: withoutAttempt }] } = await db.query("select public.get_dashboard()");
    assert.equal(withoutAttempt.shared.official_exam_rankings.some(({ alias }) => alias === "Participante 3"), false);
  } finally {
    await db.close();
  }
});

test("Seam 2: RLS y la RPC niegan detalle ajeno y no exponen IDs ni selecciones", async () => {
  const db = await migratedDatabase();
  try {
    await seedDashboard(db);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[0]]);
    await db.exec("set role authenticated");
    const { rows: attempts } = await db.query("select id from public.attempts where user_id = $1", [users[1]]);
    const { rows: answers } = await db.query("select id from public.attempt_answers where user_id = $1", [users[1]]);
    assert.deepEqual(attempts, []);
    assert.deepEqual(answers, []);
    await assert.rejects(db.query("select * from public.shared_profile_aliases"), /permission denied/i);

    const { rows: [{ get_dashboard: dashboard }] } = await db.query("select public.get_dashboard()");
    const serialized = JSON.stringify(dashboard);
    assert.equal(serialized.includes(users[1]), false);
    assert.equal(serialized.includes("selected_option"), false);
    assert.equal(serialized.includes("attempt_id"), false);
    const { rows: [security] } = await db.query(`select
      has_function_privilege('authenticated', 'public.get_dashboard()', 'execute') as authenticated_execute,
      has_function_privilege('anon', 'public.get_dashboard()', 'execute') as anon_execute,
      (select prosecdef from pg_proc where oid = 'public.get_dashboard()'::regprocedure) as security_definer,
      (select proconfig from pg_proc where oid = 'public.get_dashboard()'::regprocedure) as function_config,
      (select pronargs from pg_proc where oid = 'public.get_dashboard()'::regprocedure) as argument_count`);
    assert.deepEqual(security, {
      authenticated_execute: true,
      anon_execute: false,
      security_definer: true,
      function_config: ["search_path=\"\""],
      argument_count: 0,
    });
  } finally {
    await db.close();
  }
});

test("cliente Dashboard usa una RPC sin parámetros y formatea métricas ausentes", async () => {
  const calls = [];
  const expected = { personal: {}, shared: {} };
  const client = { rpc: async (...args) => { calls.push(args); return { data: expected, error: null }; } };
  assert.equal(await loadDashboard(client), expected);
  assert.deepEqual(calls, [["get_dashboard"]]);
  assert.equal(percent(75.25), "75,3 %");
  assert.equal(score(null), "Sin intentos");
});
