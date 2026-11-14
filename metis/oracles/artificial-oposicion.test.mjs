// Oráculo Metis · unidad m03-artificial-oposicion
// Contrato: el Examen artificial se materializa con exactamente 75 Preguntas
// activas distintas de UNA sola oposición (la seleccionada), en estudio y en
// examen; con 74 preguntas disponibles el inicio se bloquea sin completar con
// otro banco ni duplicar preguntas; la migración nueva exige en el servidor que
// todas las fuentes pertenezcan a la oposición solicitada y coincidan con
// paquetes publicados exactos (rechazo de mezclas y de fuentes extrínsecas sin
// rastro parcial); la firma antigua conserva la compatibilidad homogénea sin
// permitir mezclas; la reanudación y revisión usan la composición persistida
// fijada, y se conservan los motores, plazos, scoring, locking e identidad de
// pregunta de origen.
//
// El oráculo no usa dependencias externas (el entorno de verificación ejecuta
// los witnesses sobre una copia limpia del checkout, sin node_modules): el
// contrato SQL se verifica de forma estructural sobre el archivo de migración y
// los contratos de frontend se verifican de forma estructural y con los módulos
// públicos existentes. La verificación conductual con PostgreSQL embebido se
// ejecuta solo si el entorno dispone de node_modules (la suite general del
// repositorio la cubre con npm test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { ARTIFICIAL_QUESTION_COUNT, materializeArtificialSources } from "../../app/src/artificial-exam.js";
import * as historyModule from "../../app/src/history.js";

const migrationsUrl = new URL("../../supabase/migrations/", import.meta.url);
const migrationName = "20261113092000_artificial_opposition_boundary.sql";
const appSourceUrl = new URL("../../app/src/app.js", import.meta.url);

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  // Copia limpia sin node_modules: la parte conductual SQL se omite y la
  // cobertura conductual corresponde a la suite general (npm test).
}

function stripSqlComments(sql) {
  return sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
}

