// Oráculo Metis · unidad m04-historial-dashboard
// Contrato: el Historial seleccionado contiene únicamente intentos de la
// oposición consultada, resuelta en SERVIDOR (exam_id mapeado para oficiales y
// attempt_question_sources para falladas/artificiales); cambiar el selector no
// reclasifica ni modifica intentos. Cualquier cuenta legítima (incluidas
// admin/test) obtiene su resumen personal por oposición mediante
// get_opposition_dashboard_v2(opposition_id), con cada métrica, examen y
// pregunta exclusivamente de esa oposición. Las comparativas solo agregan
// participantes reales (rol participant) con actividad persistida en esa
// oposición; «Falladas por todos» exige al menos dos participantes activos y
// nunca identifica respuestas mediante un grupo unitario. La migración nueva es
// forward-only, verifica autorización real, restringe EXECUTE, mantiene RLS y
// la prohibición de SELECT administrativo/directo; get_dashboard y los tres
// alias legacy quedan intactos. Abrir un intento histórico (incluso por enlace
// directo tras cambiar oposición) conserva identidad, versiones originarias y
// respuestas sin escribir nada; la reanudación conserva fuentes fijadas y el
// bloqueo global de examen.
//
// El oráculo no usa dependencias externas (el entorno de verificación ejecuta
// los witnesses sobre una copia limpia del checkout, sin node_modules): el
// contrato SQL se verifica de forma estructural sobre la migración y los
// contratos de frontend de forma estructural y con los módulos públicos. La
// verificación conductual con PostgreSQL embebido se ejecuta solo si el
// entorno dispone de node_modules (la suite general del repositorio la cubre
// con npm test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { loadHistoryReplay, loadPersonalHistory } from "../../app/src/history.js";
import * as dashboardModule from "../../app/src/dashboard.js";

const migrationsUrl = new URL("../../supabase/migrations/", import.meta.url);
const migrationName = "20261118090000_opposition_history_dashboard.sql";
const appSourceUrl = new URL("../../app/src/app.js", import.meta.url);
const indexUrl = new URL("../../app/index.html", import.meta.url);
const historyModuleUrl = new URL("../../app/src/history.js", import.meta.url);
const dashboardModuleUrl = new URL("../../app/src/dashboard.js", import.meta.url);

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  // Copia limpia sin node_modules: la parte conductual se omite y la cobertura
  // conductual corresponde a la suite general (npm test).
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

