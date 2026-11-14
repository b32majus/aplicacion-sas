import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Verificación conductual de la frontera de oposición de las Sesiones de
// falladas (unidad m02-falladas-oposicion): dos fuentes Administrativo válidas
// pasan; una fuente RX manipulada se rechaza en servidor sin cambios en
// intentos, fuentes, progreso ni respuestas; la firma antigua rechaza la mezcla
// y conserva la compatibilidad homogénea; la reanudación devuelve la sesión
// fijada entre oposiciones; las fuentes no publicadas siguen rechazándose; los
// reintentos idénticos no crean sesiones extra. La segunda oposición vive solo
// en este fixture, aislada de la siembra de producción.

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000033";

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
  // Segunda oposición solo de fixture: nunca se siembra en la migración de
  // producción, se registra aquí para aislar el rechazo entre bancos.
  await db.query(
    "insert into public.oppositions(id, public_name) values ('radiodiagnostico-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
  );
  return db;
}

async function registerExam(db, examId, questionId, { opposition, published = true } = {}) {
  const versionId = `${examId}-version`;
  const versionPath = `${examId}/versions/${versionId}.json`;
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes,
       question_ids, answer_key, is_published
     ) values ($1, $2, $3, 90, $4, $5::jsonb, $6)`,
    [examId, versionId, versionPath, [questionId], JSON.stringify({ [questionId]: "B" }), published],
  );
  if (opposition) {
    await db.query(
      "insert into public.opposition_exams(exam_id, opposition_id) values ($1, $2)",
      [examId, opposition],
    );
  }
  return { exam_id: examId, exam_version_id: versionId, exam_version_path: versionPath, question_id: questionId };
}

async function queuePending(db, source) {
  await db.query(
    `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
     values ($1, $2, $3, 1, true)`,
    [userId, source.exam_id, source.question_id],
  );
}

async function snapshot(db) {
  return {
    attempts: (await db.query("select id, exam_id, status from public.attempts order by id")).rows,
    sources: (await db.query(
      "select attempt_id, position, exam_id, question_id from public.attempt_question_sources order by attempt_id, position",
    )).rows,
    progress: (await db.query(
      `select exam_id, question_id, correct_count, wrong_count, current_streak, mastered, pending_failure
       from public.question_progress order by exam_id, question_id`,
    )).rows,
    answers: (await db.query("select id, attempt_id, question_id from public.attempt_answers order by id")).rows,
  };
}

const startV2 = (db, oppositionId, scopeExamId, sources) => db.query(
  "select (public.start_or_resume_failed_attempt_v2($1, $2, $3::jsonb)).*",
  [oppositionId, scopeExamId, JSON.stringify(sources)],
);

const startLegacy = (db, scopeExamId, sources) => db.query(
  "select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*",
  [scopeExamId, JSON.stringify(sources)],
);

const failedSessionCount = (db) => db.query(
  "select count(*)::integer as count from public.attempts where user_id = $1 and kind = 'failed'",
  [userId],
).then(({ rows: [{ count }] }) => count);

test("la RPC v2 acepta fuentes homogéneas de la oposición solicitada y rechaza otra oposición sin rastro", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, "multi-admin-a", "multi-admin-a-q001", { opposition: "administrativo" });
    const adminB = await registerExam(db, "multi-admin-b", "multi-admin-b-q001", { opposition: "administrativo" });
    const rx = await registerExam(db, "multi-rx-fixture", "multi-rx-q001", { opposition: "radiodiagnostico-fixture" });
    const unmapped = await registerExam(db, "multi-unmapped", "multi-unmapped-q001");
    for (const source of [adminA, adminB, rx, unmapped]) await queuePending(db, source);

    const baseline = await snapshot(db);

    await assert.rejects(
      startV2(db, "administrativo", null, [adminA, rx]),
      /oposición/,
      "una fuente RX manipulada en una cola Administrativo se rechaza",
    );
    await assert.rejects(
      startV2(db, "administrativo", null, [adminA, unmapped]),
      /oposición|mapeo/i,
      "una fuente publicada sin fila de mapeo se rechaza sin crear sesiones",
    );
    await assert.rejects(
      startV2(db, "administrativo", rx.exam_id, [adminA]),
      /oposición/,
      "un ámbito de otra oposición se rechaza",
    );
    await assert.rejects(
      startLegacy(db, null, [adminA, rx]),
      /oposición/,
      "la firma antigua tampoco permite crear una sesión mezclada",
    );
    assert.deepEqual(
      await snapshot(db),
      baseline,
      "los rechazos no dejan rastro en intentos, fuentes, progreso o respuestas",
    );

    // Dos fuentes Administrativo válidas pasan y materializan la cola completa.
    const attempt = (await startV2(db, "administrativo", null, [adminA, adminB])).rows[0];
    assert.equal(attempt.kind, "failed");
    assert.equal(attempt.failed_scope_exam_id, null);
    assert.deepEqual(attempt.question_ids, [adminA.question_id, adminB.question_id]);
    const afterCreation = await snapshot(db);
    assert.equal(afterCreation.sources.length, 2);
    assert.equal(await failedSessionCount(db), 1);
  } finally {
    await db.close();
  }
});

test("los reintentos idénticos reanudan la sesión fijada entre oposiciones sin crear sesiones extra", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, "retry-admin-a", "retry-admin-a-q001", { opposition: "administrativo" });
    const adminB = await registerExam(db, "retry-admin-b", "retry-admin-b-q001", { opposition: "administrativo" });
    for (const source of [adminA, adminB]) await queuePending(db, source);

    const attempt = (await startV2(db, "administrativo", null, [adminA, adminB])).rows[0];
    const afterCreation = await snapshot(db);

    const retried = (await startV2(db, "administrativo", null, [adminA, adminB])).rows[0];
    assert.equal(retried.id, attempt.id);
    const legacyResumed = (await startLegacy(db, null, [adminA, adminB])).rows[0];
    assert.equal(legacyResumed.id, attempt.id);
    assert.deepEqual(await snapshot(db), afterCreation, "los reintentos idénticos no alteran nada");

    // La reanudación fijada precede a toda verificación: otra oposición y una
    // cola vacía devuelven la misma sesión con sus fuentes y versiones fijadas.
    const crossOpposition = (await startV2(db, "radiodiagnostico-fixture", null, [])).rows[0];
    assert.equal(crossOpposition.id, attempt.id);
    assert.deepEqual(crossOpposition.question_ids, attempt.question_ids);
    assert.deepEqual(crossOpposition.exam_version_id, attempt.exam_version_id);
    assert.deepEqual(await snapshot(db), afterCreation);
    assert.equal(await failedSessionCount(db), 1, "no se crea ninguna sesión adicional");
  } finally {
    await db.close();
  }
});

test("la firma antigua conserva la compatibilidad homogénea y las fuentes no publicadas siguen rechazándose", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, "legacy-admin-a", "legacy-admin-a-q001", { opposition: "administrativo" });
    const adminB = await registerExam(db, "legacy-admin-b", "legacy-admin-b-q001", { opposition: "administrativo" });
    for (const source of [adminA, adminB]) await queuePending(db, source);

    // Cola homogénea existente con ámbito: sigue funcionando por la firma antigua.
    const attempt = (await startLegacy(db, adminA.exam_id, [adminA])).rows[0];
    assert.equal(attempt.kind, "failed");
    assert.equal(attempt.failed_scope_exam_id, adminA.exam_id);
    const resumed = (await startLegacy(db, adminA.exam_id, [])).rows[0];
    assert.equal(resumed.id, attempt.id, "la firma antigua reanuda la única sesión activa fijada");

    await db.query(
      "select public.confirm_failed_answer($1, $2, $3, 'B', 'B')",
      ["20000000-0000-4000-8000-000000000031", attempt.id, adminA.question_id],
    );
    await db.query("select public.complete_failed_attempt($1)", [attempt.id]);

    // Sin sesión activa, una fuente no publicada se rechaza en servidor.
    await db.query(
      "update public.official_exam_versions set is_published = false where exam_id = $1",
      [adminB.exam_id],
    );
    await assert.rejects(
      startV2(db, "administrativo", null, [adminB]),
      /actualmente publicadas/,
      "la RPC v2 rechaza una fuente no publicada",
    );
    await assert.rejects(
      startLegacy(db, adminB.exam_id, [adminB]),
      /actualmente publicadas/,
      "la firma antigua también rechaza una fuente no publicada",
    );
    assert.equal(await failedSessionCount(db), 1, "los rechazos no crean sesiones adicionales");
  } finally {
    await db.close();
  }
});

test("la RPC v2 y la firma antigua exigen autenticación", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, "auth-admin", "auth-admin-q001", { opposition: "administrativo" });
    await queuePending(db, adminA);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(
      startV2(db, "administrativo", null, [adminA]),
      /autenticación/i,
      "la RPC v2 exige autenticación",
    );
    await assert.rejects(
      startLegacy(db, adminA.exam_id, [adminA]),
      /autenticación/i,
      "la firma antigua conserva su exigencia de autenticación",
    );
    assert.equal(await failedSessionCount(db), 0);
  } finally {
    await db.close();
  }
});