function functionStatement(sql, name) {
  const match = sql.match(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i"));
  if (!match) return null;
  const end = sql.indexOf("$$;", match.index);
  return sql.slice(match.index, end === -1 ? sql.length : end + 3);
}

async function readMigration() {
  try {
    const raw = await readFile(new URL(migrationName, migrationsUrl), "utf8");
    return { raw, sql: stripSqlComments(raw) };
  } catch {
    return null;
  }
}

async function migrationOr(failLabel) {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con la frontera multioposición del artificial (forward-only): ${failLabel}`);
  }
  return migration;
}

test("la migración nueva crea la RPC v2 del artificial con la frontera de oposición antes de materializar", async () => {
  const { raw, sql } = await migrationOr("RPC v2 de artificial");
  assert.match(raw, /--\s*[^\n]*oposición/i, "la migración debe explicar su operativa en español");

  const v2 = functionStatement(sql, "start_or_resume_artificial_attempt_v2");
  assert.ok(v2, "falta la RPC v2 public.start_or_resume_artificial_attempt_v2");
  assert.match(v2, /p_mode\s+text/i, "la RPC v2 debe recibir el modo (estudio/examen)");
  assert.match(v2, /p_opposition_id\s+text/i, "la RPC v2 debe recibir la oposición solicitada");
  assert.match(v2, /p_sources\s+jsonb/i, "la RPC v2 debe recibir la selección de fuentes");

  const bodyIndex = v2.indexOf("$$");
  const body = v2.slice(bodyIndex);

  // Reanudación precede a toda verificación: la composición persistida del
  // único intento artificial activo se devuelve fijada aunque se cambie de
  // oposición o la selección llegue vacía o corta.
  const resumeMatch = body.match(/from\s+public\.attempts[\s\S]{0,400}?for\s+update/i);
  assert.ok(resumeMatch, "la RPC v2 debe reanudar el único intento artificial activo fijado por usuario");
  const resumeIndex = resumeMatch.index;

  // Verificación en servidor antes de crear el intento o sus fuentes.
  const oppositionsRegistryIndex = body.search(/from\s+public\.oppositions\b/i);
  const mappingIndex = body.search(/opposition_exams/i);
  const registryIndex = body.search(/official_exam_versions/i);
  assert.ok(registryIndex > -1, "la RPC v2 debe verificar versiones y rutas publicadas exactas");
  assert.match(body, /is_published/i, "la verificación debe exigir paquetes actualmente publicados");
  assert.match(body, /source_question_id[^\n]{0,20}=\s*any\(official\.question_ids\)/i, "la verificación debe exigir la pregunta del paquete publicado exacto");
  assert.ok(mappingIndex > -1, "la RPC v2 debe verificar el mapeo administrativo (opposition_exams)");
  assert.match(body, /mapping\.opposition_id\s*=\s*p_opposition_id/i, "cada fuente debe corresponder a la oposición solicitada según el mapeo del servidor");
  assert.match(body, /exactamente 75/i, "la RPC v2 debe exigir exactamente 75 Preguntas activas distintas");
  assert.match(body, /no puede repetir una referencia/i, "la RPC v2 no debe aceptar preguntas duplicadas");

  const firstInsert = body.search(/insert\s+into\s+public\.attempts\b/i);
  const sourcesInsert = body.search(/insert\s+into\s+public\.attempt_question_sources\b/i);
  assert.ok(firstInsert > -1 && sourcesInsert > -1, "la RPC v2 debe crear el intento y sus fuentes");
  assert.ok(mappingIndex < firstInsert, "la verificación de oposición homogénea precede a la creación del intento");
  assert.ok(registryIndex < firstInsert, "la verificación de fuentes publicadas precede a la creación del intento");
  assert.ok(mappingIndex < sourcesInsert, "la verificación de oposición homogénea precede a la creación de las fuentes");
  assert.ok(resumeIndex < registryIndex && resumeIndex < mappingIndex, "la reanudación fijada precede a toda verificación");

  // Composición e identidad conservadas en la creación.
  assert.match(body, /'artificial-q'/, "las preguntas del artificial conservan su identidad artificial-qNNN");
  assert.match(body, /source_question_id/, "las fuentes persisten la identidad de pregunta de origen");
  assert.match(body, /120/, "el Modo examen artificial mantiene sus 120 minutos");

  const revokeMatch = sql.match(/revoke\s+all[^;]*start_or_resume_artificial_attempt_v2/i);
  assert.ok(revokeMatch, "la RPC v2 debe revocarse para public/anon/authenticated antes de concederse");
  assert.match(sql.slice(revokeMatch.index, sql.indexOf(";", revokeMatch.index)), /anon/i);
  const grantMatch = sql.match(/grant\s+execute[^;]*start_or_resume_artificial_attempt_v2/i);
  assert.ok(grantMatch, "la RPC v2 debe concederse a authenticated");
  assert.match(sql.slice(grantMatch.index, sql.indexOf(";", grantMatch.index)), /to\s+authenticated/i);
});

test("la migración endurece la firma antigua del artificial sin permitir mezclas", async () => {
  const { sql } = await migrationOr("firma antigua endurecida");

  const legacy = functionStatement(sql, "start_or_resume_artificial_attempt");
  assert.ok(legacy, "la firma antigua start_or_resume_artificial_attempt(modo, fuentes) debe seguir operativa");
  assert.match(legacy, /p_mode\s+text/i, "la firma antigua conserva el parámetro de modo");
  assert.match(legacy, /p_sources\s+jsonb/i, "la firma antigua conserva el parámetro de fuentes");
  assert.ok(
    /opposition_exams/i.test(legacy) || /start_or_resume_artificial_attempt_v2/i.test(legacy),
    "la firma antigua debe verificar la oposición única (mapeo administrativo) o delegar en la RPC v2",
  );

  const legacyGrant = sql.match(/grant\s+execute[^;]*start_or_resume_artificial_attempt\s*\(\s*text/i);
  assert.ok(legacyGrant, "la firma antigua conserva su privilegio authenticated (compatibilidad con frontend antiguo)");
  assert.match(sql.slice(legacyGrant.index, sql.indexOf(";", legacyGrant.index)), /to\s+authenticated/i);
});

test("la migración es forward-only y conserva motores, plazos, scoring, locking e identidad de origen", async () => {
  const { sql } = await migrationOr("conservación de los motores existentes");

  assert.doesNotMatch(sql, /drop\s+(table|function|index|constraint|trigger|policy)\b/i, "la migración no debe destruir objetos");
  assert.doesNotMatch(sql, /alter\s+table\b/i, "la migración no debe redefinir el esquema existente");
  assert.doesNotMatch(sql, /update\s+public\./i, "la migración no debe modificar filas existentes");
  assert.doesNotMatch(sql, /delete\s+from\s+public\./i, "la migración no debe eliminar filas existentes");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.official_exam_versions\b/i, "la migración no debe tocar el registro oficial");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.question_progress\b/i, "la migración no debe tocar el progreso");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.attempt_answers\b/i, "la migración no debe tocar las respuestas");
  assert.doesNotMatch(sql, /pg_advisory/i, "la migración no debe alterar el locking existente");
  for (const protectedFunction of [
    "apply_principal_answer", "finish_principal_attempt", "confirm_normal_answer", "complete_normal_attempt",
    "confirm_failed_answer", "complete_failed_attempt", "save_normal_attempt", "save_exam_answer",
    "sync_active_attempt", "start_or_replace_principal_attempt", "start_or_resume_exam_attempt",
    "finish_exam_attempt", "start_or_resume_failed_attempt", "start_or_resume_failed_attempt_v2",
    "finish_expired_exam_attempt", "confirm_artificial_study_answer",
    "complete_artificial_study_attempt", "finish_artificial_exam_attempt", "apply_artificial_question_progress",
    "finish_official_exam_attempt", "complete_official_normal_attempt", "confirm_official_normal_answer",
    "calculate_official_exam_score", "get_dashboard", "get_published_official_exam_versions",
    "get_published_official_exam_versions_v2", "reject_study_interaction_during_active_exam",
    "verify_study_answer_key",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${protectedFunction}\\b`, "i"),
      `la migración no debe redefinir public.${protectedFunction}`,
    );
  }
});

