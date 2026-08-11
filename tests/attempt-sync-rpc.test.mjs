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
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key
     ) values ('exam', 'version-1', 'exam/versions/version-1.json', 90,
       array['exam-q1', 'exam-q2'], '{"exam-q1":"B","exam-q2":"B"}'::jsonb)`,
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

async function startOfficialExam(db) {
  const examId = "exam-deadline";
  const versionId = "version-deadline";
  const versionPath = "exam-deadline/versions/version-deadline.json";
  const questionIds = ["exam-deadline-q1", "exam-deadline-q2"];
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key
     ) values ($1, $2, $3, 90, $4, $5::jsonb)`,
    [examId, versionId, versionPath, questionIds, JSON.stringify({
      [questionIds[0]]: "A",
      [questionIds[1]]: "B",
    })],
  );
  const { rows: [{ start_or_resume_exam_attempt: attempt }] } = await db.query(
    "select public.start_or_resume_exam_attempt($1, $2, $3, $4, 90)",
    [examId, versionId, versionPath, questionIds],
  );
  return { attempt, examId, questionIds };
}

async function expireAttempt(db, targetAttemptId) {
  await db.exec("alter table public.attempts disable trigger attempts_keep_pinned_identity");
  await db.query("select set_config('app.active_attempt_sync', 'on', false)");
  await db.query(
    "update public.attempts set started_at = now() - interval '91 minutes', deadline_at = now() - interval '1 minute' where id = $1",
    [targetAttemptId],
  );
  await db.query("select set_config('app.active_attempt_sync', 'off', false)");
  await db.exec("alter table public.attempts enable trigger attempts_keep_pinned_identity");
}

