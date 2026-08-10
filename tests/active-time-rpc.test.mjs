import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const saveId = "30000000-0000-4000-8000-000000000001";

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

  const migrationNames = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrationNames) {
    await db.exec(await readFile(new URL(name, migrationsUrl), "utf8"));
  }
  return db;
}

async function saveActiveTime(db) {
  const { rows: [{ accepts_save_id: acceptsSaveId }] } = await db.query(`
    select to_regprocedure(
      'public.save_normal_attempt(uuid,uuid,integer,integer,boolean)'
    ) is not null as accepts_save_id
  `);
  if (acceptsSaveId) {
    await db.query(
      "select public.save_normal_attempt($1, $2, $3, $4, $5)",
      [saveId, attemptId, 0, 9, false],
    );
    return;
  }
  await db.query(
    "select public.save_normal_attempt($1, $2, $3, $4)",
    [attemptId, 0, 9, false],
  );
}

test("un reintento de la misma operación de tiempo activo persiste el incremento una sola vez", async () => {
  const db = await migratedDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query(
      `insert into public.attempts(
        id, user_id, exam_id, exam_version_id, exam_version_path, question_ids
      ) values ($1, $2, 'exam', 'version-1', 'exam/versions/version-1.json', array['exam-q1'])`,
      [attemptId, userId],
    );
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);

    await saveActiveTime(db);
    await saveActiveTime(db);

    const { rows: [attempt] } = await db.query(
      "select active_seconds from public.attempts where id = $1",
      [attemptId],
    );
    assert.equal(attempt.active_seconds, 9);
  } finally {
    await db.close();
  }
});
