// Oráculo Metis · unidad m02-falladas-oposicion
// Contrato: «Todas mis falladas» materializa únicamente la oposición seleccionada
// (recuentos y fuentes), la migración nueva endurece el inicio/materialización de
// falladas en el servidor (oposición homogénea, correspondencia administrativa y
// fuentes publicadas exactas, antes de crear el intento o sus fuentes), la firma
// antigua no permite sesiones mezcladas conservando la compatibilidad homogénea,
// la reanudación devuelve la única sesión activa fijada aunque se cambie de
// oposición, y no se tocan progreso, respuestas, scoring, sincronización ni
// histórico.
//
// El oráculo no usa dependencias externas (el entorno de verificación ejecuta los
// witnesses sobre una copia limpia del checkout, sin node_modules): el contrato
// SQL se verifica de forma estructural sobre el archivo de migración y el
// contrato de frontend sobre el recorrido de falladas de app.js. La verificación
// conductual con PostgreSQL embebido se ejecuta solo si el entorno dispone de
// node_modules (la suite general del repositorio la cubre con npm test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const migrationsUrl = new URL("../../supabase/migrations/", import.meta.url);
const migrationName = "20261113091000_failed_opposition_boundary.sql";
const appSourceUrl = new URL("../../app/src/app.js", import.meta.url);

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  // Copia limpia sin node_modules: la parte conductual se omite y la cobertura
  // conductual corresponde a la suite general del repositorio (npm test).
}

function stripSqlComments(sql) {
  return sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
}

async function readMigration() {
  try {
    const raw = await readFile(new URL(migrationName, migrationsUrl), "utf8");
    return { raw, sql: stripSqlComments(raw) };
  } catch {
    return null;
  }
}