async function migrationOr(failLabel) {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con la lectura segura de Historial y el Dashboard v2 por oposición (forward-only): ${failLabel}`);
  }
  return migration;
}

function functionStatement(sql, name) {
  const match = sql.match(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i"));
  if (!match) return null;
  const end = sql.indexOf("$$;", match.index);
  return sql.slice(match.index, end === -1 ? sql.length : end + 3);
}

test("la migración nueva proporciona la lectura segura de Historial con la oposición resuelta en servidor", async () => {
  const { raw, sql } = await migrationOr("lectura segura del Historial");
  assert.match(raw, /--\s*[^\n]*oposición/i, "la migración debe explicar su operativa en español");

  // La vista del Historial se recrea (no se destruye ni se renombra): conserva
  // security_invoker (RLS de attempts intacta) y añade la oposición resuelta.
  const viewMatch = sql.match(/create\s+or\s+replace\s+view\s+public\.personal_attempt_history([\s\S]*?)as([\s\S]*?);/i);
  assert.ok(viewMatch, "la migración recrea public.personal_attempt_history conservando el endpoint del Historial");
  assert.match(viewMatch[1], /security_invoker\s*=\s*true/i, "la vista sigue siendo security_invoker: la RLS del Historial se mantiene");
  assert.match(viewMatch[2], /opposition_id/i, "la vista expone la columna oposición resuelta en servidor");

  // La resolución usa el registro servidor, nunca el selector local: mapeo
  // administrativo para oficiales y fuentes persistidas para falladas/artificiales.
  const resolutionZone = sql.slice(0, viewMatch.index + viewMatch[0].length);
  assert.match(resolutionZone, /opposition_exams/i, "la oposición de los intentos oficiales se resuelve con el mapeo administrativo");
  assert.match(resolutionZone, /attempt_question_sources/i, "la oposición de falladas/artificiales se resuelve con sus fuentes persistidas");
  assert.match(
    resolutionZone,
    /having[\s\S]{0,200}count\(\*\)\s*=/i,
    "un intento compuesto solo pertenece a una oposición cuando TODAS sus fuentes resuelven a la misma (nunca se reclasifica)",
  );

  // Autorización real en la resolución y privilegios mínimos.
  const resolver = sql.match(/create\s+(or\s+replace\s+)?function\s+public\.\w+\s*\([\s\S]*?security\s+definer[\s\S]*?\$\$;|create\s+(or\s+replace\s+)?function\s+public\.\w+\s*\([\s\S]*?\$\$;/i);
  assert.ok(resolver, "la resolución de oposición vive en una función definida en la migración");
  const resolverSql = resolver[0];
  assert.match(resolverSql, /security\s+definer/i, "la resolución lee el registro administrativo sin conceder SELECT sobre él");
  assert.match(resolverSql, /auth\.uid\(\)/i, "la resolución verifica autorización real (auth.uid)");
  assert.match(resolverSql, /user_id\s*=\s*v_user_id|user_id\s*=\s*auth\.uid\(\)/i, "la resolución solo opera sobre intentos del propio usuario");
  const resolverGrant = sql.match(/grant\s+execute[^;]*public\.\w+\(uuid,\s*text\)[^;]*;/i)
    || sql.match(/grant\s+execute[^;]*to\s+authenticated[^;]*;/i);
  assert.ok(resolverGrant, "la resolución se concede con privilegios mínimos");
  assert.doesNotMatch(resolverGrant[0], /to\s+(anon|public)/i, "la resolución nunca se concede a anon ni a public");

  // Privilegios de la vista: revoke all y solo SELECT para authenticated.
  assert.match(sql, /revoke\s+all\s+on\s+(?:table\s+)?public\.personal_attempt_history/i, "la vista revoca todos los privilegios antes de conceder");
  const viewGrant = sql.match(/grant\s+select\s+on\s+public\.personal_attempt_history\s+to\s+authenticated/i);
  assert.ok(viewGrant, "la vista se concede como SELECT a authenticated");
});

test("la migración crea la RPC v2 del Dashboard por oposición con autorización real y comparativas solo de participantes activos", async () => {
  const { sql } = await migrationOr("RPC v2 del Dashboard por oposición");

  const v2 = functionStatement(sql, "get_opposition_dashboard_v2");
  assert.ok(v2, "falta la RPC public.get_opposition_dashboard_v2(opposition_id)");
  assert.match(v2, /p_opposition_id\s+text/i, "la RPC v2 recibe la oposición solicitada");
  assert.match(v2, /security\s+definer/i, "la RPC v2 es security definer (lee el registro sin conceder SELECT administrativo)");
  assert.match(v2, /search_path\s*=\s*''/i, "la RPC v2 fija search_path vacío");

  const bodyIndex = v2.indexOf("$$");
  const body = v2.slice(bodyIndex);

  // Autorización real y fallo cerrado sobre la oposición solicitada.
  assert.match(body, /auth\.uid\(\)/i, "la RPC v2 verifica autenticación real");
  assert.match(body, /raise\s+exception/i, "la RPC v2 falla cerrado");
  assert.match(body, /from\s+public\.oppositions\b/i, "la oposición solicitada debe existir en el registro administrativo");

  // Comparativas: solo participantes reales (rol participant) con actividad
  // persistida en esa oposición; admin/test y participantes sin actividad fuera.
  assert.match(body, /app_access_roles/i, "la comparativa consulta los roles de acceso");
  assert.match(body, /role\s*=\s*'participant'/i, "solo el rol participant entra en la comparativa (admin/test nunca)");
  assert.match(
    body,
    /exists\s*\([\s\S]{0,300}attempts[\s\S]{0,300}\)/i,
    "solo participantes con actividad persistida (intentos) en la oposición entran en la comparativa",
  );

  // Umbral del grupo: «Falladas por todos» exige al menos dos participantes.
  assert.match(body, />=\s*2|al menos\s*dos|>=\s*2/i, "el grupo unitario nunca expone «Falladas por todos»");
  assert.match(
    body,
    /wrong_count\s*>\s*0[\s\S]{0,400}having[\s\S]{0,200}count\s*\(\s*distinct/i,
    "las preguntas comunes se calculan agregando el progreso de los participantes",
  );

  // Métricas personales y comparativas acotadas a la oposición solicitada.
  assert.match(body, /opposition_exams[\s\S]{0,200}p_opposition_id/i, "los exámenes de la oposición salen del mapeo administrativo solicitado");
  assert.match(body, /question_progress/i, "el progreso por pregunta sigue alimentando las métricas");

  // EXECUTE restringido.
  const revokeMatch = sql.match(/revoke\s+all[^;]*get_opposition_dashboard_v2/i);
  assert.ok(revokeMatch, "la RPC v2 debe revocarse para public/anon/authenticated antes de concederse");
  assert.match(sql.slice(revokeMatch.index, sql.indexOf(";", revokeMatch.index)), /anon/i);
  const grantMatch = sql.match(/grant\s+execute[^;]*get_opposition_dashboard_v2/i);
  assert.ok(grantMatch, "la RPC v2 debe concederse a authenticated");
  assert.match(sql.slice(grantMatch.index, sql.indexOf(";", grantMatch.index)), /to\s+authenticated/i);
});

test("la migración es forward-only y conserva el Dashboard legacy, los alias y el resto de motores", async () => {
  const { sql } = await migrationOr("compatibilidad legacy intacta");

  assert.doesNotMatch(sql, /drop\s+(table|view|function|index|constraint|trigger|policy)\b/i, "la migración no debe destruir objetos");
  assert.doesNotMatch(sql, /alter\s+table\b/i, "la migración no debe redefinir el esquema existente");
  assert.doesNotMatch(sql, /update\s+public\./i, "la migración no debe modificar filas existentes");
  assert.doesNotMatch(sql, /delete\s+from\s+public\./i, "la migración no debe eliminar filas existentes");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(official_exam_versions|question_progress|attempt_answers|attempts|shared_profile_aliases|app_access_roles)\b/i, "la migración no debe sembrar ni tocar datos");
  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security|no\s+force\s+rls/i, "la migración no debe debilitar RLS");
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete)[^;]*on\s+(table\s+)?public\.(oppositions|opposition_exams)\b/i, "las tablas administrativas siguen sin SELECT directo");
  for (const protectedFunction of [
    "apply_principal_answer", "finish_principal_attempt", "confirm_normal_answer", "complete_normal_attempt",
    "confirm_failed_answer", "complete_failed_attempt", "save_normal_attempt", "save_exam_answer",
    "sync_active_attempt", "start_or_replace_principal_attempt", "start_or_resume_exam_attempt",
    "finish_exam_attempt", "start_or_resume_failed_attempt", "start_or_resume_failed_attempt_v2",
    "start_or_resume_artificial_attempt", "start_or_resume_artificial_attempt_v2",
    "finish_expired_exam_attempt", "confirm_artificial_study_answer",
    "complete_artificial_study_attempt", "finish_artificial_exam_attempt", "apply_artificial_question_progress",
    "finish_official_exam_attempt", "calculate_official_exam_score",
    "get_dashboard", "get_published_official_exam_versions", "get_published_official_exam_versions_v2",
    "reject_study_interaction_during_active_exam", "verify_study_answer_key", "verify_official_study_answer_key",
    "assign_shared_profile_alias", "apply_app_access_role",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${protectedFunction}\\b`, "i"),
      `la migración no debe redefinir public.${protectedFunction}`,
    );
  }
  assert.doesNotMatch(sql, /shared_profile_aliases[\s\S]{0,80}(drop|alter|update|delete|insert)/i, "los tres alias legacy quedan intactos");
});

