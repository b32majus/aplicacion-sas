import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Verificación conductual de la frontera de oposición del Examen artificial
// (unidad m03-artificial-oposicion): 75 fuentes homogéneas de una oposición
// pasan en estudio y en examen (120 minutos, deadline absoluto); N=74 se
// bloquea; una fuente mezclada, una sin mapeo y una con versión no publicada
// se rechazan en servidor sin intentos, fuentes, progreso ni respuestas
// parciales; la firma antigua rechaza mezclas y conserva la compatibilidad
// homogénea; la reanudación devuelve la composición fijada entre oposiciones y
// el progreso anota la identidad de pregunta de origen. La segunda oposición
// vive solo en este fixture, aislada de la siembra de producción.

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000041";
const otherUserId = "10000000-0000-4000-8000-000000000042";

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
  await db.query("insert into auth.users(id) values ($1), ($2)", [userId, otherUserId]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  // Segunda oposición solo de fixture: nunca se siembra en la migración de
  // producción, se registra aquí para aislar el rechazo entre bancos.
  await db.query(
    "insert into public.oppositions(id, public_name) values ('radiodiagnostico-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
  );
  return db;
}

function packageData(examId, count) {
  const questionIds = Array.from({ length: count }, (_, index) => (
    `${examId}-q${String(index + 1).padStart(3, "0")}`
  ));
  return {
    examId,
    versionId: `${examId}-version`,
    versionPath: `${examId}/versions/${examId}-version.json`,
    questionIds,
    answerKey: Object.fromEntries(questionIds.map((id) => [id, "B"])),
  };
}