function functionStatement(sql, name) {
  const match = sql.match(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i"));
  if (!match) return null;
  const end = sql.indexOf("$$;", match.index);
  return sql.slice(match.index, end === -1 ? sql.length : end + 3);
}

test("la migración nueva crea la RPC v2 de falladas con la frontera de oposición antes de materializar", async () => {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con la frontera multioposición de las falladas (forward-only).`);
  }
  assert.match(migration.raw, /--\s*[^\n]*oposición/i, "la migración debe explicar su operativa en español");
  const sql = migration.sql;

  const v2 = functionStatement(sql, "start_or_resume_failed_attempt_v2");
  assert.ok(v2, "falta la RPC v2 public.start_or_resume_failed_attempt_v2");
  assert.match(v2, /p_opposition_id\s+text/i, "la RPC v2 debe recibir la oposición solicitada");
  assert.match(v2, /p_scope_exam_id\s+text/i, "la RPC v2 debe recibir el ámbito de examen");
  assert.match(v2, /p_sources\s+jsonb/i, "la RPC v2 debe recibir la cola de fuentes");

  const bodyIndex = v2.indexOf("$$");
  const body = v2.slice(bodyIndex);

  // Reanudación precede a toda verificación: la única sesión activa devuelve sus
  // fuentes y versiones fijadas aunque se cambie de oposición.
  const resumeMatch = body.match(/from\s+public\.attempts[\s\S]{0,400}?kind\s*=\s*'failed'[\s\S]{0,200}?for\s+update/i);
  assert.ok(resumeMatch, "la RPC v2 debe reanudar la única sesión activa fijada por usuario");
  const resumeIndex = resumeMatch.index;

  // Verificación en servidor antes de crear el intento o sus fuentes.
  const oppositionIndex = body.search(/opposition_exams/i);
  const registryIndex = body.search(/official_exam_versions/i);
  assert.ok(oppositionIndex > -1, "la RPC v2 debe verificar el mapeo administrativo (opposition_exams)");
  assert.ok(registryIndex > -1, "la RPC v2 debe verificar las fuentes publicadas exactas");
  assert.match(body, /is_published/i, "la verificación debe exigir fuentes actualmente publicadas");
  assert.match(body, /opposition_id\s*=\s*p_opposition_id/i, "cada fuente debe corresponder a la oposición solicitada según el mapeo del servidor");
  const firstInsert = body.search(/insert\s+into\s+public\.attempts\b/i);
  const sourcesInsert = body.search(/insert\s+into\s+public\.attempt_question_sources\b/i);
  assert.ok(firstInsert > -1 && sourcesInsert > -1, "la RPC v2 debe crear el intento y sus fuentes");
  assert.ok(oppositionIndex < firstInsert, "la verificación de oposición homogénea precede a la creación del intento");
  assert.ok(registryIndex < firstInsert, "la verificación de fuentes publicadas precede a la creación del intento");
  assert.ok(oppositionIndex < sourcesInsert, "la verificación de oposición homogénea precede a la creación de las fuentes");
  assert.ok(resumeIndex < oppositionIndex, "la reanudación fijada precede a la verificación de la cola");

  // Guard global y cola de falladas conservados.
  assert.match(body, /reject_study_interaction_during_active_exam/i, "el guard del Modo examen activo se conserva");
  assert.match(body, /question_progress[\s\S]{0,300}pending_failure/i, "la cola sigue exigir que las preguntas sigan pendientes");

  const revokeMatch = sql.match(/revoke\s+all[^;]*start_or_resume_failed_attempt_v2/i);
  assert.ok(revokeMatch, "la RPC v2 debe revocarse para public/anon/authenticated antes de concederse");
  const revokeStatement = sql.slice(revokeMatch.index, sql.indexOf(";", revokeMatch.index));
  assert.match(revokeStatement, /anon/i);
  const grantMatch = sql.match(/grant\s+execute[^;]*start_or_resume_failed_attempt_v2/i);
  assert.ok(grantMatch, "la RPC v2 debe concederse a authenticated");
  assert.match(sql.slice(grantMatch.index, sql.indexOf(";", grantMatch.index)), /to\s+authenticated/i);
});

test("la migración endurece la firma antigua de falladas sin permitir sesiones mezcladas", async () => {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con la frontera multioposición de las falladas (forward-only).`);
  }
  const sql = migration.sql;

  const legacy = functionStatement(sql, "start_or_resume_failed_attempt");
  assert.ok(legacy, "la firma antigua start_or_resume_failed_attempt(ámbito, fuentes) debe seguir operativa");
  assert.match(legacy, /p_scope_exam_id\s+text/i, "la firma antigua conserva el parámetro de ámbito");
  assert.match(legacy, /p_sources\s+jsonb/i, "la firma antigua conserva el parámetro de fuentes");
  assert.ok(
    /opposition_exams/i.test(legacy) || /start_or_resume_failed_attempt_v2/i.test(legacy),
    "la firma antigua debe verificar la oposición única (mapeo administrativo) o delegar en la RPC v2",
  );

  const legacyGrant = sql.match(/grant\s+execute[^;]*start_or_resume_failed_attempt\s*\(\s*text/i);
  assert.ok(legacyGrant, "la firma antigua conserva su privilegio authenticated (compatibilidad con frontend antiguo)");
  assert.match(sql.slice(legacyGrant.index, sql.indexOf(";", legacyGrant.index)), /to\s+authenticated/i);
});

test("la migración es forward-only y no reinterpreta histórico, progreso, respuestas, scoring ni sincronización", async () => {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con la frontera multioposición de las falladas (forward-only).`);
  }
  const sql = migration.sql;

  assert.doesNotMatch(sql, /drop\s+(table|function|index|constraint|trigger|policy)\b/i, "la migración no debe destruir objetos");
  assert.doesNotMatch(sql, /alter\s+table\b/i, "la migración no debe redefinir el esquema existente");
  assert.doesNotMatch(sql, /update\s+public\./i, "la migración no debe modificar filas existentes");
  assert.doesNotMatch(sql, /delete\s+from\s+public\./i, "la migración no debe eliminar filas existentes");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.official_exam_versions\b/i, "la migración no debe tocar el registro oficial");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.question_progress\b/i, "la migración no debe tocar el progreso");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.attempt_answers\b/i, "la migración no debe tocar las respuestas");
  for (const protectedFunction of [
    "apply_principal_answer", "finish_principal_attempt", "confirm_normal_answer", "complete_normal_attempt",
    "confirm_failed_answer", "complete_failed_attempt", "save_normal_attempt", "save_exam_answer",
    "sync_active_attempt", "start_or_replace_principal_attempt", "start_or_resume_exam_attempt",
    "finish_exam_attempt", "start_or_resume_artificial_attempt", "confirm_artificial_study_answer",
    "complete_artificial_study_attempt", "finish_artificial_exam_attempt", "apply_artificial_question_progress",
    "calculate_official_exam_score", "get_dashboard", "get_published_official_exam_versions",
    "get_published_official_exam_versions_v2", "reject_study_interaction_during_active_exam",
    "verify_official_study_answer_key",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${protectedFunction}\\b`, "i"),
      `la migración no debe redefinir public.${protectedFunction}`,
    );
  }
});

