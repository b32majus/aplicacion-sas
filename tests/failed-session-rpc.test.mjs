import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000009";
const examId = "exam-a";
const questionId = "exam-a-q001";
const versionId = "version-a";
const versionPath = "exam-a/versions/version-a.json";

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
  await db.query("insert into auth.users(id) values ($1)", [userId]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  return db;
}

async function startPrincipal(db) {
  const { rows: [attempt] } = await db.query(
    `select (public.start_or_replace_principal_attempt(
      $1, $2, $3, $4, 'normal', false
    )).*`,
    [examId, versionId, versionPath, [questionId]],
  );
  return attempt;
}

async function confirmNormal(db, confirmationId, attemptId, selectedOption) {
  await db.query(
    "select public.confirm_normal_answer($1, $2, $3, $4, 'B')",
    [confirmationId, attemptId, questionId, selectedOption],
  );
}

async function startFailed(db) {
  const sources = JSON.stringify([{
    exam_id: examId,
    exam_version_id: versionId,
    exam_version_path: versionPath,
    question_id: questionId,
  }]);
  const { rows: [attempt] } = await db.query(
    "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
    [examId, sources],
  );
  return attempt;
}

async function confirmFailed(db, confirmationId, attemptId, selectedOption) {
  await db.query(
    "select public.confirm_failed_answer($1, $2, $3, $4, 'B')",
    [confirmationId, attemptId, questionId, selectedOption],
  );
}

async function progress(db) {
  const { rows: [row] } = await db.query(
    `select correct_count, wrong_count, current_streak, mastered, pending_failure
     from public.question_progress
     where user_id = $1 and exam_id = $2 and question_id = $3`,
    [userId, examId, questionId],
  );
  return row;
}

test("Seam 2: una fallada pendiente alcanza dominio y un nuevo fallo reinicia su racha sin duplicar reintentos", async () => {
  const db = await migratedDatabase();
  try {
    const original = await startPrincipal(db);
    const wrongId = "20000000-0000-4000-8000-000000000001";
    await confirmNormal(db, wrongId, original.id, "A");
    await confirmNormal(db, wrongId, original.id, "A");
    assert.deepEqual(await progress(db), {
      correct_count: 0,
      wrong_count: 1,
      current_streak: 0,
      mastered: false,
      pending_failure: true,
    });
    await db.query("select public.complete_normal_attempt($1)", [original.id]);

    const firstRecovery = await startFailed(db);
    assert.equal(firstRecovery.kind, "failed");
    assert.equal(firstRecovery.principal, false);
    const { rows: firstQueue } = await db.query(
      `select exam_id, exam_version_id, exam_version_path, question_id
       from public.attempt_question_sources where attempt_id = $1 order by position`,
      [firstRecovery.id],
    );
    assert.deepEqual(firstQueue, [{
      exam_id: examId,
      exam_version_id: versionId,
      exam_version_path: versionPath,
      question_id: questionId,
    }]);
    const firstCorrectId = "20000000-0000-4000-8000-000000000002";
    await confirmFailed(db, firstCorrectId, firstRecovery.id, "B");
    await confirmFailed(db, firstCorrectId, firstRecovery.id, "B");
    assert.deepEqual(await progress(db), {
      correct_count: 1,
      wrong_count: 1,
      current_streak: 1,
      mastered: false,
      pending_failure: true,
    });
    const resumedRecovery = await startFailed(db);
    assert.equal(resumedRecovery.id, firstRecovery.id);
    const { rows: [{ answer_count: answerCount }] } = await db.query(
      "select count(*)::integer as answer_count from public.attempt_answers where attempt_id = $1",
      [firstRecovery.id],
    );
    assert.equal(answerCount, 1);
    await db.query("select public.complete_failed_attempt($1)", [firstRecovery.id]);

    const secondRecovery = await startFailed(db);
    await confirmFailed(db, "20000000-0000-4000-8000-000000000003", secondRecovery.id, "B");
    assert.deepEqual(await progress(db), {
      correct_count: 2,
      wrong_count: 1,
      current_streak: 2,
      mastered: true,
      pending_failure: false,
    });
    const { rows: [{ complete_failed_attempt: summary }] } = await db.query(
      "select public.complete_failed_attempt($1)",
      [secondRecovery.id],
    );
    assert.equal(summary.mastered, 1);
    assert.deepEqual(summary.still_pending, []);

    const laterPrincipal = await startPrincipal(db);
    await confirmNormal(db, "20000000-0000-4000-8000-000000000004", laterPrincipal.id, "A");
    assert.deepEqual(await progress(db), {
      correct_count: 2,
      wrong_count: 2,
      current_streak: 0,
      mastered: false,
      pending_failure: true,
    });
  } finally {
    await db.close();
  }
});

