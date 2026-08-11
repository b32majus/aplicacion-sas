import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  `);
  const migrations = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) await db.exec(await readFile(new URL(migration, migrationsUrl), "utf8"));
  return db;
}

test("the official registry freezes canonical content but permits publication switches", async () => {
  const db = await migratedDatabase();
  try {
    const { rows: [{ seeded, invalid_paths: invalidPaths }] } = await db.query(
      `select count(*)::integer as seeded,
              count(*) filter (where exam_version_path <>
                exam_id || '/versions/' || exam_version_id || '.json')::integer as invalid_paths
       from public.official_exam_versions`,
    );
    assert.equal(seeded, 2);
    assert.equal(invalidPaths, 0);

    const { rows: [seed] } = await db.query(
      "select * from public.official_exam_versions order by exam_id limit 1",
    );
    const immutableMutations = [
      ["update public.official_exam_versions set duration_minutes = duration_minutes + 1 where exam_id = $1", [seed.exam_id]],
      ["update public.official_exam_versions set question_ids = array['other'] where exam_id = $1", [seed.exam_id]],
      ["update public.official_exam_versions set answer_key = '{}'::jsonb where exam_id = $1", [seed.exam_id]],
      ["update public.official_exam_versions set exam_version_path = 'other/versions/version.json' where exam_id = $1", [seed.exam_id]],
      ["delete from public.official_exam_versions where exam_id = $1", [seed.exam_id]],
    ];
    for (const [sql, params] of immutableMutations) {
      await assert.rejects(db.query(sql, params), /inmutable|no se pueden eliminar/i);
    }

    await db.query(
      "update public.official_exam_versions set is_published = false where exam_id = $1",
      [seed.exam_id],
    );
    await db.query(
      "update public.official_exam_versions set is_published = true where exam_id = $1",
      [seed.exam_id],
    );
    const { rows: [{ published }] } = await db.query(
      "select is_published as published from public.official_exam_versions where exam_id = $1",
      [seed.exam_id],
    );
    assert.equal(published, true);

    const { rows: [{ table_access: tableAccess }] } = await db.query(
      "select has_table_privilege('authenticated', 'public.official_exam_versions', 'select') as table_access",
    );
    assert.equal(tableAccess, false);
  } finally {
    await db.close();
  }
});
