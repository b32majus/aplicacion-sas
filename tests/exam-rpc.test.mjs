import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000010";
const examId = "exam-official";
const versionId = "version-official";
const versionPath = "exam-official/versions/version-official.json";
const questionIds = ["exam-official-q001", "exam-official-q003", "exam-official-q151"];

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

async function startExam(db, overrides = {}) {
  const params = {
    examId,
    versionId,
    versionPath,
    questionIds,
    durationMinutes: 90,
    ...overrides,
  };
  const { rows: [{ start_or_resume_exam_attempt: result }] } = await db.query(
    "select public.start_or_resume_exam_attempt($1, $2, $3, $4, $5)",
    [params.examId, params.versionId, params.versionPath, params.questionIds, params.durationMinutes],
  );
  return result;
}

async function saveExamAnswer(db, answerId, attemptId, questionId, selectedOption, position) {
  const { rows: [{ save_exam_answer: result }] } = await db.query(
    "select public.save_exam_answer($1, $2, $3, $4, $5)",
    [answerId, attemptId, questionId, selectedOption, position],
  );
  return result;
}

async function finishExam(db, attemptId, answerKey = {
  [questionIds[0]]: "B",
  [questionIds[1]]: "B",
  [questionIds[2]]: "C",
}) {
  const { rows: [{ finish_exam_attempt: result }] } = await db.query(
    "select public.finish_exam_attempt($1, $2::jsonb)",
    [attemptId, JSON.stringify(answerKey)],
  );
  return result;
}

test("Seam 2: iniciar Modo examen fija el orden oficial y un deadline de servidor sin crear otro activo", async () => {
  const db = await migratedDatabase();
  try {
    const started = await startExam(db);
    assert.equal(started.kind, "exam");
    assert.equal(started.status, "active");
    assert.deepEqual(started.question_ids, questionIds);
    assert.equal(started.duration_minutes, 90);
    assert.equal(
      Date.parse(started.deadline_at) - Date.parse(started.started_at),
      90 * 60 * 1000,
    );
    assert.ok(Math.abs(Date.parse(started.server_now) - Date.parse(started.started_at)) < 1000);

    const resumed = await startExam(db, {
      examId: "another-exam",
      versionId: "another-version",
      versionPath: "another-exam/versions/another-version.json",
      questionIds: ["another-exam-q001"],
      durationMinutes: 120,
    });
    assert.equal(resumed.id, started.id);
    assert.equal(resumed.exam_id, examId);

    const { rows: [{ active_count: activeCount }] } = await db.query(
      "select count(*)::integer as active_count from public.attempts where user_id = $1 and kind = 'exam' and status = 'active'",
      [userId],
    );
    assert.equal(activeCount, 1);
  } finally {
    await db.close();
  }
});

test("Seam 2: una respuesta de examen puede cambiarse y borrarse sin corregir ni alterar progreso", async () => {
  const db = await migratedDatabase();
  try {
    const attempt = await startExam(db);
    const first = await saveExamAnswer(
      db,
      "20000000-0000-4000-8000-000000000001",
      attempt.id,
      questionIds[0],
      "A",
      0,
    );
    assert.equal(first.selected_option, "A");
    assert.equal(first.correct_option, null);
    assert.equal(first.is_correct, null);

    const changed = await saveExamAnswer(
      db,
      "20000000-0000-4000-8000-000000000002",
      attempt.id,
      questionIds[0],
      "C",
      1,
    );
    assert.equal(changed.selected_option, "C");

    const cleared = await saveExamAnswer(
      db,
      "20000000-0000-4000-8000-000000000003",
      attempt.id,
      questionIds[0],
      null,
      2,
    );
    assert.equal(cleared.selected_option, null);
    assert.equal(cleared.answer_sequence, 3);

    const { rows: drafts } = await db.query(
      `select selected_option, correct_option, is_correct
       from public.attempt_answers where attempt_id = $1 order by answer_sequence`,
      [attempt.id],
    );
    assert.deepEqual(drafts, [
      { selected_option: "A", correct_option: null, is_correct: null },
      { selected_option: "C", correct_option: null, is_correct: null },
      { selected_option: null, correct_option: null, is_correct: null },
    ]);
    const { rows: progress } = await db.query(
      "select * from public.question_progress where user_id = $1 and exam_id = $2",
      [userId, examId],
    );
    assert.deepEqual(progress, []);
  } finally {
    await db.close();
  }
});

