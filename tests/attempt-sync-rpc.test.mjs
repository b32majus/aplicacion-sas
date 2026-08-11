import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000070";
const attemptId = "20000000-0000-4000-8000-000000000070";

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
  await db.query(
    `insert into public.attempts(
       id, user_id, exam_id, exam_version_id, exam_version_path, question_ids
     ) values ($1, $2, 'exam', 'version-1', 'exam/versions/version-1.json', array['exam-q1', 'exam-q2'])`,
    [attemptId, userId],
  );
  return db;
}

function snapshot({ position, seconds = 0, paused = false }) {
  return {
    kind: "normal",
    position,
    is_paused: paused,
    active_increments: seconds ? [{
      id: "30000000-0000-4000-8000-000000000070",
      seconds,
    }] : [],
    study_confirmations: [],
    exam_answers: [],
    finalize: false,
  };
}

async function sync(db, syncId, baseRevision, pending, targetAttemptId = attemptId) {
  const { rows: [{ sync_active_attempt: result }] } = await db.query(
    "select public.sync_active_attempt($1, $2, $3, $4::jsonb)",
    [syncId, targetAttemptId, baseRevision, JSON.stringify(pending)],
  );
  return result;
}

test("Seam 2: el servidor rechaza una revisión obsoleta sin sobrescribir el avance canónico", async () => {
  const db = await migratedDatabase();
  try {
    const firstId = "40000000-0000-4000-8000-000000000070";
    const firstSnapshot = snapshot({ position: 0, seconds: 9 });
    const first = await sync(db, firstId, 0, firstSnapshot);
    assert.equal(first.attempt.revision, 1);
    assert.equal(first.attempt.active_seconds, 9);

    const retried = await sync(db, firstId, 0, firstSnapshot);
    assert.deepEqual(retried, first);

    const second = await sync(
      db,
      "40000000-0000-4000-8000-000000000071",
      1,
      snapshot({ position: 1, paused: true }),
    );
    assert.equal(second.attempt.revision, 2);
    assert.equal(second.attempt.current_position, 1);

    await assert.rejects(
      sync(
        db,
        "40000000-0000-4000-8000-000000000072",
        1,
        snapshot({ position: 0, paused: false }),
      ),
      /STALE_ATTEMPT_REVISION.*2/,
    );

    const { rows: [canonical] } = await db.query(
      "select revision, current_position, active_seconds, is_paused from public.attempts where id = $1",
      [attemptId],
    );
    assert.deepEqual(canonical, {
      revision: 2,
      current_position: 1,
      active_seconds: 9,
      is_paused: true,
    });
  } finally {
    await db.close();
  }
});

test("Seam 2: confirma trabajo local y conserva más de 300 segundos en incrementos acotados", async () => {
  const db = await migratedDatabase();
  try {
    const pending = {
      kind: "normal",
      position: 1,
      is_paused: false,
      active_increments: [300, 300, 25].map((seconds, index) => ({
        id: `30000000-0000-4000-8000-00000000008${index}`,
        seconds,
      })),
      study_confirmations: [
        {
          id: "50000000-0000-4000-8000-000000000080",
          question_id: "exam-q1",
          selected_option: "A",
          correct_option: "B",
        },
        {
          id: "50000000-0000-4000-8000-000000000081",
          question_id: "exam-q2",
          selected_option: "B",
          correct_option: "B",
        },
      ],
      exam_answers: [],
      finalize: true,
    };
    const syncId = "40000000-0000-4000-8000-000000000080";

    const result = await sync(db, syncId, 0, pending);
    assert.equal(result.attempt.revision, 1);
    assert.equal(result.attempt.status, "completed");
    assert.equal(result.attempt.active_seconds, 625);
    assert.deepEqual(
      result.answers.map(({ question_id: questionId, selected_option: selectedOption }) => ({
        questionId,
        selectedOption,
      })),
      [
        { questionId: "exam-q1", selectedOption: "A" },
        { questionId: "exam-q2", selectedOption: "B" },
      ],
    );
    assert.deepEqual(
      { correct: result.summary.correct, wrong: result.summary.wrong },
      { correct: 1, wrong: 1 },
    );

    const retried = await sync(db, syncId, 0, pending);
    assert.deepEqual(retried, result);
    const { rows: [{ answer_count: answerCount, operation_count: operationCount }] } = await db.query(
      `select
         (select count(*)::integer from public.attempt_answers where attempt_id = $1) as answer_count,
         (select count(*)::integer from public.attempt_save_operations where attempt_id = $1) as operation_count`,
      [attemptId],
    );
    assert.equal(answerCount, 2);
    assert.equal(operationCount, 3);
  } finally {
    await db.close();
  }
});

