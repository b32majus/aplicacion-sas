import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { loadPersonalHistory, loadHistoryReplay } from "../app/src/history.js";
import { loadDashboard, loadOppositionDashboard } from "../app/src/dashboard.js";

// Unidad m04-historial-dashboard: la oposición es frontera de lectura en
// servidor para el Historial y el Dashboard. Estas pruebas verifican, sin red,
// el contrato de los módulos públicos y el escenario integrado con PostgreSQL
// embebido (PGlite): resolución de oposición por tipo de intento, intento
// mezclado sin oposición, filtros exactos, umbrales de grupo 0/1/2 de «Falladas
// por todos», comparativas solo de participantes reales activos, cuentas
// admin/test con resumen propio, autorización negativa y resultado legacy de
// get_dashboard idéntico antes y después de la migración nueva.

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const migrationName = "20261118090000_opposition_history_dashboard.sql";

const participants = [
  "10000000-0000-4000-8000-000000000311",
  "10000000-0000-4000-8000-000000000312",
  "10000000-0000-4000-8000-000000000313",
];
const inactiveInRx = participants[2];
const adminUser = "10000000-0000-4000-8000-000000000315";
const testUser = "10000000-0000-4000-8000-000000000316";

test("el módulo de Historial filtra por oposición en servidor y sin oposición no filtra", async () => {
  const calls = [];
  const client = {
    from(table) {
      const builder = {
        table,
        eqArgs: null,
        ordered: false,
        select() { return builder; },
        eq(...args) { builder.eqArgs = args; return builder; },
        order() { builder.ordered = true; return builder; },
        then(resolve, reject) {
          calls.push({ table: builder.table, eq: builder.eqArgs, ordered: builder.ordered });
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  await loadPersonalHistory(client, "administrativo");
  assert.deepEqual(
    calls.at(-1),
    { table: "personal_attempt_history", eq: ["opposition_id", "administrativo"], ordered: true },
    "con oposición seleccionada, el filtro de oposición viaja al servidor",
  );

  await loadPersonalHistory(client);
  assert.equal(calls.at(-1).eq, null, "sin oposición (enlace directo de revisión), la carga no filtra");
});

test("el módulo de Dashboard usa la RPC v2 por oposición y conserva la carga legacy", async () => {
  const expected = { personal: {}, shared: {} };
  const calls = [];
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return Promise.resolve({ data: expected, error: null });
    },
  };

  assert.equal(await loadOppositionDashboard(client, "rx-fixture"), expected);
  assert.deepEqual(calls.at(-1), {
    name: "get_opposition_dashboard_v2",
    params: { p_opposition_id: "rx-fixture" },
  });

  assert.equal(await loadDashboard(client), expected);
  assert.deepEqual(calls.at(-1), { name: "get_dashboard", params: undefined });
});

test("la revisión histórica fija el paquete originario y no reclasifica ni escribe", async () => {
  const pinnedPackage = {
    id: "exam-adm",
    title: "Examen de la oposición A (fijado)",
    durationMinutes: 90,
    version: { id: "version-adm-v1" },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 1, questionNumbers: [1] },
    questions: [{
      id: "exam-adm-q001", sourceNumber: 1, active: true, text: "Pregunta histórica de la oposición A",
      options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }], correctOption: "B",
    }],
  };
  const answers = [{
    id: "answer-1", question_id: "exam-adm-q001", answer_sequence: 1,
    selected_option: "A", correct_option: "B", is_correct: false, confirmed_at: "2026-11-18T09:00:00Z",
  }];
  const originalAnswers = structuredClone(answers);
  const reads = [];
  const client = {
    from(table) {
      reads.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        order: async () => ({ data: structuredClone(answers), error: null }),
      };
    },
  };
  const requested = [];
  const fetchImpl = async (path) => {
    requested.push(path);
    return { ok: true, status: 200, json: async () => structuredClone(pinnedPackage) };
  };

  const replay = await loadHistoryReplay(client, fetchImpl, "/bank/", {
    id: "attempt-adm",
    exam_id: "exam-adm",
    exam_version_id: "version-adm-v1",
    exam_version_path: "exam-adm/versions/version-adm-v1.json",
    question_ids: ["exam-adm-q001"],
    kind: "exam",
    strategy: "exam",
    status: "completed",
  });

  assert.equal(replay.questions[0].text, "Pregunta histórica de la oposición A", "la revisión usa el paquete originario fijado");
  assert.ok(requested.every((path) => path.includes("exam-adm/versions/version-adm-v1.json")), "la revisión carga la versión fijada, no la vigente");
  assert.deepEqual(reads, ["attempt_answers"], "la revisión solo lee respuestas");
  assert.deepEqual(answers, originalAnswers, "las respuestas persistidas no se mutan");
});