test("la ruta del artificial genera el pool de la oposición seleccionada y bloquea sin 75", async () => {
  const source = await readFile(appSourceUrl, "utf8");

  const artificialStart = source.indexOf("async function startArtificial");
  assert.ok(artificialStart > -1, "app.js conserva el recorrido del Examen artificial");
  const artificialSource = source.slice(artificialStart, source.indexOf("\nasync function startFailedStudy", artificialStart));

  assert.match(
    artificialSource,
    /filterCatalogByOpposition\(\s*catalog,\s*selectedOppositionId\s*\)/,
    "el pool del artificial procede de la proyección de la oposición seleccionada",
  );
  assert.match(artificialSource, /materializeArtificialSources\(/, "el recorrido del artificial materializa su selección");
  assert.doesNotMatch(
    artificialSource,
    /materializeArtificialSources\(\s*catalog\s*\)/,
    "el artificial ya no se materializa sobre el catálogo completo (banco global)",
  );
  assert.match(artificialSource, /start_or_resume_artificial_attempt_v2/, "el recorrido del artificial usa la RPC v2");
  assert.match(artificialSource, /p_opposition_id:\s*selectedOppositionId/, "el recorrido del artificial declara la oposición solicitada");
  assert.doesNotMatch(
    artificialSource,
    /rpc\("start_or_resume_artificial_attempt"\)/,
    "el recorrido del artificial no usa la firma antigua",
  );
  assert.match(artificialSource, /75 Preguntas activas distintas/, "el bloqueo por pool corto explica el requisito de 75");
  assert.match(artificialSource, /restore\(\{\s*kind\s*\}\)/, "la recuperación tras error de red conserva el intento persistido");

  const catalogStart = source.indexOf("function renderCatalog()");
  assert.ok(catalogStart > -1, "app.js conserva el renderizado del catálogo");
  const catalogSource = source.slice(catalogStart, source.indexOf("\nasync function ensureCatalog", catalogStart));
  assert.match(
    catalogSource,
    /filterCatalogByOpposition\(\s*catalog,\s*selectedOppositionId\s*\)/,
    "la disponibilidad del artificial se calcula sobre la oposición seleccionada",
  );
  assert.match(catalogSource, /75 Preguntas activas distintas/, "el catálogo avisa en español cuando la oposición no llega a 75");

  const selectOppositionStart = source.indexOf("function selectOpposition");
  assert.ok(selectOppositionStart > -1, "app.js conserva el cambio de oposición");
  const selectOppositionSource = source.slice(selectOppositionStart, source.indexOf("\nfunction renderCatalog()", selectOppositionStart));
  assert.match(
    selectOppositionSource,
    /renderCatalog\(\)/,
    "cambiar de oposición reevalúa la disponibilidad del artificial para el pool de esa oposición",
  );

  // Superficies de M01/M02 conservadas.
  assert.match(source, /listPublishedOppositions/, "el selector de oposiciones de M01 se conserva");
  assert.match(source, /"opposition-select"/, "el control de selección de oposición se conserva");
});

test("el materializador devuelto como módulo produce 75 orígenes únicos del pool proyectado y rechaza el pool corto", () => {
  assert.equal(ARTIFICIAL_QUESTION_COUNT, 75);
  assert.equal(typeof materializeArtificialSources, "function", "app/src/artificial-exam.js expone materializeArtificialSources");

  const poolFor = (examId, count) => ({
    id: examId,
    version: `version-${examId}`,
    versionPath: `${examId}/versions/version-${examId}.json`,
    questions: Array.from({ length: count }, (_, index) => ({ id: `${examId}-q${index + 1}`, active: true })),
  });
  const adminPool = [poolFor("admin-a", 60), poolFor("admin-b", 60)];
  const shortPool = [poolFor("rx-fixture", 74)];

  const sources = materializeArtificialSources(adminPool, () => 0.25);
  assert.equal(sources.length, 75);
  assert.equal(new Set(sources.map(({ exam_id: examId, source_question_id: questionId }) => `${examId}\0${questionId}`)).size, 75, "no duplica preguntas");
  for (const item of sources) {
    const exam = adminPool.find(({ id }) => id === item.exam_id);
    assert.ok(exam, "las fuentes provienen solo del pool proyectado");
    assert.equal(item.exam_version_id, exam.version);
    assert.equal(item.exam_version_path, exam.versionPath);
    assert.ok(exam.questions.some(({ id }) => id === item.source_question_id), "la pregunta pertenece al paquete proyectado");
  }

  assert.throws(
    () => materializeArtificialSources(shortPool),
    (error) => error.message.includes("75") && error.message.includes("74"),
    "con 74 disponibles el materializador bloquea sin selección parcial",
  );
  assert.throws(
    () => materializeArtificialSources([]),
    (error) => error.message.includes("75"),
    "con un pool vacío el materializador bloquea en español",
  );
});

test("la revisión del artificial usa la composición persistida con versiones fijadas, no el pool actual", async () => {
  assert.equal(
    typeof historyModule.loadHistoryReplay,
    "function",
    "app/src/history.js debe seguir exportando loadHistoryReplay",
  );

  const pinnedPackage = {
    id: "exam-historico",
    title: "Examen histórico",
    durationMinutes: 90,
    version: { id: "version-vieja" },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 2, questionNumbers: [1, 2] },
    questions: [
      { id: "exam-historico-q001", sourceNumber: 1, active: true, text: "Pregunta histórica 1", options: [{ id: "A", text: "Uno" }], correctOption: "A" },
      { id: "exam-historico-q002", sourceNumber: 2, active: true, text: "Pregunta histórica 2", options: [{ id: "A", text: "Uno" }], correctOption: "A" },
    ],
  };
  const fetchedPaths = [];
  const client = {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order: async () => ({
          data: table === "attempt_question_sources"
            ? [
                { position: 0, exam_id: "exam-historico", exam_version_id: "version-vieja", exam_version_path: "exam-historico/versions/version-vieja.json", question_id: "artificial-q001", source_question_id: "exam-historico-q001" },
                { position: 1, exam_id: "exam-historico", exam_version_id: "version-vieja", exam_version_path: "exam-historico/versions/version-vieja.json", question_id: "artificial-q002", source_question_id: "exam-historico-q002" },
              ]
            : [],
          error: null,
        }),
      };
      return builder;
    },
  };
  const attempt = {
    id: "attempt-artificial",
    exam_id: "__artificial__",
    exam_version_id: "materialized-1",
    exam_version_path: "artificial/materialized-1.json",
    question_ids: ["artificial-q001", "artificial-q002"],
    kind: "normal",
    origin: "artificial",
  };

  const replay = await historyModule.loadHistoryReplay(client, async (path) => {
    fetchedPaths.push(path);
    return { ok: true, status: 200, json: async () => structuredClone(pinnedPackage) };
  }, "/bank/", attempt);

  assert.deepEqual(replay.questions.map(({ id }) => id), ["artificial-q001", "artificial-q002"]);
  assert.deepEqual(replay.questions.map(({ sourceQuestionId }) => sourceQuestionId), ["exam-historico-q001", "exam-historico-q002"]);
  assert.equal(replay.questions[0].text, "Pregunta histórica 1", "el enunciado viene de la versión fijada de origen");
  assert.ok(
    fetchedPaths.every((path) => path.includes("exam-historico/versions/version-vieja.json")),
    "la revisión carga la versión fijada, nunca la composición del pool actual",
  );
  assert.ok(!fetchedPaths.some((path) => path.includes("artificial/")), "no se intenta abrir el paquete sintético del artificial");
});