test("Seam 2: una expiración offline conserva la última respuesta y finaliza una sola vez", async () => {
  const db = await migratedDatabase();
  try {
    const examId = "exam-offline";
    const versionId = "version-offline";
    const versionPath = "exam-offline/versions/version-offline.json";
    const questionIds = ["exam-offline-q1", "exam-offline-q2"];
    await db.query(
      `insert into public.official_exam_versions(
         exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key
       ) values ($1, $2, $3, 90, $4, $5::jsonb)`,
      [examId, versionId, versionPath, questionIds, JSON.stringify({
        [questionIds[0]]: "A",
        [questionIds[1]]: "B",
      })],
    );
    const { rows: [{ start_or_resume_exam_attempt: examAttempt }] } = await db.query(
      "select public.start_or_resume_exam_attempt($1, $2, $3, $4, 90)",
      [examId, versionId, versionPath, questionIds],
    );
    await db.exec("alter table public.attempts disable trigger attempts_keep_pinned_identity");
    await db.query("select set_config('app.active_attempt_sync', 'on', false)");
    await db.query(
      "update public.attempts set started_at = now() - interval '91 minutes', deadline_at = now() - interval '1 minute' where id = $1",
      [examAttempt.id],
    );
    await db.query("select set_config('app.active_attempt_sync', 'off', false)");
    await db.exec("alter table public.attempts enable trigger attempts_keep_pinned_identity");

    await assert.rejects(
      db.query(
        "select public.save_exam_answer($1, $2, $3, 'B', 0)",
        ["60000000-0000-4000-8000-000000000090", examAttempt.id, questionIds[0]],
      ),
      /deadline.*vencido/i,
    );

    const pending = {
      kind: "exam",
      position: 1,
      is_paused: false,
      active_increments: [],
      study_confirmations: [],
      exam_answers: [
        {
          id: "60000000-0000-4000-8000-000000000091",
          question_id: questionIds[0],
          selected_option: "A",
        },
        {
          id: "60000000-0000-4000-8000-000000000092",
          question_id: questionIds[1],
          selected_option: null,
        },
      ],
      finalize: true,
    };
    const syncId = "70000000-0000-4000-8000-000000000090";
    const result = await sync(db, syncId, 0, pending, examAttempt.id);
    assert.equal(result.attempt.status, "completed");
    assert.equal(result.attempt.revision, 1);
    assert.deepEqual(
      { correct: result.summary.correct, wrong: result.summary.wrong, blank: result.summary.blank },
      { correct: 1, wrong: 0, blank: 1 },
    );
    assert.deepEqual(
      result.answers
        .filter(({ correct_option: correctOption }) => correctOption === null)
        .map(({ question_id: questionId, selected_option: selectedOption }) => ({ questionId, selectedOption })),
      [
        { questionId: questionIds[0], selectedOption: "A" },
        { questionId: questionIds[1], selectedOption: null },
      ],
    );

    const retried = await sync(db, syncId, 0, pending, examAttempt.id);
    assert.deepEqual(retried, result);
    await assert.rejects(
      db.query(
        "select public.save_exam_answer($1, $2, $3, 'B', 1)",
        ["60000000-0000-4000-8000-000000000093", examAttempt.id, questionIds[1]],
      ),
      /No existe un Modo examen activo propio/i,
    );
    const { rows: [{ progress_count: progressCount }] } = await db.query(
      "select count(*)::integer as progress_count from public.question_progress where user_id = $1 and exam_id = $2",
      [userId, examId],
    );
    assert.equal(progressCount, 2);
  } finally {
    await db.close();
  }
});