test("la ruta de Historial consulta la oposición seleccionada y la revisión sigue fijada y sin escrituras", async () => {
  const source = await readFile(appSourceUrl, "utf8");
  const historySource = await readFile(historyModuleUrl, "utf8");

  // El módulo de Historial filtra por oposición en servidor y permite la carga
  // sin filtro para el enlace directo.
  assert.match(
    historySource,
    /export\s+async\s+function\s+loadPersonalHistory\s*\(\s*client\s*,\s*oppositionId[^)]*\)/,
    "loadPersonalHistory acepta la oposición solicitada",
  );
  assert.match(historySource, /personal_attempt_history/, "el Historial sigue leyendo el endpoint personal_attempt_history");
  assert.match(
    historySource,
    /eq\(\s*"opposition_id"\s*,\s*oppositionId\s*\)/,
    "el filtro de oposición se aplica en servidor sobre la columna resuelta",
  );

  // showHistory materializa la oposición seleccionada con guard de navegación.
  const showHistoryStart = source.indexOf("async function showHistory()");
  assert.ok(showHistoryStart > -1, "app.js conserva el recorrido del Historial");
  const showHistorySource = source.slice(showHistoryStart, source.indexOf("\nfunction metricNode", showHistoryStart));
  assert.match(showHistorySource, /\+\+routeSerial/, "showHistory incrementa el guard de navegación");
  assert.match(showHistorySource, /serial\s*!==\s*routeSerial/, "showHistory descarta respuestas de una selección anterior");
  assert.match(
    showHistorySource,
    /loadPersonalHistory\(\s*supabase\s*,\s*selectedOppositionId\s*\)/,
    "el Historial cargado es el de la oposición seleccionada",
  );
  assert.match(showHistorySource, /history-opposition/, "el Historial identifica visiblemente la oposición consultada");

  // Estado vacío coherente con la oposición consultada.
  const renderHistoryStart = source.indexOf("function renderHistory()");
  const renderHistorySource = source.slice(renderHistoryStart, source.indexOf("\nasync function showHistory", renderHistoryStart));
  assert.match(
    renderHistorySource,
    /oppositionName|selectedOppositionName|opposición/i,
    "el estado vacío del Historial menciona la oposición consultada",
  );

  // Enlace directo: la revisión recarga el Historial completo propio (sin
  // filtro de oposición) y solo LEE, con versiones fijadas.
  const detailStart = source.indexOf("async function showHistoryDetail");
  assert.ok(detailStart > -1, "app.js conserva la revisión histórica");
  const detailSource = source.slice(detailStart, source.indexOf("\nfunction eligibleFailureSources", detailStart));
  assert.match(
    detailSource,
    /loadPersonalHistory\(\s*supabase\s*\)/,
    "el fallback del enlace directo recarga el Historial sin filtro de oposición",
  );
  assert.match(detailSource, /loadHistoryReplay/, "la revisión usa la reproducción fijada");
  assert.doesNotMatch(detailSource, /rpc\(|persistence\??\.\w+\(|\.update\(|\.insert\(/, "la revisión histórica no escribe score, progreso, historial ni cierre");

  // La ruta hash de revisión también recarga sin filtro (cambio de oposición previo).
  const routeStart = source.indexOf("async function routePrivateView");
  const routeSource = source.slice(routeStart, source.indexOf("\nfunction renderAuthSession", routeStart));
  const directLinkBranch = routeSource.slice(
    routeSource.indexOf("requestedHistoryId"),
    routeSource.indexOf("if (window.location.hash === \"#history\")"),
  );
  assert.ok(directLinkBranch.length > 0, "routePrivateView conserva la ruta del enlace directo de revisión");
  assert.match(
    directLinkBranch,
    /loadPersonalHistory\(\s*supabase\s*\)/,
    "el enlace directo tras cambiar de oposición sigue abriendo el intento propio",
  );

  // Reanudación fijada y bloqueo global de examen (contratos M02/M03 intactos).
  const failedStart = source.indexOf("async function startFailedStudy");
  const failedSource = source.slice(failedStart, source.indexOf("\nfunction renderNavigation()", failedStart));
  assert.match(failedSource, /p_opposition_id:\s*selectedOppositionId/, "la reanudación de falladas sigue declarando la oposición al servidor");
  assert.match(failedSource, /restore\(\{\s*kind:\s*"failed"\s*\}\)/, "la recuperación de falladas conserva la sesión fijada");
  const artificialStart = source.indexOf("async function startArtificial");
  const artificialSource = source.slice(artificialStart, source.indexOf("\nasync function startFailedStudy", artificialStart));
  assert.match(artificialSource, /p_opposition_id:\s*selectedOppositionId/, "la reanudación del artificial sigue declarando la oposición al servidor");
  assert.match(source, /isActiveExam\(activeExamAttempt/, "el bloqueo global del Modo examen sigue presente");
});

test("la ruta de Dashboard usa la RPC v2 por oposición y conserva estados y compatibilidad legacy", async () => {
  const source = await readFile(appSourceUrl, "utf8");
  const dashboardSource = await readFile(dashboardModuleUrl, "utf8");
  const markup = await readFile(indexUrl, "utf8");

  assert.match(
    dashboardSource,
    /export\s+async\s+function\s+loadOppositionDashboard\s*\(\s*client\s*,\s*oppositionId\s*\)/,
    "dashboard.js expone la carga del Dashboard por oposición",
  );
  assert.match(dashboardSource, /get_opposition_dashboard_v2/, "la carga usa la RPC v2");
  assert.match(dashboardSource, /p_opposition_id:\s*oppositionId/, "la RPC v2 recibe la oposición solicitada");
  assert.match(dashboardSource, /export\s+async\s+function\s+loadDashboard/, "la carga legacy se conserva exportada");

  const showDashboardStart = source.indexOf("async function showDashboard()");
  assert.ok(showDashboardStart > -1, "app.js conserva el recorrido del Dashboard");
  const showDashboardSource = source.slice(showDashboardStart, source.indexOf("\nfunction renderHistoryQuestions", showDashboardStart));
  assert.match(showDashboardSource, /\+\+routeSerial/, "showDashboard conserva el guard de navegación");
  assert.match(showDashboardSource, /serial\s*!==\s*routeSerial/, "showDashboard descarta datos de una selección anterior");
  assert.match(
    showDashboardSource,
    /loadOppositionDashboard\(\s*supabase\s*,\s*selectedOppositionId\s*\)/,
    "el Dashboard se carga para la oposición seleccionada",
  );
  assert.match(showDashboardSource, /dashboard-opposition/, "el Dashboard identifica visiblemente la oposición consultada");
  assert.match(
    showDashboardSource,
    /showError\(elements\["dashboard-status"\],\s*dashboardLoadStatus\(error\)\);/,
    "el aviso contextual del Dashboard se conserva (consumidor dashboard-load-status)",
  );

  const renderDashboardStart = source.indexOf("function renderDashboard()");
  const renderDashboardSource = source.slice(renderDashboardStart, source.indexOf("\n// La ausencia del perfil", renderDashboardStart));
  assert.match(
    renderDashboardSource,
    /failed_profile_count|profiles\.length/i,
    "el recuento de «Falladas por todos» se muestra con el grupo real de participantes activos",
  );

  assert.match(markup, /id="history-opposition"/, "el HTML reserva la identificación de oposición del Historial");
  assert.match(markup, /id="dashboard-opposition"/, "el HTML reserva la identificación de oposición del Dashboard");
  assert.match(markup, /id="dashboard-catalog-button"/, "el Dashboard permite volver al catálogo");
  assert.match(markup, /id="history-catalog-button"/, "el Historial permite volver al catálogo");
});

test("el módulo de Historial filtra por oposición en servidor y la revisión no reclasifica ni escribe", async () => {
  const calls = [];
  const builderFor = (table) => {
    const builder = {
      table,
      eqArgs: null,
      ordered: false,
      from: table,
      select() { return builder; },
      eq(...args) { builder.eqArgs = args; return builder; },
      order() { builder.ordered = true; return builder; },
      then(resolve, reject) {
        calls.push({ table: builder.table, eq: builder.eqArgs, ordered: builder.ordered });
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = { from: (table) => builderFor(table) };

  await loadPersonalHistory(client, "rx-fixture");
  assert.deepEqual(calls.at(-1), { table: "personal_attempt_history", eq: ["opposition_id", "rx-fixture"], ordered: true }, "con oposición seleccionada, el filtro viaja al servidor");

  await loadPersonalHistory(client);
  assert.equal(calls.at(-1).eq, null, "sin oposición (enlace directo), la carga no filtra por oposición");

  // Revisión fijada: el intento pertenece a la oposición A mientras el catálogo
  // vigente (selección) es B; la reproducción carga la versión originaria y no
  // muta respuestas ni añade lecturas de escritura.
  const pinnedPackage = {
    id: "exam-adm",
    title: "Examen Administrativo (fijado)",
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
  const replayClient = {
    from(table) {
      reads.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order: async () => ({ data: structuredClone(answers), error: null }),
      };
      return builder;
    },
  };
  const requested = [];
  const fetchImpl = async (path) => {
    requested.push(path);
    return { ok: true, status: 200, json: async () => structuredClone(pinnedPackage) };
  };

  const replay = await loadHistoryReplay(replayClient, fetchImpl, "/bank/", {
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
  assert.equal(typeof dashboardModule.loadOppositionDashboard, "function", "dashboard.js expone el Dashboard por oposición");
});

const behavioralOptions = PGlite ? {} : {
  skip: "el entorno de verificación no instala node_modules; la verificación conductual con PostgreSQL embebido corresponde a la suite general (npm test)",
};

test("escenario integrado: aislamiento por oposición, umbrales de grupo, autorización negativa, revisión fijada y legacy idéntico", { skip: behavioralOptions.skip }, async () => {
  const participants = [
    "10000000-0000-4000-8000-000000000111",
    "10000000-0000-4000-8000-000000000112",
    "10000000-0000-4000-8000-000000000113",
  ];
  const inactiveInRx = participants[2]; // Participante sin actividad en la segunda oposición
  const adminUser = "10000000-0000-4000-8000-000000000115";
  const testUser = "10000000-0000-4000-8000-000000000116";
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
    const newMigrationIndex = migrationNames.indexOf(migrationName);
    if (newMigrationIndex === -1) {
      assert.fail(`Falta la migración ${migrationName} con la lectura segura de Historial y el Dashboard v2.`);
    }
    const before = migrationNames.slice(0, newMigrationIndex);
    for (const name of before) await db.exec(await readFile(new URL(name, migrationsUrl), "utf8"));

    // Cuentas: admin/test creados sin alias (como en la migración de roles) y
    // tres participantes designados con sus alias legacy.
    for (const [userId, role] of [[adminUser, "admin"], [testUser, "test"]]) {
      await db.query("insert into auth.users(id) values ($1)", [userId]);
      await db.query("insert into public.app_access_roles(user_id, role) values ($1, $2)", [userId, role]);
      await db.query("delete from public.profiles where id = $1", [userId]);
    }
    for (const userId of participants) await db.query("insert into auth.users(id) values ($1)", [userId]);
    for (const userId of participants) {
      await db.query("insert into public.app_access_roles(user_id, role) values ($1, 'participant')", [userId]);
    }
    // Los perfiles de admin/test se recrean sin alias (los tres slots son de
    // los participantes designados), como en la migración de roles de acceso.
    await db.query("insert into public.profiles(id) values ($1), ($2)", [adminUser, testUser]);

    // Segunda oposición SOLO de fixture, aislada de producción.
    await db.query(
      "insert into public.oppositions(id, public_name) values ('rx-fixture', 'Radiodiagnóstico (fixture)') on conflict (id) do nothing",
    );
    const registerExam = async (examId, opposition, questionIds) => {
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
    const admExam = await registerExam("oracle-adm-exam", "administrativo", ["oracle-adm-qA", "oracle-adm-qB", "oracle-adm-qC"]);
    const rxEam = await registerExam("oracle-rx-exam", "rx-fixture", ["oracle-rx-qR1", "oracle-rx-qR2"]);

    const officialAttempt = async (id, userId, exam, { score, elapsedMs = 3_600_000, completedAt = "2026-11-17T09:00:00Z" } = {}) => {
      await db.query(
        `insert into public.attempts(
           id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
           kind, principal, strategy, status, duration_minutes, started_at, deadline_at,
           completed_at, score, correct_answers, wrong_answers, blank_answers, exam_elapsed_ms
         ) values ($1, $2, $3, $4, $5, $6, 'exam', false, 'exam', 'completed', 90,
           $7::timestamptz - interval '90 minutes', $7::timestamptz, $7::timestamptz, $8, 1, 1, 0, $9)`,
        [id, userId, exam.examId, exam.versionId, exam.versionPath, exam.questionIds, completedAt, score, elapsedMs],
      );
    };
    const compositeAttempt = async (id, userId, origin, sources, { status = "completed" } = {}) => {
      await db.query(
        `insert into public.attempts(
           id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
           kind, principal, strategy, status, completed_at, active_seconds
         ) values ($1, $2, $3, $4, $5, $6, 'failed', false, 'failed', $7,
           case when $7 = 'completed' then now() else null end, 60)`,
        [id, userId, sources[0].exam_id, sources[0].exam_version_id, sources[0].exam_version_path,
          sources.map(({ question_id: questionId }) => questionId), status],
      );
      for (const [position, source] of sources.entries()) {
        await db.query(
          `insert into public.attempt_question_sources(
             attempt_id, user_id, position, exam_id, exam_version_id, exam_version_path, question_id, source_question_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [id, userId, position, source.exam_id, source.exam_version_id, source.exam_version_path, source.question_id],
        );
      }
    };
    const sourceOf = (exam, questionId) => ({
      exam_id: exam.examId, exam_version_id: exam.versionId, exam_version_path: exam.versionPath, question_id: questionId,
    });
    const progress = async (userId, examId, questionId, wrongCount) => {
      await db.query(
        `insert into public.question_progress(user_id, exam_id, question_id, wrong_count, pending_failure)
         values ($1, $2, $3, $4, true)`,
        [userId, examId, questionId, wrongCount],
      );
    };

    // Actividad en ADMINISTRATIVO: P1 (oficial, normal, fallada, artificial),
    // P2 (oficial, fallada) y P3 (solo oficial). El admin también tiene
    // actividad: debe quedar fuera de todas las comparativas.
    await officialAttempt("20000000-0000-4000-8000-000000000221", participants[0], admExam, { score: 80 });
    await officialAttempt("20000000-0000-4000-8000-000000000222", participants[1], admExam, { score: 60 });
    await officialAttempt("20000000-0000-4000-8000-000000000223", participants[2], admExam, { score: 90 });
    await officialAttempt("20000000-0000-4000-8000-000000000224", adminUser, admExam, { score: 100 });
    await db.query(
      `insert into public.attempts(
         id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
         kind, principal, strategy, status, completed_at, active_seconds
       ) values ('20000000-0000-4000-8000-000000000225', $1, $2, $3, $4, $5,
         'normal', true, 'normal', 'completed', now(), 120)`,
      [participants[0], admExam.examId, admExam.versionId, admExam.versionPath, admExam.questionIds],
    );
    await compositeAttempt("20000000-0000-4000-8000-000000000226", participants[0], "failed", [sourceOf(admExam, "oracle-adm-qB")]);
    await compositeAttempt("20000000-0000-4000-8000-000000000227", participants[1], "failed", [sourceOf(admExam, "oracle-adm-qC")]);
    await db.query(
      `insert into public.attempts(
         id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
         kind, principal, strategy, status, completed_at, active_seconds, origin
       ) values ('20000000-0000-4000-8000-000000000228', $1, '__artificial__', 'materialized-1',
         '__artificial__/versions/materialized-1.json', array['artificial-q1'],
         'normal', false, 'artificial_study', 'completed', now(), 30, 'artificial')`,
      [participants[0]],
    );
    await db.query(
      `insert into public.attempt_question_sources(
         attempt_id, user_id, position, exam_id, exam_version_id, exam_version_path, question_id, source_question_id
       ) values ('20000000-0000-4000-8000-000000000228', $1, 0, $2, $3, $4, 'artificial-q1', 'oracle-adm-qA')`,
      [participants[0], admExam.examId, admExam.versionId, admExam.versionPath],
    );
    await progress(participants[0], admExam.examId, "oracle-adm-qA", 1);
    await progress(participants[0], admExam.examId, "oracle-adm-qB", 1);
    await progress(participants[1], admExam.examId, "oracle-adm-qA", 1);
    await progress(participants[1], admExam.examId, "oracle-adm-qC", 1);
    await progress(participants[2], admExam.examId, "oracle-adm-qA", 1);
    await progress(adminUser, admExam.examId, "oracle-adm-qA", 1);

    // «Falladas por todos» en administrativo (grupo de 3): qA la fallan los tres
    // participantes; qB solo dos; qC solo uno. La respuesta del admin nunca cuenta.
    // RESPUESTAS persistidas para las métricas de respuestas por oposición.
    const answer = async (id, attemptId, userId, questionId, selected, correct) => {
      await db.query(
        `insert into public.attempt_answers(
           id, attempt_id, user_id, question_id, answer_sequence, selected_option, correct_option, is_correct
         ) values ($1, $2, $3, $4, 1, $5, 'B', $6)`,
        [id, attemptId, userId, questionId, selected, correct],
      );
    };
    await answer("30000000-0000-4000-8000-000000000221", "20000000-0000-4000-8000-000000000221", participants[0], "oracle-adm-qA", "B", true);
    await answer("30000000-0000-4000-8000-000000000222", "20000000-0000-4000-8000-000000000221", participants[0], "oracle-adm-qB", "A", false);
    await answer("30000000-0000-4000-8000-000000000223", "20000000-0000-4000-8000-000000000222", participants[1], "oracle-adm-qA", "A", false);

    // Actividad en RX-FIXTURE se siembra en FASES tras aplicar la migración
    // para verificar los umbrales de grupo 0 → 1 → 2 de «Falladas por todos».

    // Intento compuesto HISTÓRICO mezclado (sembrado directamente): no pertenece
    // a ninguna oposición y ningún selector puede reclasificarlo.
    await compositeAttempt("20000000-0000-4000-8000-000000000235", participants[0], "failed", [
      sourceOf(admExam, "oracle-adm-qA"), sourceOf(rxEam, "oracle-rx-qR2"),
    ]);

    const v2 = async (oppositionId) => (await db.query(
      "select public.get_opposition_dashboard_v2($1) as dashboard",
      [oppositionId],
    )).rows[0].dashboard;
    const legacy = async () => (await db.query("select public.get_dashboard() as dashboard")).rows[0].dashboard;
    const setAuth = (userId) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    const snapshot = async () => ({
      attempts: (await db.query("select id, user_id, exam_id, status, score from public.attempts order by id")).rows,
      sources: (await db.query("select attempt_id, position, question_id from public.attempt_question_sources order by attempt_id, position")).rows,
      progress: (await db.query("select user_id, exam_id, question_id, correct_count, wrong_count from public.question_progress order by user_id, exam_id, question_id")).rows,
      answers: (await db.query("select * from public.attempt_answers order by id")).rows,
    });

    // RESULTADO LEGACY IDÉNTICO ANTES/DESPUÉS de la migración nueva.
    await setAuth(participants[0]);
    const legacyBefore = JSON.stringify(await legacy());
    await db.exec(await readFile(new URL(migrationName, migrationsUrl), "utf8"));
    assert.equal(JSON.stringify(await legacy()), legacyBefore, "get_dashboard devuelve exactamente el mismo resultado antes y después de la migración");

    // UMBRAL DE GRUPO 0: rx-fixture sin actividad de participantes reales.
    const rxEmpty = await v2("rx-fixture");
    assert.deepEqual(rxEmpty.shared.profiles, [], "sin actividad persistida (grupo 0) la comparativa no contiene perfiles");
    assert.deepEqual(rxEmpty.shared.failed_by_all, [], "con grupo 0 «Falladas por todos» no aparece");
    assert.deepEqual(rxEmpty.shared.official_exam_rankings, [], "sin actividad no hay ranking");

    // UMBRAL DE GRUPO 1: solo P1 tiene actividad en rx-fixture.
    await compositeAttempt("20000000-0000-4000-8000-000000000231", participants[0], "failed", [sourceOf(rxEam, "oracle-rx-qR1")]);
    await progress(participants[0], rxEam.examId, "oracle-rx-qR1", 1);
    await progress(participants[0], rxEam.examId, "oracle-rx-qR2", 1);
    const rxSolo = await v2("rx-fixture");
    assert.deepEqual(
      rxSolo.shared.failed_by_all,
      [],
      "con un único participante activo (grupo 1) la pregunta que él falló NO se expone: el grupo unitario nunca identifica respuestas personales",
    );
    assert.equal(
      rxSolo.shared.profiles.length === 0 || (rxSolo.shared.profiles.length === 1 && rxSolo.shared.profiles[0].alias === "Participante 1"),
      true,
      "con grupo 1 la comparativa solo puede contener agregados del participante real activo (nunca admin/test ni sin actividad)",
    );

    // UMBRAL DE GRUPO 2: P2 se activa en rx-fixture; P3 sigue SIN actividad aquí.
    await officialAttempt("20000000-0000-4000-8000-000000000232", participants[1], rxEam, { score: 70 });
    await officialAttempt("20000000-0000-4000-8000-000000000233", adminUser, rxEam, { score: 95 });
    await officialAttempt("20000000-0000-4000-8000-000000000234", testUser, rxEam, { score: 55 });
    await progress(participants[1], rxEam.examId, "oracle-rx-qR1", 1);
    await progress(adminUser, rxEam.examId, "oracle-rx-qR1", 1);
    await progress(testUser, rxEam.examId, "oracle-rx-qR1", 1);
    await answer("30000000-0000-4000-8000-000000000231", "20000000-0000-4000-8000-000000000232", participants[1], "oracle-rx-qR1", "A", false);

    // DASHBOARD v2: aislamiento total de métricas, exámenes y preguntas.
    await setAuth(participants[0]);
    const admDash = await v2("administrativo");
    const serializedAdm = JSON.stringify(admDash);
    assert.equal(serializedAdm.includes(adminUser) || serializedAdm.includes(testUser), false, "el Dashboard v2 no expone cuentas admin/test");
    assert.equal(serializedAdm.includes("selected_option") || serializedAdm.includes("attempt_id"), false, "el Dashboard v2 no expone detalle de respuestas");
    assert.ok(admDash.personal.official_exams.every(({ exam_id: examId }) => examId === admExam.examId || examId.startsWith("sas-administrativo-")), "los exámenes personales pertenecen a la oposición solicitada");
    assert.equal(admDash.personal.official_exams.some(({ exam_id: examId }) => examId === rxEam.examId), false, "ningún examen de la otra oposición aparece en administrativo");
    assert.deepEqual(
      admDash.personal.questions.map(({ question_id: questionId }) => questionId).sort(),
      ["oracle-adm-qA", "oracle-adm-qB"],
      "las preguntas personales pertenecen exclusivamente a la oposición solicitada",
    );
    assert.equal(admDash.personal.global.answer_count, 2, "el resumen personal de administrativo deriva sus respuestas solo de intentos de esa oposición");
    assert.equal(admDash.personal.global.study_active_seconds, 210, "el tiempo activo de la oposición se deriva solo de sus intentos (normal, fallada y artificial)");
    assert.deepEqual(
      admDash.shared.profiles.map(({ alias }) => alias),
      ["Participante 1", "Participante 2", "Participante 3"],
      "la comparativa de administrativo contiene solo los participantes reales con actividad",
    );
    assert.deepEqual(
      admDash.shared.failed_by_all,
      [{ exam_id: admExam.examId, question_id: "oracle-adm-qA", failed_profile_count: 3 }],
      "«Falladas por todos» solo incluye la pregunta fallada por TODOS los participantes activos (grupo de 3); la fallada por 2 de 3 y por 1 de 3 quedan fuera",
    );
    assert.deepEqual(
      admDash.shared.official_exam_rankings.map(({ alias, rank }) => [alias, rank]),
      [["Participante 3", 1], ["Participante 1", 2], ["Participante 2", 3]],
      "el ranking agrega solo intentos oficiales de participantes activos de la oposición",
    );

    // GRUPO 2 consolidado: en rx-fixture solo P1 y P2 tienen actividad (P3 sin
    // actividad, admin/test excluidos): la pregunta fallada por ambos aparece.
    const rxDash = await v2("rx-fixture");
    const serializedRx = JSON.stringify(rxDash);
    assert.deepEqual(
      rxDash.shared.profiles.map(({ alias }) => alias),
      ["Participante 1", "Participante 2"],
      "la comparativa de rx-fixture excluye al participante sin actividad y a admin/test",
    );
    assert.equal(serializedRx.includes(inactiveInRx), false, "el participante sin actividad en la oposición no deja rastro en ella");
    assert.deepEqual(
      rxDash.shared.failed_by_all,
      [{ exam_id: rxEam.examId, question_id: "oracle-rx-qR1", failed_profile_count: 2 }],
      "con dos participantes activos, la pregunta fallada por los dos aparece (umbral 2)",
    );
    assert.equal(rxDash.shared.failed_by_all.some(({ question_id: questionId }) => questionId === "oracle-rx-qR2"), false, "la pregunta fallada por uno solo del grupo de dos no se expone");
    assert.deepEqual(rxDash.personal.questions.map(({ question_id: questionId }) => questionId).sort(), ["oracle-rx-qR1", "oracle-rx-qR2"], "las preguntas personales de rx-fixture son solo suyas");
    assert.equal(rxDash.personal.official_exams.some(({ exam_id: examId }) => examId === admExam.examId), false, "ningún examen de administrativo aparece en rx-fixture");
    assert.equal(rxDash.personal.global.answer_count, 0, "el resumen personal de rx-fixture no mezcla respuestas de administrativo");

    // HISTORIAL: la oposición de cada intento se resuelve en servidor.
    const historyRows = async (userId, oppositionId) => {
      await setAuth(userId);
      const filter = oppositionId ? "and opposition_id = $2" : "";
      const { rows } = await db.query(
        `select id, exam_id, kind, origin, opposition_id from public.personal_attempt_history
         where user_id = $1 ${filter} order by id`,
        oppositionId ? [userId, oppositionId] : [userId],
      );
      return rows;
    };
    const p1All = await historyRows(participants[0]);
    const byId = Object.fromEntries(p1All.map((row) => [row.id, row]));
    assert.equal(byId["20000000-0000-4000-8000-000000000221"].opposition_id, "administrativo", "el intento oficial se resuelve por exam_id mapeado");
    assert.equal(byId["20000000-0000-4000-8000-000000000225"].opposition_id, "administrativo", "el estudio normal se resuelve por exam_id mapeado");
    assert.equal(byId["20000000-0000-4000-8000-000000000226"].opposition_id, "administrativo", "la sesión de falladas se resuelve por sus fuentes persistidas");
    assert.equal(byId["20000000-0000-4000-8000-000000000228"].opposition_id, "administrativo", "el intento artificial se resuelve por sus fuentes persistidas");
    assert.equal(byId["20000000-0000-4000-8000-000000000231"].opposition_id, "rx-fixture", "la fallada de la segunda oposición se resuelve por sus fuentes");
    assert.equal(byId["20000000-0000-4000-8000-000000000235"].opposition_id, null, "un intento mezclado no pertenece a ninguna oposición");

    const p1Adm = await historyRows(participants[0], "administrativo");
    assert.deepEqual(
      p1Adm.map(({ id }) => id),
      ["20000000-0000-4000-8000-000000000221", "20000000-0000-4000-8000-000000000225", "20000000-0000-4000-8000-000000000226", "20000000-0000-4000-8000-000000000228"],
      "el Historial de administrativo contiene únicamente intentos de esa oposición (oficiales, falladas y artificial)",
    );
    const p1Rx = await historyRows(participants[0], "rx-fixture");
    assert.deepEqual(p1Rx.map(({ id }) => id), ["20000000-0000-4000-8000-000000000231"], "el Historial de la segunda oposición contiene únicamente sus intentos");
    assert.equal(
      p1Adm.some(({ id }) => id === "20000000-0000-4000-8000-000000000235") || p1Rx.some(({ id }) => id === "20000000-0000-4000-8000-000000000235"),
      false,
      "cambiar el selector no reclasifica el intento mezclado",
    );

    // Cualquier cuenta legítima obtiene su Historial por oposición.
    const adminHistory = await historyRows(adminUser, "rx-fixture");
    assert.deepEqual(adminHistory.map(({ exam_id: examId }) => examId), ["oracle-rx-exam"], "una cuenta admin obtiene su Historial por oposición");

    // ADMIN Y TEST: resumen personal disponible, comparativa solo de participantes.
    await setAuth(adminUser);
    const adminDash = await v2("rx-fixture");
    assert.equal(adminDash.personal.official_exams.some(({ exam_id: examId }) => examId === rxEam.examId), true, "una cuenta admin obtiene su resumen personal por oposición");
    assert.deepEqual(
      adminDash.shared.profiles.map(({ alias }) => alias),
      ["Participante 1", "Participante 2"],
      "las comparativas nunca contienen la actividad admin/test",
    );
    await setAuth(testUser);
    const testDash = await v2("rx-fixture");
    assert.equal(testDash.personal.global.answer_count >= 0, true, "una cuenta test obtiene su resumen personal por oposición");
    assert.deepEqual(
      testDash.shared.profiles.map(({ alias }) => alias),
      ["Participante 1", "Participante 2"],
      "las comparativas de la cuenta test tampoco se contaminan",
    );

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
    await db.exec("reset role");

    // REVISIÓN FIJADA TRAS CAMBIAR LA SELECCIÓN: ninguna lectura reclasifica,
    // recalcula ni escribe; el snapshot de datos persistidos queda idéntico.
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
    await setAuth(participants[0]);
    const dashAgain = await v2("administrativo");
    assert.equal(JSON.stringify(dashAgain.personal), JSON.stringify(admDash.personal), "el resumen personal es determinista entre lecturas");
    assert.deepEqual(await snapshot(), dataBefore, "las lecturas del Historial y del Dashboard no escriben intentos, fuentes, progreso ni respuestas");
  } finally {
    await db.close();
  }
});
