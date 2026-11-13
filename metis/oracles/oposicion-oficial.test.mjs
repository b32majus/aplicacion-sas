// Oráculo Metis · unidad m01-oposicion-oficial
// Contrato: registro de oposiciones con mapeo administrativo explícito, RPC v2
// autenticada de metadata publicada (conservando la RPC v1), incorporación del
// opposition_id en el frontend solo por tuplo exacto y proyección visible por
// oposición sin perder el catálogo autorizado completo.
//
// El oráculo no usa dependencias externas (el entorno de verificación ejecuta los
// witnesses sobre una copia limpia del checkout, sin node_modules): el contrato
// SQL se verifica de forma estructural sobre el archivo de migración y el
// contrato de frontend se verifica conductualmente con fetch/client simulados.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as catalogModule from "../../app/src/catalog.js";
import * as historyModule from "../../app/src/history.js";
import { isActiveExam } from "../../app/src/exam-clock.js";

const migrationsUrl = new URL("../../supabase/migrations/", import.meta.url);
const migrationName = "20261113090000_opposition_registry.sql";
const catalogUrl = new URL("../../app/public/data/exams/catalog.json", import.meta.url);
const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);

function stripSqlComments(sql) {
  return sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
}

function statementAfter(sql, pattern) {
  const match = sql.match(pattern);
  if (!match) return null;
  const end = sql.indexOf(";", match.index);
  return sql.slice(match.index, end === -1 ? sql.length : end);
}

async function readMigration() {
  try {
    const raw = await readFile(new URL(migrationName, migrationsUrl), "utf8");
    return { raw, sql: stripSqlComments(raw) };
  } catch {
    return null;
  }
}

async function readStaticCatalog() {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  assert.equal(catalog.schemaVersion, "1.0", "el catálogo estático conserva el esquema 1.0");
  assert.ok(
    catalog.exams.every((entry) => !Object.hasOwn(entry, "oppositionId") && !Object.hasOwn(entry, "opposition_id")),
    "el catálogo estático no incorpora campos de oposición",
  );
  return catalog;
}

async function fileFetch(path) {
  try {
    const body = await readFile(new URL(path, bankUrl), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404 };
  }
}

function fixturePackage(examId, title, questionCount) {
  const questions = Array.from({ length: questionCount }, (_, index) => ({
    id: `${examId}-q${String(index + 1).padStart(3, "0")}`,
    sourceNumber: index + 1,
    active: true,
    text: `Pregunta ${index + 1} de ${title}`,
    options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }],
    correctOption: "B",
  }));
  return {
    id: examId,
    title,
    durationMinutes: 120,
    version: { id: `version-${examId}` },
    qa: { state: "publicable" },
    scorableSet: {
      state: "resolved",
      count: questionCount,
      questionNumbers: questions.map(({ sourceNumber }) => sourceNumber),
    },
    questions,
  };
}

function twoOppositionFixture(staticCatalog) {
  const adminEntry = staticCatalog.exams.find(({ id }) => id === "sas-administrativo-2023-turno-libre");
  const rxExamId = "sas-radiodiagnostico-fixture-2026";
  const rxVersionPath = `${rxExamId}/versions/version-rx-fixture.json`;
  const rxPackage = fixturePackage(rxExamId, "SAS Radiodiagnóstico (fixture)", 80);
  const rxEntry = { id: rxExamId, title: rxPackage.title, latestVersion: rxPackage.version.id, latestPath: rxVersionPath };
  const fetchImpl = async (path) => {
    if (path.endsWith("catalog.json")) {
      return { ok: true, status: 200, json: async () => ({ exams: structuredClone([adminEntry, rxEntry]) }) };
    }
    if (path.endsWith(rxVersionPath)) {
      return { ok: true, status: 200, json: async () => structuredClone(rxPackage) };
    }
    return fileFetch(path);
  };
  const registry = [
    {
      exam_id: adminEntry.id,
      exam_version_id: adminEntry.latestVersion,
      exam_version_path: adminEntry.latestPath,
      opposition_id: "administrativo",
      opposition_name: "Administrativo",
    },
    {
      exam_id: rxExamId,
      exam_version_id: rxEntry.latestVersion,
      exam_version_path: rxVersionPath,
      opposition_id: "radiodiagnostico",
      opposition_name: "Radiodiagnóstico",
    },
  ];
  return { fetchImpl, registry, rxExamId };
}