async function registerExam(db, source, { opposition, published = true } = {}) {
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes,
       question_ids, answer_key, is_published
     ) values ($1, $2, $3, 90, $4, $5::jsonb, $6)`,
    [source.examId, source.versionId, source.versionPath, source.questionIds, JSON.stringify(source.answerKey), published],
  );
  if (opposition) {
    await db.query(
      "insert into public.opposition_exams(exam_id, opposition_id) values ($1, $2)",
      [source.examId, opposition],
    );
  }
  return source;
}

function sourceRows(packages) {
  return packages.flatMap((source) => source.questionIds.map((questionId) => ({
    exam_id: source.examId,
    exam_version_id: source.versionId,
    exam_version_path: source.versionPath,
    source_question_id: questionId,
  })));
}

const startV2 = (db, mode, oppositionId, sources) => db.query(
  "select public.start_or_resume_artificial_attempt_v2($1, $2, $3::jsonb) as attempt",
  [mode, oppositionId, JSON.stringify(sources)],
).then(({ rows: [{ attempt }] }) => attempt);

const startLegacy = (db, mode, sources) => db.query(
  "select public.start_or_resume_artificial_attempt($1, $2::jsonb) as attempt",
  [mode, JSON.stringify(sources)],
).then(({ rows: [{ attempt }] }) => attempt);

async function snapshot(db) {
  return {
    attempts: (await db.query("select id, user_id, kind, origin, status from public.attempts order by id")).rows,
    sources: (await db.query(
      "select attempt_id, position, question_id, source_question_id from public.attempt_question_sources order by attempt_id, position",
    )).rows,
    progress: (await db.query(
      "select user_id, exam_id, question_id, correct_count, current_streak from public.question_progress order by user_id, exam_id",
    )).rows,
    answers: (await db.query("select id, attempt_id, question_id from public.attempt_answers order by id")).rows,
  };
}

const artificialAttemptCount = (db, user) => db.query(
  "select count(*)::integer as count from public.attempts where user_id = $1 and origin = 'artificial'",
  [user],
).then(({ rows: [{ count }] }) => count);

test("la RPC v2 acepta 75 fuentes homogéneas y bloquea cortas, mezcladas, sin mapeo y extrínsecas sin rastro", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, packageData("art-admin-a", 40), { opposition: "administrativo" });
    const adminB = await registerExam(db, packageData("art-admin-b", 40), { opposition: "administrativo" });
    const rx = await registerExam(db, packageData("art-rx-fixture", 75), { opposition: "radiodiagnostico-fixture" });
    const unpublished = await registerExam(db, packageData("art-admin-unpublished", 1), { opposition: "administrativo", published: false });
    const unmapped = await registerExam(db, packageData("art-sin-mapeo", 1));

    const adminSeventyFive = [...sourceRows([adminA]), ...sourceRows([adminB]).slice(0, 35)];
    assert.equal(adminSeventyFive.length, 75);
    const mixed = [...adminSeventyFive.slice(0, 74), sourceRows([rx])[0]];
    const duplicated = [...adminSeventyFive.slice(0, 74), { ...adminSeventyFive[0] }];
    const extrinsicVersion = [...adminSeventyFive.slice(0, 74), {
      exam_id: adminA.examId,
      exam_version_id: "version-no-publicada",
      exam_version_path: `${adminA.examId}/versions/version-no-publicada.json`,
      source_question_id: adminA.questionIds[39],
    }];
    const withUnmapped = [...adminSeventyFive.slice(0, 74), sourceRows([unmapped])[0]];

    const baseline = await snapshot(db);

    // N=74 se bloquea: no se completa con otro banco ni se duplican preguntas.
    await assert.rejects(
      startV2(db, "study", "administrativo", adminSeventyFive.slice(0, 74)),
      /exactamente 75/i,
      "con 74 fuentes el inicio se bloquea",
    );
    // Una fuente de otra oposición impide materializar nada (fallo cerrado).
    await assert.rejects(
      startV2(db, "study", "administrativo", mixed),
      /oposición/i,
      "una fuente RX manipulada en una selección Administrativo se rechaza",
    );
    // 75 referencias con una duplicada son inválidas aunque oposición y versión
    // sean correctas.
    await assert.rejects(
      startV2(db, "study", "administrativo", duplicated),
      /repetir una referencia/i,
      "la selección no puede repetir una referencia",
    );
    // Una fuente con versión no publicada se rechaza.
    await assert.rejects(
      startV2(db, "study", "administrativo", extrinsicVersion),
      /actualmente publicad/i,
      "una fuente con versión no publicada se rechaza",
    );
    // Una fuente publicada pero sin fila de mapeo administrativo se rechaza.
    await assert.rejects(
      startV2(db, "study", "administrativo", withUnmapped),
      /oposición/i,
      "una fuente publicada sin mapeo a la oposición solicitada se rechaza",
    );
    // La oposición solicitada debe existir en el registro.
    await assert.rejects(
      startV2(db, "study", "oposicion-inexistente", adminSeventyFive),
      /oposición solicitada/i,
      "una oposición no registrada falla cerrado",
    );
    await assert.rejects(
      startV2(db, "study", null, adminSeventyFive),
      /oposición solicitada no es válida/i,
      "una oposición nula no crea nada",
    );

    assert.deepEqual(
      await snapshot(db),
      baseline,
      "ningún rechazo deja intentos, fuentes, progreso ni respuestas parciales",
    );

    // 75 fuentes homogéneas pasan y fijan su composición con identidad de origen.
    const attempt = await startV2(db, "study", "administrativo", adminSeventyFive);
    assert.equal(attempt.origin, "artificial");
    assert.equal(attempt.kind, "normal");
    assert.equal(attempt.strategy, "artificial_study");
    assert.equal(attempt.duration_minutes, null);
    assert.equal(attempt.question_ids.length, 75);
    assert.deepEqual(
      attempt.question_ids,
      Array.from({ length: 75 }, (_, index) => `artificial-q${String(index + 1).padStart(3, "0")}`),
    );
    const { rows: materialized } = await db.query(
      "select position, exam_id, question_id, source_question_id from public.attempt_question_sources where attempt_id = $1 order by position",
      [attempt.id],
    );
    assert.equal(materialized.length, 75);
    assert.equal(new Set(materialized.map(({ question_id: id }) => id)).size, 75);
    assert.deepEqual(
      materialized.map(({ position, exam_id: examId, source_question_id: questionId }) => ({
        position, exam_id: examId, source_question_id: questionId,
      })),
      adminSeventyFive.map(({ exam_id: examId, source_question_id: questionId }, position) => ({
        position, exam_id: examId, source_question_id: questionId,
      })),
    );
    assert.equal(await artificialAttemptCount(db, userId), 1);

    // La oposición válida solicitada genera su propio artificial con su banco:
    // se solicita desde otro usuario, sin intento artificial activo que la
    // reanudación fijada devuelva antes de la verificación.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [otherUserId]);
    const rxAttempt = await startV2(db, "study", "radiodiagnostico-fixture", sourceRows([rx]));
    assert.equal(rxAttempt.origin, "artificial");
    const { rows: [{ rx_count: rxCount }] } = await db.query(
      `select count(*)::integer as rx_count from public.attempt_question_sources source
       join public.opposition_exams mapping on mapping.exam_id = source.exam_id
       where source.attempt_id = $1 and mapping.opposition_id = 'radiodiagnostico-fixture'`,
      [rxAttempt.id],
    );
    assert.equal(rxCount, 75, "el artificial de la segunda oposición se genera solo con su banco");
    assert.equal(await artificialAttemptCount(db, otherUserId), 1);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  } finally {
    await db.close();
  }
});

test("la reanudación precede a toda verificación y el progreso anota la identidad de origen", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, packageData("resume-admin-a", 40), { opposition: "administrativo" });
    const adminB = await registerExam(db, packageData("resume-admin-b", 40), { opposition: "administrativo" });
    await registerExam(db, packageData("resume-rx-fixture", 75), { opposition: "radiodiagnostico-fixture" });
    const adminSeventyFive = [...sourceRows([adminA]), ...sourceRows([adminB]).slice(0, 35)];

    const attempt = await startV2(db, "study", "administrativo", adminSeventyFive);
    const afterCreation = await snapshot(db);

    // Reanudación fijada aunque se cambie de oposición o la selección llegue
    // vacía o corta: la composición persistida no se re-materializa.
    const crossOpposition = await startV2(db, "study", "radiodiagnostico-fixture", []);
    assert.equal(crossOpposition.id, attempt.id, "la reanudación devuelve el intento fijado");
    assert.deepEqual(crossOpposition.question_ids, attempt.question_ids, "la composición persistida no se re-materializa");
    const shortSelection = await startV2(db, "study", "administrativo", adminSeventyFive.slice(0, 20));
    assert.equal(shortSelection.id, attempt.id);
    const nullSelection = await startV2(db, "study", null, []);
    assert.equal(nullSelection.id, attempt.id);

    assert.equal(await artificialAttemptCount(db, userId), 1, "la reanudación no crea intentos adicionales");
    assert.deepEqual(
      await snapshot(db),
      afterCreation,
      "la reanudación no altera intentos, fuentes, progreso ni respuestas",
    );

    // La identidad de pregunta de origen se conserva al actualizar progreso.
    await db.query(
      "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
      ["20000000-0000-4000-8000-000000000041", attempt.id, attempt.question_ids[2]],
    );
    const { rows: progressRows } = await db.query(
      "select exam_id, question_id, correct_count, current_streak from public.question_progress where user_id = $1",
      [userId],
    );
    const { rows: sourceRowsForPosition } = await db.query(
      "select exam_id, source_question_id from public.attempt_question_sources where attempt_id = $1 and question_id = $2",
      [attempt.id, attempt.question_ids[2]],
    );
    assert.deepEqual(progressRows, [{
      exam_id: sourceRowsForPosition[0].exam_id,
      question_id: sourceRowsForPosition[0].source_question_id,
      correct_count: 1,
      current_streak: 1,
    }], "el progreso se anota con la identidad de pregunta de origen, no con la artificial");
    assert.ok(!progressRows.some(({ question_id: id }) => id.startsWith("artificial-q")));
  } finally {
    await db.close();
  }
});

test("el Modo examen artificial conserva 120 minutos con deadline absoluto y reanuda fijado entre oposiciones", async () => {
  const db = await migratedDatabase();
  try {
    const adminExam = await registerExam(db, packageData("exam-mode-admin", 80), { opposition: "administrativo" });
    const sources = sourceRows([adminExam]).slice(0, 75);

    const started = await startV2(db, "exam", "administrativo", sources);
    assert.equal(started.kind, "exam");
    assert.equal(started.origin, "artificial");
    assert.equal(started.strategy, "artificial_exam");
    assert.equal(started.duration_minutes, 120, "los 120 minutos del artificial se conservan");
    assert.equal(Date.parse(started.deadline_at) - Date.parse(started.started_at), 120 * 60_000, "deadline absoluto desde el inicio");
    {
      const { rows: [{ count: examCount }] } = await db.query(
        "select count(*)::integer as count from public.attempts where user_id = $1 and kind = 'exam' and status = 'active'",
        [userId],
      );
      assert.equal(examCount, 1, "no se crean intentos de examen adicionales");
    }

    // La reanudación del examen artificial no depende de la oposición
    // solicitada y el deadline fijado no se recalcula.
    const crossOpposition = await startV2(db, "exam", "radiodiagnostico-fixture", []);
    assert.equal(crossOpposition.id, started.id);
    assert.deepEqual(crossOpposition.question_ids, started.question_ids);
    assert.equal(Date.parse(crossOpposition.deadline_at), Date.parse(started.deadline_at));
    const shortSelection = await startV2(db, "exam", "administrativo", sources.slice(0, 74));
    assert.equal(shortSelection.id, started.id, "con una selección corta el examen activo se reanuda igual");

    // La firma antigua también reanuda el único Modo examen artificial activo.
    const legacyResumed = await startLegacy(db, "exam", sources);
    assert.equal(legacyResumed.id, started.id);
    assert.equal(Date.parse(legacyResumed.deadline_at), Date.parse(started.deadline_at));
  } finally {
    await db.close();
  }
});

test("la firma antigua conserva la compatibilidad homogénea y rechaza la mezcla y las fuentes sin mapeo", async () => {
  const db = await migratedDatabase();
  try {
    const adminA = await registerExam(db, packageData("legacy-admin-a", 40), { opposition: "administrativo" });
    const adminB = await registerExam(db, packageData("legacy-admin-b", 40), { opposition: "administrativo" });
    const rx = await registerExam(db, packageData("legacy-rx-fixture", 75), { opposition: "radiodiagnostico-fixture" });
    const unmapped = await registerExam(db, packageData("legacy-sin-mapeo", 1));
    const adminSeventyFive = [...sourceRows([adminA]), ...sourceRows([adminB]).slice(0, 35)];
    const mixed = [...adminSeventyFive.slice(0, 74), sourceRows([rx])[0]];
    const withUnmapped = [...adminSeventyFive.slice(0, 74), sourceRows([unmapped])[0]];

    // Selección homogénea existente: sigue funcionando por la firma antigua.
    const attempt = await startLegacy(db, "study", adminSeventyFive);
    assert.equal(attempt.origin, "artificial");
    assert.equal(attempt.strategy, "artificial_study");
    assert.equal(attempt.question_ids.length, 75);
    const legacyResumed = await startLegacy(db, "study", adminSeventyFive);
    assert.equal(legacyResumed.id, attempt.id, "la firma antigua reanuda el único intento artificial activo fijado");
    assert.equal(await artificialAttemptCount(db, userId), 1);

    // Otro usuario: la firma antigua tampoco materializa una mezcla ni fuentes
    // sin mapeo, y no deja rastro.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [otherUserId]);
    const otherBaseline = await snapshot(db);
    await assert.rejects(
      startLegacy(db, "study", mixed),
      /oposición/i,
      "la firma antigua tampoco crea un artificial mezclado",
    );
    await assert.rejects(
      startLegacy(db, "study", withUnmapped),
      /oposición/i,
      "la firma antigua rechaza la selección con fuentes sin mapeo",
    );
    await assert.rejects(
      startLegacy(db, "study", adminSeventyFive.slice(0, 74)),
      /exactamente 75|oposición|publicad/i,
      "la firma antigua delega en la RPC v2 los límites de forma",
    );
    assert.equal(await artificialAttemptCount(db, otherUserId), 0);
    assert.deepEqual(await snapshot(db), otherBaseline, "los rechazos de la firma antigua no dejan rastro");
  } finally {
    await db.close();
  }
});

test("la RPC v2 y la firma antigua conservan sus privilegios y exigen autenticación", async () => {
  const db = await migratedDatabase();
  try {
    const { rows: [privileges] } = await db.query(`select
      has_function_privilege('authenticated', 'public.start_or_resume_artificial_attempt_v2(text, text, jsonb)', 'execute') as auth_v2,
      has_function_privilege('anon', 'public.start_or_resume_artificial_attempt_v2(text, text, jsonb)', 'execute') as anon_v2,
      has_function_privilege('authenticated', 'public.start_or_resume_artificial_attempt(text, jsonb)', 'execute') as auth_legacy,
      has_function_privilege('anon', 'public.start_or_resume_artificial_attempt(text, jsonb)', 'execute') as anon_legacy`);
    assert.deepEqual(privileges, {
      auth_v2: true,
      anon_v2: false,
      auth_legacy: true,
      anon_legacy: false,
    }, "la v2 y la firma antigua se ejecutan solo por authenticated");

    const adminA = await registerExam(db, packageData("auth-admin", 75), { opposition: "administrativo" });
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(
      startV2(db, "study", "administrativo", sourceRows([adminA])),
      /autenticación/i,
      "la RPC v2 exige autenticación",
    );
    await assert.rejects(
      startLegacy(db, "study", sourceRows([adminA])),
      /autenticación/i,
      "la firma antigua conserva su exigencia de autenticación",
    );
    assert.equal(await artificialAttemptCount(db, userId), 0);
  } finally {
    await db.close();
  }
});
