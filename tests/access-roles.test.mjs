import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const accessRolesMigration = "20260811113000_access_roles.sql";
const participants = [
  "10000000-0000-4000-8000-000000000101",
  "10000000-0000-4000-8000-000000000102",
  "10000000-0000-4000-8000-000000000103",
];
const testUser = "10000000-0000-4000-8000-000000000104";
const adminUser = "10000000-0000-4000-8000-000000000105";

async function migrationNames() {
  return (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
}

async function database() {
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
  return db;
}

async function applyMigrations(db, names) {
  for (const name of names) {
    await db.exec(await readFile(new URL(name, migrationsUrl), "utf8"));
  }
}

async function migratedDatabase() {
  const db = await database();
  await applyMigrations(db, await migrationNames());
  return db;
}

async function insertAuthUser(db, userId) {
  await db.query("insert into auth.users(id) values ($1)", [userId]);
}

async function aliases(db) {
  const { rows } = await db.query(
    "select user_id, alias from public.shared_profile_aliases order by alias",
  );
  return rows;
}

test("access roles reserve the three shared aliases for participants", async () => {
  const db = await migratedDatabase();
  try {
    for (const userId of participants) await insertAuthUser(db, userId);

    assert.deepEqual((await aliases(db)).map(({ alias }) => alias), [
      "Participante 1",
      "Participante 2",
      "Participante 3",
    ]);
    await assert.rejects(
      insertAuthUser(db, "10000000-0000-4000-8000-000000000106"),
      /exactamente tres perfiles/,
    );
  } finally {
    await db.close();
  }
});

test("test and admin profiles can be created without aliases after all slots are full", async () => {
  const db = await migratedDatabase();
  try {
    for (const [userId, role] of [[testUser, "test"], [adminUser, "admin"]]) {
      await insertAuthUser(db, userId);
      await db.query("insert into public.app_access_roles(user_id, role) values ($1, $2)", [userId, role]);
      await db.query("delete from public.profiles where id = $1", [userId]);
    }
    for (const userId of participants) await insertAuthUser(db, userId);

    await db.query("insert into public.profiles(id) values ($1), ($2)", [testUser, adminUser]);

    assert.equal((await aliases(db)).length, 3);
    assert.deepEqual(
      (await db.query("select id from public.profiles where id in ($1, $2) order by id", [testUser, adminUser])).rows,
      [{ id: testUser }, { id: adminUser }],
    );
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.app_access_roles"), /permission denied/i);
  } finally {
    await db.close();
  }
});

test("test and admin activity is excluded from shared metrics, rankings, and failed-by-all", async () => {
  const db = await migratedDatabase();
  const examId = "exam-access-roles";
  const versionId = "version-access-roles";
  const versionPath = `${examId}/versions/${versionId}.json`;
  const questions = ["access-q1", "access-q2", "access-q3"];
  try {
    await db.query(
      `insert into public.official_exam_versions(
         exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key
       ) values ($1, $2, $3, 90, $4, $5::jsonb)`,
      [examId, versionId, versionPath, questions, JSON.stringify(Object.fromEntries(questions.map((id) => [id, "B"])))],
    );
    for (const userId of [testUser, adminUser]) await insertAuthUser(db, userId);
    await db.query("insert into public.app_access_roles(user_id, role) values ($1, 'test'), ($2, 'admin')", [testUser, adminUser]);
    for (const userId of participants) await insertAuthUser(db, userId);

    for (const [index, userId] of [...participants, testUser, adminUser].entries()) {
      await db.query(
        `insert into public.attempts(
           id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
           kind, principal, strategy, status, duration_minutes, started_at, deadline_at,
           completed_at, score, correct_answers, wrong_answers, blank_answers, exam_elapsed_ms
         ) values ($1, $2, $3, $4, $5, $6, 'exam', false, 'exam', 'completed', 90,
           now() - interval '90 minutes', now(), now(), $7, 1, 2, 0, $8)`,
        [`20000000-0000-4000-8000-00000000010${index + 1}`, userId, examId, versionId,
          versionPath, questions, index < 3 ? 70 + index : 100, 60_000 - index * 1_000],
      );
    }
    await db.query(
      `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
       values
         ($1, $6, $7, 1, true), ($2, $6, $7, 1, true), ($3, $6, $7, 1, true),
         ($1, $6, $8, 1, true), ($2, $6, $8, 1, true), ($4, $6, $8, 1, true),
         ($1, $6, $9, 1, true), ($2, $6, $9, 1, true), ($5, $6, $9, 1, true)`,
      [...participants, testUser, adminUser, examId, ...questions],
    );
    await db.query(
      `insert into public.attempt_answers(
         id, attempt_id, user_id, question_id, answer_sequence, selected_option, correct_option, is_correct
       ) values
         ('30000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', $1, $3, 1, 'A', 'B', false),
         ('30000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000104', $2, $3, 1, 'B', 'B', true)`,
      [participants[0], testUser, questions[0]],
    );

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [participants[0]]);
    const { rows: [{ get_dashboard: dashboard }] } = await db.query("select public.get_dashboard()");

    assert.deepEqual(dashboard.shared.profiles.map(({ alias, answer_count: count }) => [alias, count]), [
      ["Participante 1", 1],
      ["Participante 2", 0],
      ["Participante 3", 0],
    ]);
    assert.deepEqual(dashboard.shared.official_exam_rankings.map(({ alias }) => alias), [
      "Participante 3",
      "Participante 2",
      "Participante 1",
    ]);
    assert.deepEqual(dashboard.shared.failed_by_all, [
      { exam_id: examId, question_id: questions[0], failed_profile_count: 3 },
    ]);
  } finally {
    await db.close();
  }
});