test("la ruta de falladas materializa la oposición seleccionada y conserva la recuperación fijada", async () => {
  const source = await readFile(appSourceUrl, "utf8");

  const failedStart = source.indexOf("async function startFailedStudy");
  assert.ok(failedStart > -1, "app.js conserva el recorrido de falladas");
  const failedSource = source.slice(failedStart, source.indexOf("\nfunction renderNavigation()", failedStart));

  assert.match(failedSource, /start_or_resume_failed_attempt_v2/, "el recorrido de falladas usa la RPC v2");
  assert.match(failedSource, /selectedOppositionId/, "el recorrido de falladas declara la oposición seleccionada");
  assert.match(failedSource, /p_scope_exam_id/, "Solo falladas de un examen sigue enviando su ámbito");
  assert.match(failedSource, /persistence\??\.restore\(\{\s*kind:\s*"failed"\s*\}\)/, "la recuperación tras error de red conserva la sesión fijada");
  assert.match(failedSource, /confirmationRetryAvailable = true/, "el reintento tras error de red conserva la disponibilidad de confirmaciones");

  const eligibleStart = source.indexOf("function eligibleFailureSources");
  assert.ok(eligibleStart > -1, "app.js conserva la función de recuentos y cola de falladas");
  const eligibleSource = source.slice(eligibleStart, source.indexOf("\nasync function refreshStatuses()", eligibleStart));
  assert.match(eligibleSource, /scopeExamId/, "Solo falladas conserva su ámbito por examen");
  assert.match(eligibleSource, /pendingFailures/, "la cola sigue derivarse del progreso de falladas pendientes");
  assert.match(eligibleSource, /selectedOppositionId/, "sin ámbito, el recuento y la cola proceden de la oposición seleccionada");

  const catalogStart = source.indexOf("function renderCatalog()");
  const catalogSource = source.slice(catalogStart, source.indexOf("\nasync function selectExam", catalogStart));
  assert.match(catalogSource, /eligibleFailureSources\(\)/, "el recuento de Todas mis falladas se deriva de la cola de la oposición seleccionada");

  const selectExamStart = source.indexOf("async function selectExam");
  const selectExamSource = source.slice(selectExamStart, source.indexOf("\nfunction normalizeRow", selectExamStart));
  assert.match(selectExamSource, /eligibleFailureSources\(exam\.id\)/, "el recuento por examen se deriva de su ámbito");

  // Superficies de M01 conservadas (catálogo completo separado de la proyección).
  assert.match(source, /filterCatalogByOpposition/, "el catálogo autorizado completo sigue disponible con su proyección por oposición");
  assert.match(source, /listPublishedOppositions/, "el selector de oposiciones de M01 se conserva");
  assert.match(source, /"opposition-select"/, "el control de selección de oposición se conserva");
});

const behavioralOptions = PGlite ? {} : {
  skip: "el entorno de verificación no instala node_modules; la verificación conductual con PostgreSQL embebido corresponde a la suite general (npm test)",
};