const behavioralOptions = PGlite ? {} : {
  skip: "el entorno de verificación no instala node_modules; la verificación conductual con PostgreSQL embebido corresponde a la suite general (npm test)",
};

test("el servidor aplica la frontera: homogénea pasa, 74 bloquea, mezcla y extrínseca se rechazan sin rastro", { skip: behavioralOptions.skip }, async () => {
  const userId = "10000000-0000-4000-8000-000000000051";
  const otherUserId = "10000000-0000-4000-8000-000000000052";
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
    await db.query("insert into auth.users(id) values ($1), ($2)", [userId, otherUserId]);
    // Segunda oposición solo de fixture, aislada de producción.
    await db.query(
      "insert into public.oppositions(id, public_name) values ('radiodiagnostico-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
    );
    const packageData = (examId, count) => {
      const questionIds = Array.from({ length: count }, (_, index) => `${examId}-q${String(index + 1).padStart(3, "0")}`);
      return {
        examId,
        versionId: `${examId}-version`,
        versionPath: `${examId}/versions/${examId}-version.json`,
        questionIds,
        answerKey: Object.fromEntries(questionIds.map((id) => [id, "B"])),
      };
    };
    const registerExam = async (source, opposition) => {
      await db.query(
        `insert into public.official_exam_versions(
           exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key, is_published
         ) values ($1, $2, $3, 90, $4, $5::jsonb, true)`,
        [source.examId, source.versionId, source.versionPath, source.questionIds, JSON.stringify(source.answerKey)],
      );
      if (opposition) {
        await db.query("insert into public.opposition_exams(exam_id, opposition_id) values ($1, $2)", [source.examId, opposition]);
      }
    };
    const sourceRows = (packages) => packages.flatMap((source) => source.questionIds.map((questionId) => ({
      exam_id: source.examId,
      exam_version_id: source.versionId,
      exam_version_path: source.versionPath,
      source_question_id: questionId,
    })));
    const startV2 = async (mode, oppositionId, sources) => (await db.query(
      "select public.start_or_resume_artificial_attempt_v2($1, $2, $3::jsonb) as attempt",
      [mode, oppositionId, JSON.stringify(sources)],
    )).rows[0].attempt;
    const startLegacy = async (mode, sources) => (await db.query(
      "select public.start_or_resume_artificial_attempt($1, $2::jsonb) as attempt",
      [mode, JSON.stringify(sources)],
    )).rows[0].attempt;

    const adminA = packageData("oracle-admin-a", 40);
    const adminB = packageData("oracle-admin-b", 40);
    const rxFixture = packageData("oracle-rx-fixture", 75);
    for (const source of [adminA, adminB]) await registerExam(source, "administrativo");
    await registerExam(rxFixture, "radiodiagnostico-fixture");
    const unpublished = packageData("oracle-admin-unpublished", 1);
    await registerExam(unpublished, "administrativo");
    await db.query("update public.official_exam_versions set is_published = false where exam_id = $1", [unpublished.examId]);

    const adminSeventyFive = [...sourceRows([adminA]), ...sourceRows([adminB]).slice(0, 35)];
    assert.equal(adminSeventyFive.length, 75);
    const mixed = [...adminSeventyFive.slice(0, 74), sourceRows([rxFixture])[0]];

    const snapshot = async () => ({
      attempts: (await db.query("select id, user_id, kind, origin, status from public.attempts order by id")).rows,
      sources: (await db.query("select attempt_id, position, question_id, source_question_id from public.attempt_question_sources order by attempt_id, position")).rows,
      progress: (await db.query("select user_id, exam_id, question_id, pending_failure from public.question_progress order by user_id, exam_id")).rows,
      answers: (await db.query("select * from public.attempt_answers order by id")).rows,
    });

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    const baseline = await snapshot();

    // N=74 se bloquea; una fuente extrínseca (otra oposición o versión no
    // publicada) se rechaza en servidor sin efectos parciales.
    await assert.rejects(
      startV2("study", "administrativo", adminSeventyFive.slice(0, 74)),
      /exactamente 75/i,
      "con 74 disponibles el inicio se bloquea",
    );
    await assert.rejects(
      startV2("study", "administrativo", mixed),
      /oposición/i,
      "una fuente RX manipulada en una selección Administrativo se rechaza",
    );
    const extrinsicVersion = [...adminSeventyFive.slice(0, 74), {
      exam_id: adminA.examId,
      exam_version_id: "version-no-publicada",
      exam_version_path: `${adminA.examId}/versions/version-no-publicada.json`,
      source_question_id: adminA.questionIds[39],
    }];
    await assert.rejects(
      startV2("study", "administrativo", extrinsicVersion),
      /actualmente publicad/i,
      "una fuente con versión no publicada se rechaza",
    );
    await assert.rejects(
      startV2("study", "oposicion-inexistente", adminSeventyFive),
      /oposición solicitada/i,
      "una oposición no publicada como solicitada falla cerrado",
    );
    assert.deepEqual(await snapshot(), baseline, "ningún rechazo deja intentos, fuentes, progreso ni respuestas parciales");

    // 75 fuentes homogéneas pasan y fijan su composición con identidad de origen.
    const attempt = await startV2("study", "administrativo", adminSeventyFive);
    assert.equal(attempt.origin, "artificial");
    assert.equal(attempt.kind, "normal");
    assert.equal(attempt.strategy, "artificial_study");
    assert.equal(attempt.question_ids.length, 75);
    const { rows: materialized } = await db.query(
      "select position, exam_id, question_id, source_question_id from public.attempt_question_sources where attempt_id = $1 order by position",
      [attempt.id],
    );
    assert.equal(materialized.length, 75);
    assert.equal(new Set(materialized.map(({ question_id: id }) => id)).size, 75);
    assert.deepEqual(
      materialized.map(({ position, exam_id: examId, source_question_id: questionId }) => ({ position, exam_id: examId, source_question_id: questionId })),
      adminSeventyFive.map(({ exam_id: examId, source_question_id: questionId }, position) => ({ position, exam_id: examId, source_question_id: questionId })),
    );
    const afterCreation = await snapshot();

    // Reanudación fijada aunque se cambie de oposición o la selección llegue vacía.
    const resumed = await startV2("study", "radiodiagnostico-fixture", []);
    assert.equal(resumed.id, attempt.id, "la reanudación devuelve el intento fijado");
    assert.deepEqual(resumed.question_ids, attempt.question_ids, "la composición persistida no se re-materializa");
    assert.equal(
      (await db.query("select count(*)::integer as count from public.attempts where user_id = $1 and origin = 'artificial'", [userId])).rows[0].count,
      1,
      "la reanudación no crea intentos adicionales",
    );
    assert.deepEqual(await snapshot(), afterCreation, "la reanudación no altera intentos, fuentes, progreso ni respuestas");

    // La identidad de pregunta de origen se conserva al actualizar progreso.
    await db.query(
      "select public.confirm_normal_answer($1, $2, $3, 'B', 'B')",
      ["20000000-0000-4000-8000-000000000051", attempt.id, attempt.question_ids[2]],
    );
    const { rows: progressRows } = await db.query(
      "select exam_id, question_id, correct_count, current_streak from public.question_progress where user_id = $1",
      [userId],
    );
    const confirmedSource = materialized[2];
    assert.deepEqual(progressRows, [{
      exam_id: confirmedSource.exam_id,
      question_id: confirmedSource.source_question_id,
      correct_count: 1,
      current_streak: 1,
    }], "el progreso se anota con la identidad de pregunta de origen, no con la artificial");

    // Firma antigua: homogénea operativa y mezcla rechazada en otro usuario.
    const legacyResumed = await startLegacy("study", adminSeventyFive);
    assert.equal(legacyResumed.id, attempt.id, "la firma antigua conserva la compatibilidad homogénea");

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [otherUserId]);
    const otherBaseline = await snapshot();
    await assert.rejects(
      startLegacy("study", mixed),
      /oposición/i,
      "la firma antigua tampoco materializa una selección mezclada",
    );
    await assert.rejects(
      startLegacy("study", [...adminSeventyFive.slice(0, 74), {
        exam_id: "oracle-sin-mapeo",
        exam_version_id: "oracle-sin-mapeo-version",
        exam_version_path: "oracle-sin-mapeo/versions/oracle-sin-mapeo-version.json",
        source_question_id: "oracle-sin-mapeo-q001",
      }]),
      /oposición/i,
      "la firma antigua rechaza la selección con fuentes sin mapeo",
    );
    assert.deepEqual(await snapshot(), otherBaseline, "los rechazos de la firma antigua no dejan rastro");

    // La oposición válida solicitada genera su propio artificial con su banco.
    const rxAttempt = await startV2("study", "radiodiagnostico-fixture", sourceRows([rxFixture]));
    const { rows: [{ rx_count: rxCount }] } = await db.query(
      `select count(*)::integer as rx_count from public.attempt_question_sources source
       join public.opposition_exams mapping on mapping.exam_id = source.exam_id
       where source.attempt_id = $1 and mapping.opposition_id = 'radiodiagnostico-fixture'`,
      [rxAttempt.id],
    );
    assert.equal(rxCount, 75, "el artificial de la segunda oposición se genera solo con su banco");
  } finally {
    await db.close();
  }
});