test("Seam 2: Todas mis falladas conserva orígenes únicos y reanuda la única sesión global sin alterar recorridos principales", async () => {
  const db = await migratedDatabase();
  try {
    const secondExamId = "exam-b";
    const secondQuestionId = "exam-b-q001";
    const secondVersionId = "version-b";
    const secondVersionPath = "exam-b/versions/version-b.json";
    const firstPrincipal = await startPrincipal(db);
    await confirmNormal(db, "40000000-0000-4000-8000-000000000001", firstPrincipal.id, "A");
    const { rows: [secondPrincipal] } = await db.query(
      `select (public.start_or_replace_principal_attempt(
        $1, $2, $3, $4, 'normal', false
      )).*`,
      [secondExamId, secondVersionId, secondVersionPath, [secondQuestionId]],
    );
    await db.query(
      "select public.confirm_normal_answer($1, $2, $3, 'A', 'B')",
      ["40000000-0000-4000-8000-000000000002", secondPrincipal.id, secondQuestionId],
    );

    const sources = JSON.stringify([
      {
        exam_id: examId,
        exam_version_id: versionId,
        exam_version_path: versionPath,
        question_id: questionId,
      },
      {
        exam_id: secondExamId,
        exam_version_id: secondVersionId,
        exam_version_path: secondVersionPath,
        question_id: secondQuestionId,
      },
    ]);
    const { rows: [allFailed] } = await db.query(
      "select (public.start_or_resume_failed_attempt(null, $1::jsonb)).*",
      [sources],
    );
    assert.equal(allFailed.failed_scope_exam_id, null);
    assert.deepEqual(allFailed.question_ids, [questionId, secondQuestionId]);

    const { rows: queue } = await db.query(
      `select position, exam_id, exam_version_id, exam_version_path, question_id
       from public.attempt_question_sources where attempt_id = $1 order by position`,
      [allFailed.id],
    );
    assert.deepEqual(queue, [
      {
        position: 0,
        exam_id: examId,
        exam_version_id: versionId,
        exam_version_path: versionPath,
        question_id: questionId,
      },
      {
        position: 1,
        exam_id: secondExamId,
        exam_version_id: secondVersionId,
        exam_version_path: secondVersionPath,
        question_id: secondQuestionId,
      },
    ]);

    const { rows: [resumed] } = await db.query(
      "select (public.start_or_resume_failed_attempt($1, '[]'::jsonb)).*",
      [examId],
    );
    assert.equal(resumed.id, allFailed.id);
    const { rows: activeAttempts } = await db.query(
      "select id, kind, exam_id from public.attempts where user_id = $1 and status = 'active' order by kind, exam_id",
      [userId],
    );
    assert.deepEqual(activeAttempts, [
      { id: allFailed.id, kind: "failed", exam_id: "__all_failed__" },
      { id: firstPrincipal.id, kind: "normal", exam_id: examId },
      { id: secondPrincipal.id, kind: "normal", exam_id: secondExamId },
    ]);

    const saveId = "40000000-0000-4000-8000-000000000003";
    await db.query(
      "select public.save_normal_attempt($1, $2, 1, 7, false)",
      [saveId, allFailed.id],
    );
    await db.query(
      "select public.save_normal_attempt($1, $2, 1, 7, false)",
      [saveId, allFailed.id],
    );
    const { rows: [{ active_seconds: activeSeconds }] } = await db.query(
      "select active_seconds from public.attempts where id = $1",
      [allFailed.id],
    );
    assert.equal(activeSeconds, 7);

    await confirmFailed(db, "40000000-0000-4000-8000-000000000004", allFailed.id, "B");
    await db.query(
      "select public.confirm_failed_answer($1, $2, $3, 'A', 'B')",
      ["40000000-0000-4000-8000-000000000005", allFailed.id, secondQuestionId],
    );
    const { rows: [{ complete_failed_attempt: summary }] } = await db.query(
      "select public.complete_failed_attempt($1)",
      [allFailed.id],
    );
    assert.equal(summary.mastered, 0);
    assert.deepEqual(summary.still_pending, [
      { exam_id: examId, question_id: questionId },
      { exam_id: secondExamId, question_id: secondQuestionId },
    ]);
  } finally {
    await db.close();
  }
});

test("Seam 2: una Sesión de falladas solo admite las operaciones que conservan su origen", async () => {
  const db = await migratedDatabase();
  try {
    const principal = await startPrincipal(db);
    await confirmNormal(db, "50000000-0000-4000-8000-000000000001", principal.id, "A");
    await db.query("select public.complete_normal_attempt($1)", [principal.id]);
    const failed = await startFailed(db);

    await assert.rejects(
      db.query(
        "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
        ["50000000-0000-4000-8000-000000000002", failed.id, questionId],
      ),
      /Recorrido principal/,
    );
    await assert.rejects(
      db.query("select public.complete_normal_attempt($1)", [failed.id]),
      /Recorrido principal/,
    );
    assert.deepEqual(await progress(db), {
      correct_count: 0,
      wrong_count: 1,
      current_streak: 0,
      mastered: false,
      pending_failure: true,
    });
  } finally {
    await db.close();
  }
});