function realRegistryRows(staticCatalog) {
  return staticCatalog.exams.map((entry) => ({
    exam_id: entry.id,
    exam_version_id: entry.latestVersion,
    exam_version_path: entry.latestPath,
    opposition_id: "administrativo",
    opposition_name: "Administrativo",
  }));
}

test("la migración nueva crea el registro de oposiciones con nombre público y mapeo administrativo explícito", async () => {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con el registro de oposiciones (forward-only).`);
  }
  assert.match(migration.raw, /--\s*[^\n]*oposición/i, "la migración debe explicar su operativa en español");
  const sql = migration.sql;

  const oppositionsStatement = statementAfter(sql, /create\s+table\s+(if\s+not\s+exists\s+)?public\.oppositions\b/i);
  assert.ok(oppositionsStatement, "falta create table public.oppositions");
  assert.match(oppositionsStatement, /public_name/i, "public.oppositions debe registrar el nombre público");
  const mappingStatement = statementAfter(sql, /create\s+table\s+(if\s+not\s+exists\s+)?public\.opposition_exams\b/i);
  assert.ok(mappingStatement, "falta create table public.opposition_exams (mapeo por exam_id)");
  assert.match(mappingStatement, /exam_id/i, "el mapeo debe ser por exam_id");
  assert.match(mappingStatement, /opposition_id/i, "el mapeo debe referenciar la oposición");
  assert.match(mappingStatement, /references/i, "el mapeo debe ser una referencia verificable por servidor");
});

test("la migración siembra exactamente los 12 Administrativo y no toca los registros oficiales inmutables", async () => {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con el registro de oposiciones (forward-only).`);
  }
  const sql = migration.sql;
  const staticCatalog = await readStaticCatalog();
  const expectedExamIds = staticCatalog.exams.map(({ id }) => id).sort();

  const oppositionSeed = statementAfter(sql, /insert\s+into\s+public\.oppositions\b/i);
  assert.ok(oppositionSeed, "falta la siembra de la oposición con nombre público");
  assert.match(oppositionSeed, /'administrativo'/i, "falta la oposición sembrada con id administrativo");
  assert.match(oppositionSeed, /'Administrativo'/, "falta el nombre público «Administrativo»");

  const mappingSeed = statementAfter(sql, /insert\s+into\s+public\.opposition_exams\b/i);
  assert.ok(mappingSeed, "falta la siembra del mapeo de exámenes a oposiciones");
  const literals = [...mappingSeed.matchAll(/'([^']*)'/g)].map((match) => match[1]);
  const mappedExamIds = literals.filter((literal) => expectedExamIds.includes(literal));
  assert.deepEqual(
    [...new Set(mappedExamIds)].sort(),
    expectedExamIds,
    "el mapeo sembrado debe cubrir exactamente los 12 exam_id existentes del catálogo",
  );
  assert.equal(mappedExamIds.length, expectedExamIds.length, "cada exam_id debe aparecer una única vez en el mapeo");
  const remaining = literals.filter((literal) => !expectedExamIds.includes(literal));
  assert.ok(
    remaining.length > 0 && remaining.every((literal) => literal.toLowerCase() === "administrativo"),
    "todos los exam_id sembrados deben mapear a la oposición administrativo",
  );

  assert.doesNotMatch(sql, /insert\s+into\s+public\.official_exam_versions\b/i, "la migración no debe añadir registros oficiales");
  assert.doesNotMatch(sql, /update\s+public\.official_exam_versions\b/i, "la migración no debe modificar registros oficiales");
  assert.doesNotMatch(sql, /delete\s+from\s+public\.official_exam_versions\b/i, "la migración no debe eliminar registros oficiales");
  assert.doesNotMatch(sql, /drop\s+(table|function)\b/i, "la migración debe ser forward-only, sin operaciones destructivas");
});