function examSnapshot({ questionIds, answers = [], finalize = false }) {
  return {
    kind: "exam",
    position: 1,
    is_paused: false,
    active_increments: [],
    study_confirmations: [],
    exam_answers: answers.map(({ id, questionIndex = 0, selectedOption }) => ({
      id,
      question_id: questionIds[questionIndex],
      selected_option: selectedOption,
    })),
    finalize,
  };
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
        0,
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

test("una correct_option manipulada no puede inflar el progreso de estudio", async () => {
  const db = await migratedDatabase();
  try {
    const pending = snapshot({ position: 0 });
    pending.study_confirmations = [{
      id: "50000000-0000-4000-8000-000000000089",
      question_id: "exam-q1",
      selected_option: "A",
      correct_option: "A",
    }];
    await assert.rejects(
      sync(db, "40000000-0000-4000-8000-000000000089", 0, pending),
      /no coincide con la versión oficial fijada/i,
    );
    const { rows: [{ answer_count: answerCount, progress_count: progressCount }] } = await db.query(
      `select
         (select count(*)::integer from public.attempt_answers where attempt_id = $1) as answer_count,
         (select count(*)::integer from public.question_progress where user_id = $2) as progress_count`,
      [attemptId, userId],
    );
    assert.deepEqual({ answerCount, progressCount }, { answerCount: 0, progressCount: 0 });
  } finally {
    await db.close();
  }
});

test("deadline vencido rechaza una respuesta nueva sin finalizar", async () => {
  const db = await migratedDatabase();
  try {
    const { attempt, questionIds } = await startOfficialExam(db);
    await expireAttempt(db, attempt.id);
    await assert.rejects(
      sync(
        db,
        "70000000-0000-4000-8000-000000000090",
        0,
        examSnapshot({ questionIds, answers: [{
          id: "60000000-0000-4000-8000-000000000090", selectedOption: "A",
        }] }),
        attempt.id,
      ),
      /deadline.*vencido/i,
    );
    const { rows: [{ answer_count: answerCount }] } = await db.query(
      "select count(*)::integer as answer_count from public.attempt_answers where attempt_id = $1",
      [attempt.id],
    );
    assert.equal(answerCount, 0);
  } finally {
    await db.close();
  }
});

test("deadline vencido rechaza el exploit de respuesta nueva con finalize=true", async () => {
  const db = await migratedDatabase();
  try {
    const { attempt, questionIds } = await startOfficialExam(db);
    await expireAttempt(db, attempt.id);
    await assert.rejects(
      sync(
        db,
        "70000000-0000-4000-8000-000000000091",
        0,
        examSnapshot({
          questionIds,
          answers: [{ id: "60000000-0000-4000-8000-000000000091", selectedOption: "A" }],
          finalize: true,
        }),
        attempt.id,
      ),
      /deadline.*vencido/i,
    );
    const { rows: [canonical] } = await db.query(
      "select status, score, correct_answers from public.attempts where id = $1",
      [attempt.id],
    );
    assert.deepEqual(canonical, { status: "active", score: null, correct_answers: null });
  } finally {
    await db.close();
  }
});

test("deadline vencido rechaza una respuesta más nueva para una pregunta ya contestada", async () => {
  const db = await migratedDatabase();
  try {
    const { attempt, questionIds } = await startOfficialExam(db);
    await db.query(
      "select public.save_exam_answer($1, $2, $3, 'B', 0)",
      ["60000000-0000-4000-8000-000000000092", attempt.id, questionIds[0]],
    );
    await expireAttempt(db, attempt.id);
    await assert.rejects(
      sync(
        db,
        "70000000-0000-4000-8000-000000000092",
        2,
        examSnapshot({
          questionIds,
          answers: [{ id: "60000000-0000-4000-8000-000000000093", selectedOption: "A" }],
          finalize: true,
        }),
        attempt.id,
      ),
      /deadline.*vencido/i,
    );
    const { rows } = await db.query(
      "select selected_option from public.attempt_answers where attempt_id = $1 and correct_option is null",
      [attempt.id],
    );
    assert.deepEqual(rows, [{ selected_option: "B" }]);
  } finally {
    await db.close();
  }
});

test("deadline vencido permite replay idempotente exacto y finaliza sin mutar la respuesta", async () => {
  const db = await migratedDatabase();
  try {
    const { attempt, questionIds } = await startOfficialExam(db);
    const answerId = "60000000-0000-4000-8000-000000000094";
    await db.query(
      "select public.save_exam_answer($1, $2, $3, 'A', 0)",
      [answerId, attempt.id, questionIds[0]],
    );
    await expireAttempt(db, attempt.id);
    const pending = examSnapshot({
      questionIds,
      answers: [{ id: answerId, selectedOption: "A" }],
      finalize: true,
    });
    const syncId = "70000000-0000-4000-8000-000000000094";
    const result = await sync(db, syncId, 2, pending, attempt.id);
    assert.equal(result.attempt.status, "completed");
    assert.deepEqual(
      { correct: result.summary.correct, wrong: result.summary.wrong, blank: result.summary.blank },
      { correct: 1, wrong: 0, blank: 1 },
    );
    const { rows: [{ draft_count: draftCount }] } = await db.query(
      `select count(*)::integer as draft_count from public.attempt_answers
       where attempt_id = $1 and correct_option is null`,
      [attempt.id],
    );
    assert.equal(draftCount, 1);
    const retried = await sync(db, syncId, 2, pending, attempt.id);
    assert.deepEqual(retried, result);
  } finally {
    await db.close();
  }
});

test("una respuesta rechazada tras el deadline no entra en puntuación ni resultado", async () => {
  const db = await migratedDatabase();
  try {
    const { attempt, questionIds } = await startOfficialExam(db);
    await expireAttempt(db, attempt.id);
    await assert.rejects(
      sync(
        db,
        "70000000-0000-4000-8000-000000000095",
        0,
        examSnapshot({
          questionIds,
          answers: [{ id: "60000000-0000-4000-8000-000000000095", selectedOption: "A" }],
          finalize: true,
        }),
        attempt.id,
      ),
      /deadline.*vencido/i,
    );
    const result = await sync(
      db,
      "70000000-0000-4000-8000-000000000096",
      0,
      examSnapshot({ questionIds, finalize: true }),
      attempt.id,
    );
    assert.deepEqual(
      { correct: result.summary.correct, wrong: result.summary.wrong, blank: result.summary.blank, score: result.summary.score },
      { correct: 0, wrong: 0, blank: 2, score: 0 },
    );
  } finally {
    await db.close();
  }
});