test("el servidor acepta fuentes homogéneas, rechaza una fuente de otra oposición sin rastro y reanuda la sesión fijada", { skip: behavioralOptions.skip }, async () => {
  const userId = "10000000-0000-4000-8000-000000000031";
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    const migrationNames = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrationNames) await db.exec(await readFile(new URL(name, migrationsUrl), "utf8"));
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    // Segunda oposición solo de fixture, aislada de producción.
    await db.query(
      "insert into public.oppositions(id, public_name) values ('radiodiagnostico-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
    );
    const registerExam = async (examId, questionId, opposition) => {
      const versionId = `${examId}-version`;
      const versionPath = `${examId}/versions/${versionId}.json`;
      await db.query(
        `insert into public.official_exam_versions(
           exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key, is_published
         ) values ($1, $2, $3, 90, $4, $5::jsonb, true)`,
        [examId, versionId, versionPath, [questionId], JSON.stringify({ [questionId]: "B" })],
      );
      if (opposition) {
        await db.query("insert into public.opposition_exams(exam_id, opposition_id) values ($1, $2)", [examId, opposition]);
      }
      return { exam_id: examId, exam_version_id: versionId, exam_version_path: versionPath, question_id: questionId };
    };
    const adminA = await registerExam("oracle-admin-a", "oracle-admin-a-q001", "administrativo");
    const adminB = await registerExam("oracle-admin-b", "oracle-admin-b-q001", "administrativo");
    const rxFixture = await registerExam("oracle-rx-fixture", "oracle-rx-fixture-q001", "radiodiagnostico-fixture");
    for (const source of [adminA, adminB, rxFixture]) {
      await db.query(
        `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
         values ($1, $2, $3, 1, true)`,
        [userId, source.exam_id, source.question_id],
      );
    }

    const snapshot = async () => ({
      attempts: (await db.query("select id, exam_id, status from public.attempts order by id")).rows,
      sources: (await db.query("select attempt_id, position, question_id from public.attempt_question_sources order by attempt_id, position")).rows,
      progress: (await db.query("select exam_id, question_id, correct_count, wrong_count, current_streak, mastered, pending_failure from public.question_progress order by exam_id, question_id")).rows,
      answers: (await db.query("select * from public.attempt_answers order by id")).rows,
    });

    const baseline = await snapshot();

    // Una fuente de otra oposición (y la mezcla por la firma antigua) se rechaza
    // en servidor sin cambios en intentos, fuentes, progreso o respuestas.
    const mixed = [adminA, { ...rxFixture }];
    await assert.rejects(
      db.query("select (public.start_or_resume_failed_attempt_v2($1, $2, $3::jsonb)).*", ["administrativo", null, JSON.stringify(mixed)]),
      /oposición/,
      "una fuente RX manipulada en una cola Administrativo se rechaza",
    );
    await assert.rejects(
      db.query("select (public.start_or_resume_failed_attempt($1, $2::jsonb)).*", [null, JSON.stringify(mixed)]),
      /oposición/,
      "la firma antigua tampoco permite crear una sesión mezclada",
    );
    assert.deepEqual(await snapshot(), baseline, "el rechazo no deja rastro en intentos, fuentes, progreso o respuestas");

    // Dos fuentes Administrativo válidas pasan.
    const attempt = (await db.query(
      "select (public.start_or_resume_failed_attempt_v2($1, $2, $3::jsonb)).*",
      ["administrativo", null, JSON.stringify([adminA, adminB])],
    )).rows[0];
    assert.equal(attempt.kind, "failed");
    assert.equal((await snapshot()).sources.length, 2, "el intento y sus fuentes se crean con la cola homogénea");
    const afterCreation = await snapshot();

    // Reanudación fijada aunque se cambie de oposición.
    const resumed = (await db.query(
      "select (public.start_or_resume_failed_attempt_v2($1, $2, $3::jsonb)).*",
      ["radiodiagnostico-fixture", null, JSON.stringify([])],
    )).rows[0];
    assert.equal(resumed.id, attempt.id, "la reanudación devuelve la única sesión activa fijada");
    assert.deepEqual(resumed.question_ids, attempt.question_ids, "la reanudación conserva sus fuentes y versiones fijadas");
    assert.equal(
      (await db.query("select count(*)::integer as count from public.attempts where user_id = $1 and kind = 'failed'", [userId])).rows[0].count,
      1,
      "no se crea ninguna sesión adicional",
    );
    assert.deepEqual(await snapshot(), afterCreation, "la reanudación no altera intentos, fuentes, progreso o respuestas");
  } finally {
    await db.close();
  }
});