test("la migración crea la RPC v2 de metadata publicada con grants de autenticados y conserva la RPC v1", async () => {
  const migration = await readMigration();
  if (migration === null) {
    assert.fail(`Falta la migración ${migrationName} con el registro de oposiciones (forward-only).`);
  }
  const sql = migration.sql;
  const functionMatch = sql.match(/create\s+(or\s+replace\s+)?function\s+public\.get_published_official_exam_versions_v2\s*\(\)/i);
  assert.ok(functionMatch, "falta la RPC v2 public.get_published_official_exam_versions_v2()");
  const signature = sql.slice(functionMatch.index, sql.indexOf("$$", functionMatch.index));
  for (const column of ["exam_id", "exam_version_id", "exam_version_path", "opposition_id", "opposition_name"]) {
    assert.match(signature, new RegExp(`${column}\\s+text`, "i"), `la RPC v2 debe exponer la columna ${column}`);
  }
  const bodyMatch = sql.slice(functionMatch.index).match(/\$\$([\s\S]*?)\$\$/);
  assert.ok(bodyMatch, "falta el cuerpo SQL de la RPC v2");
  assert.match(bodyMatch[1], /official_exam_versions/i, "la RPC v2 debe proyectar el registro oficial publicado");
  assert.match(bodyMatch[1], /opposition/i, "la RPC v2 debe resolver la oposición desde el mapeo del servidor");
  assert.match(bodyMatch[1], /is_published/i, "la RPC v2 solo debe devolver versiones publicadas");

  const revokeMatch = sql.match(/revoke\s+all[^;]*get_published_official_exam_versions_v2/i);
  assert.ok(revokeMatch, "la RPC v2 debe revocarse para public/anon/authenticated antes de concederse");
  const revokeStatement = sql.slice(revokeMatch.index, sql.indexOf(";", revokeMatch.index));
  assert.match(revokeStatement, /anon/i);
  assert.match(revokeStatement, /authenticated/i);
  const grantMatch = sql.match(/grant\s+execute[^;]*get_published_official_exam_versions_v2/i);
  assert.ok(grantMatch, "la RPC v2 debe concederse a authenticated");
  const grantStatement = sql.slice(grantMatch.index, sql.indexOf(";", grantMatch.index));
  assert.match(grantStatement, /to\s+authenticated/i);

  assert.doesNotMatch(
    sql,
    /revoke[^;]*get_published_official_exam_versions\s*\(\)/i,
    "la RPC v1 debe seguir operativa (sin revoke en la migración nueva)",
  );
  const tableProtection = sql.match(/revoke\s+all[^;]*on\s+table\s+public\.oppositions/i);
  assert.ok(tableProtection, "las tablas nuevas deben quedar sin acceso directo (propiedad administrativa)");
  assert.match(sql.slice(tableProtection.index, sql.indexOf(";", tableProtection.index)), /authenticated/i);
});

test("el frontend incorpora opposition_id únicamente por tuplo exacto con la RPC v2", async () => {
  assert.equal(
    typeof catalogModule.loadPublishedCatalog,
    "function",
    "app/src/catalog.js debe seguir exportando loadPublishedCatalog",
  );
  const staticCatalog = await readStaticCatalog();

  const realBank = await catalogModule.loadPublishedCatalog(fileFetch, "./", realRegistryRows(staticCatalog));
  assert.equal(realBank.length, 12);
  assert.ok(realBank.every((entry) => entry.oppositionId === "administrativo" && entry.oppositionName === "Administrativo"));

  const { fetchImpl, registry, rxExamId } = twoOppositionFixture(staticCatalog);
  const mixed = await catalogModule.loadPublishedCatalog(fetchImpl, "./", registry);
  assert.deepEqual(mixed.map(({ id, oppositionId }) => ({ id, oppositionId })), [
    { id: "sas-administrativo-2023-turno-libre", oppositionId: "administrativo" },
    { id: rxExamId, oppositionId: "radiodiagnostico" },
  ]);

  const missingOpposition = registry.map(({ opposition_id: drop, opposition_name: dropName, ...row }) => row);
  assert.deepEqual(
    await catalogModule.loadPublishedCatalog(fetchImpl, "./", missingOpposition),
    [],
    "una fila del registro sin opposition_id hace fallar cerrado la entrada",
  );

  const altered = registry.map((row) => (
    row.exam_id === rxExamId ? { ...row, exam_version_path: `${rxExamId}/versions/otra.json` } : row
  ));
  assert.deepEqual(
    (await catalogModule.loadPublishedCatalog(fetchImpl, "./", altered)).map(({ id }) => id),
    ["sas-administrativo-2023-turno-libre"],
    "una identidad alterada del tuplo hace fallar cerrado la entrada",
  );

  await assert.rejects(
    catalogModule.loadPublishedCatalog(fileFetch, "./", null),
    /registro oficial publicado no está disponible/,
    "un error de autorización del registro no cae al catálogo estático",
  );
});