test("explicit role transitions free and reclaim participant slots", async () => {
  const db = await migratedDatabase();
  try {
    for (const userId of participants) await insertAuthUser(db, userId);
    await db.query("insert into public.app_access_roles(user_id, role) values ($1, 'participant')", [participants[0]]);

    await db.query("update public.app_access_roles set role = 'test' where user_id = $1", [participants[0]]);
    assert.deepEqual((await aliases(db)).map(({ alias }) => alias), ["Participante 2", "Participante 3"]);

    await db.query("delete from public.app_access_roles where user_id = $1", [participants[0]]);
    assert.deepEqual((await aliases(db)).map(({ user_id, alias }) => [user_id, alias]), [
      [participants[0], "Participante 1"],
      [participants[1], "Participante 2"],
      [participants[2], "Participante 3"],
    ]);

    await db.query("insert into public.app_access_roles(user_id, role) values ($1, 'test')", [participants[0]]);
    await db.query("update public.app_access_roles set role = 'participant' where user_id = $1", [participants[0]]);
    assert.deepEqual((await aliases(db)).map(({ user_id, alias }) => [user_id, alias]), [
      [participants[0], "Participante 1"],
      [participants[1], "Participante 2"],
      [participants[2], "Participante 3"],
    ]);

    await db.query("delete from auth.users where id = $1", [participants[0]]);
    assert.equal((await db.query("select count(*)::integer as count from public.app_access_roles")).rows[0].count, 0);
    assert.deepEqual((await aliases(db)).map(({ alias }) => alias), ["Participante 2", "Participante 3"]);
  } finally {
    await db.close();
  }
});

test("migration classifies existing users as test without deleting historical data", async () => {
  const db = await database();
  const names = await migrationNames();
  const historicalUsers = participants;
  try {
    await db.query("insert into auth.users(id) values ($1), ($2), ($3)", historicalUsers);
    await applyMigrations(db, names.filter((name) => name !== accessRolesMigration));
    await db.query(
      `insert into public.attempts(
         id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
         status, completed_at, active_seconds
       ) values ('20000000-0000-4000-8000-000000000111', $1, 'historical-exam',
         'historical-version', 'historical-exam/versions/historical-version.json', array['historical-q1'],
         'completed', now(), 42)`,
      [historicalUsers[0]],
    );
    await db.query(
      `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
       values ($1, 'historical-exam', 'historical-q1', 1, true)`,
      [historicalUsers[0]],
    );

    await applyMigrations(db, [accessRolesMigration]);

    assert.equal((await db.query("select count(*)::integer as count from public.profiles")).rows[0].count, 3);
    assert.equal((await db.query("select count(*)::integer as count from public.attempts")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::integer as count from public.question_progress")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::integer as count from public.shared_profile_aliases")).rows[0].count, 0);
    assert.deepEqual(
      (await db.query("select role, count(*)::integer as count from public.app_access_roles group by role")).rows,
      [{ role: "test", count: 3 }],
    );
  } finally {
    await db.close();
  }
});
