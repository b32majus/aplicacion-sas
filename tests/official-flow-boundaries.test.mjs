import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000020";
const examId = "boundary-exam";
const versionId = "boundary-version-current";
const versionPath = `${examId}/versions/${versionId}.json`;
const questionIds = ["boundary-exam-q001", "boundary-exam-q002", "boundary-exam-q003"];
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
  await db.query("insert into auth.users(id) values ($1)", [userId]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await registerVersion(db, { examId, versionId, versionPath, questionIds, answerKey, published: true });
  return db;
}

async function registerVersion(db, {
  examId: id,
  versionId: version,
  versionPath: path,
  questionIds: questions,
  answerKey: key,
  published,
}) {
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes,
       question_ids, answer_key, is_published
     ) values ($1, $2, $3, 90, $4, $5::jsonb, $6)`,
    [id, version, path, questions, JSON.stringify(key), published],
  );
}

async function startPrincipal(db, questions, strategy = "normal", replace = false, tuple = {}) {
  const { rows: [attempt] } = await db.query(
    `select (public.start_or_replace_principal_attempt(
       $1, $2, $3, $4, $5, $6
     )).*`,
    [
      tuple.examId ?? examId,
      tuple.versionId ?? versionId,
      tuple.versionPath ?? versionPath,
      questions,
      strategy,
      replace,
    ],
  );
  return attempt;
}

async function startExam(db, tuple = {}) {
  const params = {
    examId,
    versionId,
    versionPath,
    questionIds,
    ...tuple,
  };
  const { rows: [{ start_or_resume_exam_attempt: attempt }] } = await db.query(
    "select public.start_or_resume_exam_attempt($1, $2, $3, $4, 90)",
    [params.examId, params.versionId, params.versionPath, params.questionIds],
  );
  return attempt;
}

function failedSource(tuple = {}) {
  return JSON.stringify([{
    exam_id: tuple.examId ?? examId,
    exam_version_id: tuple.versionId ?? versionId,
    exam_version_path: tuple.versionPath ?? versionPath,
    question_id: tuple.questionId ?? questionIds[0],
  }]);
}

test("principal study requires the complete current set and preserves an existing pin", async () => {
  const db = await migratedDatabase();
  try {
    await assert.rejects(startPrincipal(db, questionIds.slice(0, 2)), /Orden normal.*completo/i);
    await assert.rejects(startPrincipal(db, [...questionIds, "boundary-exam-q999"]), /Orden normal.*completo/i);
    await assert.rejects(startPrincipal(db, [...questionIds].reverse()), /Orden normal.*completo/i);

    const normal = await startPrincipal(db, questionIds);
    assert.deepEqual(normal.question_ids, questionIds);

    await assert.rejects(startPrincipal(db, questionIds.slice(0, 2), "random", true), /permutación completa/i);
    await assert.rejects(startPrincipal(db, [...questionIds, "boundary-exam-q999"], "random", true), /permutación completa/i);
    await assert.rejects(startPrincipal(db, [questionIds[0], questionIds[0], questionIds[2]], "random", true), /permutación completa/i);

    const randomOrder = [questionIds[2], questionIds[0], questionIds[1]];
    const random = await startPrincipal(db, randomOrder, "random", true);
    assert.deepEqual(random.question_ids, randomOrder);

    await db.query("update public.official_exam_versions set is_published = false where exam_id = $1", [examId]);
    const resumed = await startPrincipal(db, ["ignored"], "random");
    assert.equal(resumed.id, random.id);
    assert.deepEqual(resumed.question_ids, randomOrder);

    await db.query(
      "update public.attempts set status = 'abandoned', abandoned_at = now() where id = $1",
      [random.id],
    );
    await assert.rejects(startPrincipal(db, questionIds), /actualmente publicada/i);
  } finally {
    await db.close();
  }
});

test("new official exams reject historical versions while an active pin survives publication", async () => {
  const db = await migratedDatabase();
  try {
    const oldVersionId = "boundary-version-old";
    const oldVersionPath = `${examId}/versions/${oldVersionId}.json`;
    await registerVersion(db, {
      examId,
      versionId: oldVersionId,
      versionPath: oldVersionPath,
      questionIds,
      answerKey,
      published: false,
    });
    await assert.rejects(startExam(db, {
      versionId: oldVersionId,
      versionPath: oldVersionPath,
    }), /actualmente publicada/i);

    const active = await startExam(db);
    await db.query("update public.official_exam_versions set is_published = false where exam_version_id = $1", [versionId]);
    await db.query("update public.official_exam_versions set is_published = true where exam_version_id = $1", [oldVersionId]);
    const resumed = await startExam(db, {
      versionId: oldVersionId,
      versionPath: oldVersionPath,
    });
    assert.equal(resumed.id, active.id);
    assert.equal(resumed.exam_version_id, versionId);
  } finally {
    await db.close();
  }
});

test("new failed sessions require current stable sources and preserve an active pin", async () => {
  const db = await migratedDatabase();
  try {
    await db.query(
      `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
       values ($1, $2, $3, 1, true)`,
      [userId, examId, questionIds[0]],
    );
    const failed = await db.query(
      "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
      [examId, failedSource()],
    ).then(({ rows }) => rows[0]);

    const nextVersionId = "boundary-version-next";
    const nextVersionPath = `${examId}/versions/${nextVersionId}.json`;
    await db.query("update public.official_exam_versions set is_published = false where exam_id = $1", [examId]);
    await registerVersion(db, {
      examId,
      versionId: nextVersionId,
      versionPath: nextVersionPath,
      questionIds,
      answerKey,
      published: true,
    });

    const resumed = await db.query(
      "select (public.start_or_resume_failed_attempt($1, '[]'::jsonb)).*",
      [examId],
    ).then(({ rows }) => rows[0]);
    assert.equal(resumed.id, failed.id);

    await db.query(
      "select public.confirm_failed_answer($1, $2, $3, 'B', 'B')",
      ["20000000-0000-4000-8000-000000000020", failed.id, questionIds[0]],
    );
    await db.query("select public.complete_failed_attempt($1)", [failed.id]);
    await db.query(
      "update public.question_progress set pending_failure = true, mastered = false where user_id = $1 and exam_id = $2 and question_id = $3",
      [userId, examId, questionIds[0]],
    );

    await assert.rejects(
      db.query(
        "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
        [examId, failedSource()],
      ),
      /actualmente publicadas/i,
    );
  } finally {
    await db.close();
  }
});