test("Seam 2: finalizar puntúa blancas y aplica el progreso una sola vez", async () => {
  const db = await migratedDatabase();
  try {
    const attempt = await startExam(db);
    await db.query(
      `insert into public.question_progress(
        user_id, exam_id, question_id, correct_count, wrong_count,
        current_streak, mastered, pending_failure
      ) values
        ($1, $2, $3, 1, 1, 1, false, true),
        ($1, $2, $4, 1, 1, 1, false, true),
        ($1, $2, $5, 2, 0, 2, true, false)`,
      [userId, examId, questionIds[0], questionIds[1], questionIds[2]],
    );
    await saveExamAnswer(
      db,
      "30000000-0000-4000-8000-000000000001",
      attempt.id,
      questionIds[0],
      "B",
      0,
    );
    await saveExamAnswer(
      db,
      "30000000-0000-4000-8000-000000000002",
      attempt.id,
      questionIds[1],
      "A",
      1,
    );

    const summary = await finishExam(db, attempt.id);
    assert.deepEqual({
      correct: summary.correct,
      wrong: summary.wrong,
      blank: summary.blank,
      score: summary.score,
      new_personal_record: summary.new_personal_record,
    }, {
      correct: 1,
      wrong: 1,
      blank: 1,
      score: 25,
      new_personal_record: true,
    });
    assert.ok(summary.elapsed_ms >= 0);
    assert.ok(summary.elapsed_ms <= 90 * 60 * 1000);

    const { rows: progress } = await db.query(
      `select question_id, correct_count, wrong_count, current_streak, mastered, pending_failure
       from public.question_progress
       where user_id = $1 and exam_id = $2
       order by question_id`,
      [userId, examId],
    );
    assert.deepEqual(progress, [
      {
        question_id: questionIds[0], correct_count: 2, wrong_count: 1,
        current_streak: 2, mastered: true, pending_failure: false,
      },
      {
        question_id: questionIds[1], correct_count: 1, wrong_count: 2,
        current_streak: 0, mastered: false, pending_failure: true,
      },
      {
        question_id: questionIds[2], correct_count: 2, wrong_count: 1,
        current_streak: 0, mastered: false, pending_failure: true,
      },
    ]);

    const retried = await finishExam(db, attempt.id);
    assert.deepEqual(retried, summary);
    const { rows: progressAfterRetry } = await db.query(
      `select question_id, correct_count, wrong_count, current_streak, mastered, pending_failure
       from public.question_progress
       where user_id = $1 and exam_id = $2
       order by question_id`,
      [userId, examId],
    );
    assert.deepEqual(progressAfterRetry, progress);
  } finally {
    await db.close();
  }
});

test("Seam 2: un Modo examen activo bloquea respuestas de estudio sin abandonar sus intentos", async () => {
  const db = await migratedDatabase();
  try {
    const { rows: [completedPrincipal] } = await db.query(
      `select (public.start_or_replace_principal_attempt(
        $1, $2, $3, $4, 'normal', false
      )).*`,
      [examId, versionId, versionPath, [questionIds[0]]],
    );
    await db.query(
      "select public.confirm_normal_answer($1, $2, $3, 'A', 'B')",
      ["40000000-0000-4000-8000-000000000001", completedPrincipal.id, questionIds[0]],
    );
    await db.query("select public.complete_normal_attempt($1)", [completedPrincipal.id]);

    const source = JSON.stringify([{
      exam_id: examId,
      exam_version_id: versionId,
      exam_version_path: versionPath,
      question_id: questionIds[0],
    }]);
    const { rows: [failed] } = await db.query(
      "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
      [examId, source],
    );
    const { rows: [principal] } = await db.query(
      `select (public.start_or_replace_principal_attempt(
        $1, $2, $3, $4, 'normal', false
      )).*`,
      [examId, versionId, versionPath, [questionIds[1]]],
    );
    await startExam(db);

    await assert.rejects(
      db.query(
        "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
        ["40000000-0000-4000-8000-000000000002", principal.id, questionIds[1]],
      ),
      /Modo examen activo/,
    );
    await assert.rejects(
      db.query(
        "select public.confirm_failed_answer($1, $2, $3, 'B', 'B')",
        ["40000000-0000-4000-8000-000000000003", failed.id, questionIds[0]],
      ),
      /Modo examen activo/,
    );

    const { rows: stillActive } = await db.query(
      `select id, kind, status from public.attempts
       where id in ($1, $2) order by kind`,
      [failed.id, principal.id],
    );
    assert.deepEqual(stillActive, [
      { id: failed.id, kind: "failed", status: "active" },
      { id: principal.id, kind: "normal", status: "active" },
    ]);
  } finally {
    await db.close();
  }
});

test("Seam 2: el servidor rechaza ediciones tardías y cierra el intento con el tiempo oficial", async () => {
  const db = await migratedDatabase();
  try {
    const attempt = await startExam(db, { durationMinutes: 1 });
    await db.exec("alter table public.attempts disable trigger attempts_keep_pinned_identity");
    await db.query(
      `update public.attempts
       set started_at = now() - interval '2 minutes',
           deadline_at = now() - interval '1 minute'
       where id = $1`,
      [attempt.id],
    );
    await db.exec("alter table public.attempts enable trigger attempts_keep_pinned_identity");

    await assert.rejects(
      saveExamAnswer(
        db,
        "50000000-0000-4000-8000-000000000001",
        attempt.id,
        questionIds[0],
        "B",
        0,
      ),
      /deadline.*vencido/i,
    );

    const summary = await finishExam(db, attempt.id);
    assert.equal(summary.elapsed_ms, 60_000);
    assert.deepEqual(
      { correct: summary.correct, wrong: summary.wrong, blank: summary.blank },
      { correct: 0, wrong: 0, blank: 3 },
    );
    const repeated = await startExam(db, { durationMinutes: 1 });
    assert.notEqual(repeated.id, attempt.id);
    assert.equal(repeated.status, "active");
  } finally {
    await db.close();
  }
});