async function scenarioDatabase() {
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
  const migrationNames = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
  const newIndex = migrationNames.indexOf(migrationName);
  if (newIndex === -1) {
    assert.fail(`Falta la migración ${migrationName}.`);
  }
  for (const name of migrationNames.slice(0, newIndex)) {
    await db.exec(await readFile(new URL(name, migrationsUrl), "utf8"));
  }
  return db;
}

const registerExam = (db) => async (examId, opposition, questionIds) => {
  const versionId = `${examId}-version`;
  const versionPath = `${examId}/versions/${versionId}.json`;
  await db.query(
    `insert into public.official_exam_versions(
       exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key, is_published
     ) values ($1, $2, $3, 90, $4, $5::jsonb, true)`,
    [examId, versionId, versionPath, questionIds, JSON.stringify(Object.fromEntries(questionIds.map((id) => [id, "B"])))],
  );
  if (opposition) {
    await db.query("insert into public.opposition_exams(exam_id, opposition_id) values ($1, $2)", [examId, opposition]);
  }
  return { examId, versionId, versionPath, questionIds };
};

const sourceOf = (exam, questionId) => ({
  exam_id: exam.examId, exam_version_id: exam.versionId, exam_version_path: exam.versionPath, question_id: questionId,
});

const seedAttempt = (db) => async (id, userId, exam, {
  kind = "exam", strategy = "exam", principal = false, origin = null,
  score = null, elapsedMs = 3_600_000, activeSeconds = 60, status = "completed", sources = null,
} = {}) => {
  await db.query(
    `insert into public.attempts(
       id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
       kind, principal, strategy, status, completed_at, active_seconds,
       duration_minutes, started_at, deadline_at, exam_elapsed_ms, origin, score
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       case when $10 = 'completed' then now() else null end, $11,
       case when $7 = 'exam' then 90 else null end,
       case when $7 = 'exam' then now() - interval '90 minutes' else null end,
       case when $7 = 'exam' then now() else null end,
       case when $7 = 'exam' then $12::bigint else null end,
       coalesce($13, 'official'),
       case when $7 = 'exam' then $14::numeric else null end
     )`,
    [id, userId, exam.examId, exam.versionId, exam.versionPath, exam.questionIds,
      kind, principal, strategy, status, activeSeconds, elapsedMs, origin, score],
  );
  if (sources) {
    for (const [position, source] of sources.entries()) {
      await db.query(
        `insert into public.attempt_question_sources(
           attempt_id, user_id, position, exam_id, exam_version_id, exam_version_path, question_id, source_question_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [id, userId, position, source.exam_id, source.exam_version_id, source.exam_version_path, source.question_id],
      );
    }
  }
};

const seedProgress = (db) => async (userId, examId, questionId, wrongCount) => {
  await db.query(
    `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
     values ($1, $2, $3, $4, true)`,
    [userId, examId, questionId, wrongCount],
  );
};

const seedAnswer = (db) => async (id, attemptId, userId, questionId, selected, correct) => {
  await db.query(
    `insert into public.attempt_answers(
       id, attempt_id, user_id, question_id, answer_sequence, selected_option, correct_option, is_correct
     ) values ($1, $2, $3, $4, 1, $5, 'B', $6)`,
    [id, attemptId, userId, questionId, selected, correct],
  );
};

test("escenario integrado: Historial y Dashboard por oposición con umbrales de grupo, autorización negativa y legacy idéntico", async () => {
  const db = await scenarioDatabase();
  try {
    // Cuentas: admin/test sin alias (los tres slots son de los participantes
    // designados) y tres participantes con sus alias legacy.
    for (const [userId, role] of [[adminUser, "admin"], [testUser, "test"]]) {
      await db.query("insert into auth.users(id) values ($1)", [userId]);
      await db.query("insert into public.app_access_roles(user_id, role) values ($1, $2)", [userId, role]);
      await db.query("delete from public.profiles where id = $1", [userId]);
    }
    for (const userId of participants) {
      await db.query("insert into auth.users(id) values ($1)", [userId]);
      await db.query("insert into public.app_access_roles(user_id, role) values ($1, 'participant')", [userId]);
    }
    await db.query("insert into public.profiles(id) values ($1), ($2)", [adminUser, testUser]);

    // Segunda oposición SOLO de fixture, aislada de producción.
    await db.query(
      "insert into public.oppositions(id, public_name) values ('rx-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
    );
    const admExam = await registerExam(db)("history-adm-exam", "administrativo", ["history-adm-qA", "history-adm-qB", "history-adm-qC"]);
    const rxExam = await registerExam(db)("history-rx-exam", "rx-fixture", ["history-rx-qR1", "history-rx-qR2"]);

    const officialAttempt = async (id, userId, exam, score) => seedAttempt(db)(id, userId, exam, { score });
    // Actividad en ADMINISTRATIVO: P1 (oficial, estudio, fallada, artificial),
    // P2 (oficial y fallada), P3 (solo oficial) y admin (fuera de comparativas).
    await officialAttempt("21000000-0000-4000-8000-000000000301", participants[0], admExam, 80);
    await officialAttempt("21000000-0000-4000-8000-000000000302", participants[1], admExam, 60);
    await officialAttempt("21000000-0000-4000-8000-000000000303", participants[2], admExam, 90);
    await officialAttempt("21000000-0000-4000-8000-000000000304", adminUser, admExam, 100);
    await seedAttempt(db)("21000000-0000-4000-8000-000000000305", participants[0], admExam, {
      kind: "normal", strategy: "normal", principal: true, activeSeconds: 120,
    });
    await seedAttempt(db)("21000000-0000-4000-8000-000000000306", participants[0], admExam, {
      kind: "failed", strategy: "failed", activeSeconds: 60, sources: [sourceOf(admExam, "history-adm-qB")],
    });
    await seedAttempt(db)("21000000-0000-4000-8000-000000000307", participants[0], admExam, {
      kind: "normal", strategy: "artificial_study", origin: "artificial", activeSeconds: 30,
      sources: [sourceOf(admExam, "history-adm-qA")],
    });
    await seedProgress(db)(participants[0], admExam.examId, "history-adm-qA", 1);
    await seedProgress(db)(participants[0], admExam.examId, "history-adm-qB", 1);
    await seedProgress(db)(participants[1], admExam.examId, "history-adm-qA", 1);
    await seedProgress(db)(participants[1], admExam.examId, "history-adm-qC", 1);
    await seedProgress(db)(participants[2], admExam.examId, "history-adm-qA", 1);
    await seedProgress(db)(adminUser, admExam.examId, "history-adm-qA", 1);
    // Tres participantes activos y una pregunta (qD) fallada EXACTAMENTE por
    // dos de ellos: no está fallada por TODOS, no puede exponerse.
    await seedProgress(db)(participants[0], admExam.examId, "history-adm-qD", 1);
    await seedProgress(db)(participants[1], admExam.examId, "history-adm-qD", 1);
    await seedAnswer(db)("31000000-0000-4000-8000-000000000301", "21000000-0000-4000-8000-000000000301", participants[0], "history-adm-qA", "B", true);
    await seedAnswer(db)("31000000-0000-4000-8000-000000000302", "21000000-0000-4000-8000-000000000301", participants[0], "history-adm-qB", "A", false);
    await seedAnswer(db)("31000000-0000-4000-8000-000000000303", "21000000-0000-4000-8000-000000000302", participants[1], "history-adm-qA", "A", false);

    // Intento compuesto HISTÓRICO mezclado: no pertenece a ninguna oposición.
    await seedAttempt(db)("21000000-0000-4000-8000-000000000309", participants[0], admExam, {
      kind: "failed", strategy: "failed",
      sources: [sourceOf(admExam, "history-adm-qA"), sourceOf(rxExam, "history-rx-qR2")],
    });
    // Fallada y artificial SIN fuentes persistidas sobre un exam_id mapeado: se
    // resuelven exclusivamente por sus fuentes, así que no reciben oposición
    // aunque su exam_id esté registrado (nunca se reclasifican).
    await seedAttempt(db)("21000000-0000-4000-8000-000000000318", participants[0], admExam, {
      kind: "failed", strategy: "failed",
    });
    await seedAttempt(db)("21000000-0000-4000-8000-000000000319", participants[0], admExam, {
      kind: "normal", strategy: "artificial_study", origin: "artificial",
    });

    const setAuth = (userId) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    const v2 = async (oppositionId) => (await db.query(
      "select public.get_opposition_dashboard_v2($1) as dashboard", [oppositionId],
    )).rows[0].dashboard;
    const legacy = async () => (await db.query("select public.get_dashboard() as dashboard")).rows[0].dashboard;
    const historyRows = async (userId, oppositionId) => {
      await setAuth(userId);
      const filter = oppositionId ? "and opposition_id = $2" : "";
      return (await db.query(
        `select id, exam_id, kind, origin, opposition_id from public.personal_attempt_history
         where user_id = $1 ${filter} order by id`,
        oppositionId ? [userId, oppositionId] : [userId],
      )).rows;
    };

    // RESULTADO LEGACY IDÉNTICO ANTES/DESPUÉS de la migración nueva.
    await setAuth(participants[0]);
    const legacyBefore = JSON.stringify(await legacy());
    await db.exec(await readFile(new URL(migrationName, migrationsUrl), "utf8"));
    assert.equal(JSON.stringify(await legacy()), legacyBefore, "get_dashboard devuelve exactamente el mismo resultado antes y después de la migración");

    // HISTORIAL: la oposición de cada intento la resuelve el SERVIDOR.
    const p1All = await historyRows(participants[0]);
    const byId = Object.fromEntries(p1All.map((row) => [row.id, row]));
    assert.equal(byId["21000000-0000-4000-8000-000000000301"].opposition_id, "administrativo", "el intento oficial se resuelve por exam_id mapeado");
    assert.equal(byId["21000000-0000-4000-8000-000000000305"].opposition_id, "administrativo", "el estudio normal se resuelve por exam_id mapeado");
    assert.equal(byId["21000000-0000-4000-8000-000000000306"].opposition_id, "administrativo", "la sesión de falladas se resuelve por sus fuentes persistidas");
    assert.equal(byId["21000000-0000-4000-8000-000000000307"].opposition_id, "administrativo", "el intento artificial se resuelve por sus fuentes persistidas");
    assert.equal(byId["21000000-0000-4000-8000-000000000309"].opposition_id, null, "un intento mezclado no pertenece a ninguna oposición");
    assert.equal(byId["21000000-0000-4000-8000-000000000318"].opposition_id, null, "una fallada sin fuentes no se reclasifica por su exam_id mapeado");
    assert.equal(byId["21000000-0000-4000-8000-000000000319"].opposition_id, null, "un artificial sin fuentes no se reclasifica por su exam_id mapeado");

    const p1Adm = await historyRows(participants[0], "administrativo");
    assert.deepEqual(
      p1Adm.map(({ id }) => id),
      ["21000000-0000-4000-8000-000000000301", "21000000-0000-4000-8000-000000000305", "21000000-0000-4000-8000-000000000306", "21000000-0000-4000-8000-000000000307"],
      "el Historial de administrativo contiene únicamente intentos de esa oposición",
    );
    assert.equal(p1Adm.some(({ id }) => id === "21000000-0000-4000-8000-000000000309"), false, "cambiar el selector no reclasifica el intento mezclado");
    const p1RxEmpty = await historyRows(participants[0], "rx-fixture");
    assert.deepEqual(p1RxEmpty.map(({ id }) => id), [], "sin actividad en la segunda oposición el Historial filtrado está vacío");

    // La resolución verifica autorización real: intentos ajenos devuelven NULL.
    await setAuth(participants[1]);
    const foreignResolution = (await db.query(
      "select public.resolve_attempt_opposition($1, $2) as opposition",
      ["21000000-0000-4000-8000-000000000301", participants[0]],
    )).rows[0].opposition;
    assert.equal(foreignResolution, null, "la resolución del intento de otro usuario devuelve NULL sin revelar nada");

    // UMBRAL DE GRUPO 0: rx-fixture sin actividad de participantes reales.
    await setAuth(participants[0]);
    const rxEmpty = await v2("rx-fixture");
    assert.deepEqual(rxEmpty.shared.profiles, [], "sin actividad persistida (grupo 0) la comparativa no contiene perfiles");
    assert.deepEqual(rxEmpty.shared.failed_by_all, [], "con grupo 0 «Falladas por todos» no aparece");
    assert.deepEqual(rxEmpty.shared.official_exam_rankings, [], "sin actividad no hay ranking");

    // UMBRAL DE GRUPO 1: solo P1 tiene actividad en rx-fixture.
    await seedAttempt(db)("21000000-0000-4000-8000-000000000311", participants[0], rxExam, {
      kind: "failed", strategy: "failed", sources: [sourceOf(rxExam, "history-rx-qR1")],
    });
    await seedProgress(db)(participants[0], rxExam.examId, "history-rx-qR1", 1);
    await seedProgress(db)(participants[0], rxExam.examId, "history-rx-qR2", 1);
    const rxSolo = await v2("rx-fixture");
    assert.deepEqual(
      rxSolo.shared.failed_by_all,
      [],
      "con un único participante activo (grupo 1) su pregunta fallada NO se expone: el grupo unitario nunca identifica respuestas personales",
    );
    assert.equal(
      rxSolo.shared.profiles.length === 0 || (rxSolo.shared.profiles.length === 1 && rxSolo.shared.profiles[0].alias === "Participante 1"),
      true,
      "con grupo 1 la comparativa solo contiene agregados del participante real activo",
    );

    // UMBRAL DE GRUPO 2: P2 se activa en rx-fixture; P3 sigue SIN actividad aquí
    // y admin/test tienen actividad pero quedan fuera de la comparativa.
    await officialAttempt("21000000-0000-4000-8000-000000000312", participants[1], rxExam, 70);
    await officialAttempt("21000000-0000-4000-8000-000000000313", adminUser, rxExam, 95);
    await officialAttempt("21000000-0000-4000-8000-000000000314", testUser, rxExam, 55);
    await seedProgress(db)(participants[1], rxExam.examId, "history-rx-qR1", 1);
    await seedProgress(db)(adminUser, rxExam.examId, "history-rx-qR1", 1);
    await seedProgress(db)(testUser, rxExam.examId, "history-rx-qR1", 1);

    await setAuth(participants[0]);
    const admDash = await v2("administrativo");
    const serializedAdm = JSON.stringify(admDash);
    assert.equal(serializedAdm.includes(adminUser) || serializedAdm.includes(testUser), false, "el Dashboard v2 no expone cuentas admin/test");
    assert.equal(serializedAdm.includes("selected_option") || serializedAdm.includes("attempt_id"), false, "el Dashboard v2 no expone detalle de respuestas");
    assert.equal(admDash.personal.official_exams.some(({ exam_id: examId }) => examId === rxExam.examId), false, "ningún examen de la otra oposición aparece en administrativo");
    assert.deepEqual(
      admDash.personal.questions.map(({ question_id: questionId }) => questionId).sort(),
      ["history-adm-qA", "history-adm-qB", "history-adm-qD"],
      "las preguntas personales pertenecen exclusivamente a la oposición solicitada",
    );
    assert.equal(admDash.personal.global.answer_count, 2, "el resumen personal deriva sus respuestas solo de intentos de esa oposición");
    assert.equal(admDash.personal.global.study_active_seconds, 210, "el tiempo activo se deriva solo de los intentos de esa oposición (estudio, fallada y artificial)");
    assert.deepEqual(
      admDash.shared.profiles.map(({ alias }) => alias),
      ["Participante 1", "Participante 2", "Participante 3"],
      "la comparativa contiene solo los participantes reales con actividad",
    );
    assert.deepEqual(
      admDash.shared.failed_by_all,
      [{ exam_id: admExam.examId, question_id: "history-adm-qA", failed_profile_count: 3 }],
      "«Falladas por todos» solo incluye la pregunta fallada por TODOS los participantes activos (grupo de 3)",
    );
    assert.equal(
      admDash.shared.failed_by_all.some(({ question_id: questionId }) => questionId === "history-adm-qD"),
      false,
      "con tres participantes activos, la pregunta fallada exactamente por dos NO aparece (no está fallada por todos)",
    );
    assert.deepEqual(
      admDash.shared.official_exam_rankings.map(({ alias, rank }) => [alias, rank]),
      [["Participante 3", 1], ["Participante 1", 2], ["Participante 2", 3]],
      "el ranking agrega solo intentos oficiales de participantes activos de la oposición",
    );

    // GRUPO 2 consolidado en rx-fixture: P1 y P2 activos, P3 fuera.
    const rxDash = await v2("rx-fixture");
    const serializedRx = JSON.stringify(rxDash);
    assert.deepEqual(
      rxDash.shared.profiles.map(({ alias }) => alias),
      ["Participante 1", "Participante 2"],
      "la comparativa excluye al participante sin actividad y a admin/test",
    );
    assert.equal(serializedRx.includes(inactiveInRx), false, "el participante sin actividad en la oposición no deja rastro en ella");
    assert.deepEqual(
      rxDash.shared.failed_by_all,
      [{ exam_id: rxExam.examId, question_id: "history-rx-qR1", failed_profile_count: 2 }],
      "con dos participantes activos, la pregunta fallada por TODOS ellos aparece (grupo de 2, recuento igual al total)",
    );
    assert.equal(rxDash.shared.failed_by_all.some(({ question_id: questionId }) => questionId === "history-rx-qR2"), false, "la pregunta fallada por uno solo del grupo de dos no se expone");
    assert.deepEqual(rxDash.personal.questions.map(({ question_id: questionId }) => questionId).sort(), ["history-rx-qR1", "history-rx-qR2"], "las preguntas personales de rx-fixture son solo suyas");
    assert.equal(rxDash.personal.official_exams.some(({ exam_id: examId }) => examId === admExam.examId), false, "ningún examen de administrativo aparece en rx-fixture");
    assert.equal(rxDash.personal.global.answer_count, 0, "el resumen personal de rx-fixture no mezcla respuestas de administrativo");

    // Cuentas admin/test: resumen personal disponible, comparativa limpia.
    await setAuth(adminUser);
    const adminDash = await v2("rx-fixture");
    assert.equal(adminDash.personal.official_exams.some(({ exam_id: examId }) => examId === rxExam.examId), true, "una cuenta admin obtiene su resumen personal por oposición");
    assert.deepEqual(adminDash.shared.profiles.map(({ alias }) => alias), ["Participante 1", "Participante 2"], "las comparativas nunca contienen la actividad admin/test");
    await setAuth(testUser);
    const testDash = await v2("rx-fixture");
    assert.equal(testDash.personal.global.answer_count >= 0, true, "una cuenta test obtiene su resumen personal por oposición");
    assert.deepEqual(testDash.shared.profiles.map(({ alias }) => alias), ["Participante 1", "Participante 2"], "las comparativas de la cuenta test tampoco se contaminan");

    // HISTORIAL para una cuenta admin, también por oposición.
    const adminHistory = await historyRows(adminUser, "rx-fixture");
    assert.deepEqual(adminHistory.map(({ exam_id: examId }) => examId), ["history-rx-exam"], "una cuenta admin obtiene su Historial por oposición");

    // AUTORIZACIÓN NEGATIVA.
    await setAuth(participants[0]);
    await assert.rejects(v2("oposicion-inexistente"), /oposición/i, "una oposición no registrada falla cerrado");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(v2("administrativo"), /autenticación/i, "sin sesión la RPC v2 rechaza");
    await setAuth(participants[1]);
    await db.exec("set role authenticated");
    const { rows: foreignAttempts } = await db.query("select id from public.attempts where user_id = $1", [participants[0]]);
    const { rows: foreignAnswers } = await db.query("select id from public.attempt_answers where user_id = $1", [participants[0]]);
    assert.deepEqual(foreignAttempts, [], "RLS de attempts intacta: sin SELECT directo a intentos ajenos");
    assert.deepEqual(foreignAnswers, [], "RLS de attempt_answers intacta: sin SELECT directo a respuestas ajenas");
    await assert.rejects(db.query("select * from public.opposition_exams"), /permission denied/i, "sin SELECT administrativo sobre el mapeo");
    await assert.rejects(db.query("select * from public.oppositions"), /permission denied/i, "sin SELECT administrativo sobre el registro");
    const { rows: [viewPrivileges] } = await db.query(`select
      has_table_privilege('authenticated', 'public.personal_attempt_history', 'select') as can_select,
      has_table_privilege('authenticated', 'public.personal_attempt_history', 'update') as can_update,
      has_function_privilege('authenticated', 'public.resolve_attempt_opposition(uuid, uuid)', 'execute') as resolver_execute,
      has_function_privilege('authenticated', 'public.opposition_of_attempt(uuid, uuid)', 'execute') as internal_execute`);
    assert.deepEqual(viewPrivileges, {
      can_select: true,
      can_update: false,
      resolver_execute: true,
      internal_execute: false,
    }, "la vista es de solo lectura y la resolución interna no es ejecutable directamente");
    await db.exec("reset role");

    // ESTABILIDAD: la oposición resuelta de cada intento es estable al volver
    // tras consultar otra oposición, y las lecturas no escriben nada.
    const snapshot = async () => ({
      attempts: (await db.query("select id, user_id, exam_id, status, score from public.attempts order by id")).rows,
      sources: (await db.query("select attempt_id, position, question_id from public.attempt_question_sources order by attempt_id, position")).rows,
      progress: (await db.query("select user_id, exam_id, question_id, correct_count, wrong_count from public.question_progress order by user_id, exam_id, question_id")).rows,
      answers: (await db.query("select * from public.attempt_answers order by id")).rows,
    });
    await setAuth(participants[0]);
    const dataBefore = await snapshot();
    const firstRead = await historyRows(participants[0], "administrativo");
    const secondRead = await historyRows(participants[0], "rx-fixture");
    const repeatedFirstRead = await historyRows(participants[0], "administrativo");
    assert.deepEqual(
      repeatedFirstRead.map(({ id, opposition_id: oppositionId }) => [id, oppositionId]),
      firstRead.map(({ id, opposition_id: oppositionId }) => [id, oppositionId]),
      "la oposición resuelta de cada intento es estable al volver tras consultar otra oposición",
    );
    assert.equal(secondRead.length, 1, "cambiar la selección solo cambia el filtro, no los intentos");
    const dashAgain = await v2("administrativo");
    assert.equal(JSON.stringify(dashAgain.personal), JSON.stringify(admDash.personal), "el resumen personal es determinista entre lecturas");
    assert.deepEqual(await snapshot(), dataBefore, "las lecturas del Historial y del Dashboard no escriben intentos, fuentes, progreso ni respuestas");
  } finally {
    await db.close();
  }
});