test("el selector deriva las oposiciones del servidor y la proyección no muta el catálogo completo", async () => {
  assert.equal(
    typeof catalogModule.listPublishedOppositions,
    "function",
    "app/src/catalog.js debe exponer listPublishedOppositions para el selector",
  );
  assert.equal(
    typeof catalogModule.filterCatalogByOpposition,
    "function",
    "app/src/catalog.js debe exponer filterCatalogByOpposition para la proyección visible",
  );

  const staticCatalog = await readStaticCatalog();
  const realBank = await catalogModule.loadPublishedCatalog(fileFetch, "./", realRegistryRows(staticCatalog));
  assert.deepEqual(catalogModule.listPublishedOppositions(realBank), [
    { id: "administrativo", name: "Administrativo" },
  ]);

  const { fetchImpl, registry, rxExamId } = twoOppositionFixture(staticCatalog);
  const mixed = await catalogModule.loadPublishedCatalog(fetchImpl, "./", registry);
  assert.deepEqual(catalogModule.listPublishedOppositions(mixed), [
    { id: "administrativo", name: "Administrativo" },
    { id: "radiodiagnostico", name: "Radiodiagnóstico" },
  ]);

  const visible = catalogModule.filterCatalogByOpposition(mixed, "radiodiagnostico");
  assert.deepEqual(visible.map(({ id }) => id), [rxExamId]);
  assert.equal(mixed.length, 2, "el catálogo autorizado completo se conserva para consumidores históricos");
  assert.deepEqual(catalogModule.filterCatalogByOpposition(mixed, "oposicion-inexistente"), []);
});

test("los consumidores históricos conservan su contrato: reanudación con versión fijada y guard de reloj", async () => {
  assert.equal(
    typeof historyModule.loadHistoryReplay,
    "function",
    "app/src/history.js debe seguir exportando loadHistoryReplay",
  );
  const packageA = {
    id: "exam-a",
    title: "Examen histórico A",
    durationMinutes: 90,
    version: { id: "version-a" },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 1, questionNumbers: [1] },
    questions: [{
      id: "exam-a-q001",
      sourceNumber: 1,
      active: true,
      text: "Texto histórico A",
      options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }],
      correctOption: "B",
    }],
  };
  const client = {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order: async () => ({ data: [], error: null }),
      };
      return builder;
    },
  };
  const replay = await historyModule.loadHistoryReplay(client, async (path) => ({
    ok: true,
    status: 200,
    json: async () => structuredClone(packageA),
  }), "/bank/", {
    id: "attempt-a",
    exam_id: "exam-a",
    exam_version_id: "version-a",
    exam_version_path: "exam-a/versions/version-a.json",
    question_ids: ["exam-a-q001"],
    kind: "exam",
  });
  assert.equal(replay.questions[0].text, "Texto histórico A");

  const activeExam = {
    status: "active",
    deadline_at: "2026-01-01T00:00:00Z",
    exam_id: "sas-administrativo-2023-turno-libre",
    origin: "official",
  };
  assert.equal(isActiveExam(activeExam, Number.NaN), true);
  assert.equal(isActiveExam({ ...activeExam, status: "completed" }, Number.NaN), false);
});