test("el Modo examen artificial conserva 120 minutos y reanuda fijado entre oposiciones", { skip: behavioralOptions.skip }, async () => {
  const userId = "10000000-0000-4000-8000-000000000053";
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
    const examId = "oracle-exam-mode";
    const questionIds = Array.from({ length: 80 }, (_, index) => `${examId}-q${String(index + 1).padStart(3, "0")}`);
    await db.query(
      `insert into public.official_exam_versions(
         exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key, is_published
       ) values ($1, $2, $3, 90, $4, $5::jsonb, true)`,
      [examId, `${examId}-version`, `${examId}/versions/${examId}-version.json`, questionIds, JSON.stringify(Object.fromEntries(questionIds.map((id) => [id, "B"])))],
    );
    await db.query("insert into public.opposition_exams(exam_id, opposition_id) values ($1, 'administrativo')", [examId]);
    await db.query(
      "insert into public.oppositions(id, public_name) values ('radiodiagnostico-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
    );
    const sources = questionIds.slice(0, 75).map((questionId) => ({
      exam_id: examId,
      exam_version_id: `${examId}-version`,
      exam_version_path: `${examId}/versions/${examId}-version.json`,
      source_question_id: questionId,
    }));
    const startV2 = async (mode, oppositionId, sourceList) => (await db.query(
      "select public.start_or_resume_artificial_attempt_v2($1, $2, $3::jsonb) as attempt",
      [mode, oppositionId, JSON.stringify(sourceList)],
    )).rows[0].attempt;

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    const started = await startV2("exam", "administrativo", sources);
    assert.equal(started.kind, "exam");
    assert.equal(started.strategy, "artificial_exam");
    assert.equal(started.duration_minutes, 120, "los 120 minutos del artificial se conservan");
    assert.equal(Date.parse(started.deadline_at) - Date.parse(started.started_at), 120 * 60_000, "deadline absoluto desde el inicio");
    const { rows: [{ count: examCount }] } = await db.query(
      "select count(*)::integer as count from public.attempts where user_id = $1 and kind = 'exam' and status = 'active'",
      [userId],
    );
    assert.equal(examCount, 1);

    const resumed = await startV2("exam", "radiodiagnostico-fixture", []);
    assert.equal(resumed.id, started.id, "la reanudación del examen artificial no depende de la oposición solicitada");
    assert.deepEqual(resumed.question_ids, started.question_ids, "la composición persistida del examen se conserva");
    assert.equal(Date.parse(resumed.deadline_at), Date.parse(started.deadline_at), "el deadline fijado no se recalcula");
  } finally {
    await db.close();
  }
});
