// Oráculo Metis · unidad m01-oposicion-oficial
// Contrato: registro de oposiciones con mapeo administrativo explícito, RPC v2
// autenticada de metadata publicada (conservando la RPC v1), incorporación del
// opposition_id en el frontend solo por tuplo exacto y proyección visible por
// oposición sin perder el catálogo autorizado completo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import * as catalogModule from "../../app/src/catalog.js";
import { isActiveExam } from "../../app/src/exam-clock.js";

const migrationsUrl = new URL("../../supabase/migrations/", import.meta.url);
const migrationName = "20261113090000_opposition_registry.sql";
const catalogUrl = new URL("../../app/public/data/exams/catalog.json", import.meta.url);
const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);

const expectedColumnsV2 = [
  "exam_id",
  "exam_version_id",
  "exam_version_path",
  "opposition_id",
  "opposition_name",
];

async function readStaticCatalog() {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  assert.equal(catalog.schemaVersion, "1.0", "el catálogo estático conserva el esquema 1.0");
  assert.ok(
    catalog.exams.every((entry) => !Object.hasOwn(entry, "oppositionId") && !Object.hasOwn(entry, "opposition_id")),
    "el catálogo estático no incorpora campos de oposición",
  );
  return catalog;
}

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
  for (const name of migrations) {
    await db.exec(await readFile(new URL(name, migrationsUrl), "utf8"));
  }
  return db;
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

test("la migración registra la oposición con nombre público y siembra exactamente los 12 Administrativo", async () => {
  const migration = await readFile(new URL(migrationName, migrationsUrl), "utf8");
  assert.match(migration, /--\s*[^\n]*oposición/i, "la migración debe explicar su operativa en español");

  const db = await migratedDatabase();
  try {
    const { rows: oppositionTable } = await db.query(
      "select to_regclass('public.oppositions') as registered",
    );
    assert.ok(oppositionTable[0].registered, "falta la tabla public.oppositions");
    const { rows: mappingTable } = await db.query(
      "select to_regclass('public.opposition_exams') as registered",
    );
    assert.ok(mappingTable[0].registered, "falta la tabla de mapeo public.opposition_exams");

    const { rows: oppositions } = await db.query(
      "select id, public_name from public.oppositions order by id",
    );
    assert.deepEqual(oppositions, [{ id: "administrativo", public_name: "Administrativo" }]);

    const staticCatalog = await readStaticCatalog();
    const expectedExamIds = staticCatalog.exams.map(({ id }) => id).sort();
    const { rows: mapping } = await db.query(
      "select exam_id, opposition_id from public.opposition_exams order by exam_id",
    );
    assert.equal(mapping.length, 12, "el mapeo sembrado debe contener exactamente los 12 exámenes existentes");
    assert.deepEqual(mapping.map(({ exam_id: examId }) => examId), expectedExamIds);
    assert.ok(mapping.every(({ opposition_id: oppositionId }) => oppositionId === "administrativo"));

    const { rows: [{ seeded }] } = await db.query(
      "select count(*)::integer as seeded from public.official_exam_versions",
    );
    assert.equal(seeded, 2, "la migración no debe añadir ni eliminar registros oficiales inmutables");
    const { rows: officialIds } = await db.query("select exam_id from public.official_exam_versions order by exam_id");
    assert.ok(officialIds.every(({ exam_id: examId }) => expectedExamIds.includes(examId)));
  } finally {
    await db.close();
  }
});

test("la RPC v2 autenticada devuelve solo metadata publicada y la RPC v1 sigue operativa", async () => {
  const db = await migratedDatabase();
  try {
    const { rows: [{ registered }] } = await db.query(
      "select to_regprocedure('public.get_published_official_exam_versions_v2()') as registered",
    );
    assert.ok(
      registered,
      "falta la RPC v2 public.get_published_official_exam_versions_v2()",
    );

    const { rows: v1 } = await db.query("select * from public.get_published_official_exam_versions()");
    assert.equal(v1.length, 2);
    assert.deepEqual(Object.keys(v1[0]).sort(), ["exam_id", "exam_version_id", "exam_version_path"]);
    assert.ok(v1.every((row) => typeof row.exam_id === "string" && row.exam_id.startsWith("sas-administrativo-")));

    const { rows: v2 } = await db.query("select * from public.get_published_official_exam_versions_v2()");
    assert.equal(v2.length, 2, "la RPC v2 debe devolver los registros publicados con mapeo explícito");
    assert.deepEqual(Object.keys(v2[0]).sort(), expectedColumnsV2.sort(), "la RPC v2 solo puede exponer metadata publicada");
    assert.ok(v2.every((row) => row.opposition_id === "administrativo" && row.opposition_name === "Administrativo"));
    assert.deepEqual(v2.map(({ exam_id: examId }) => examId).sort(), v1.map(({ exam_id: examId }) => examId).sort());

    const { rows: [privileges] } = await db.query(`select
      has_function_privilege('anon', 'public.get_published_official_exam_versions_v2()', 'execute') as anon_v2,
      has_function_privilege('authenticated', 'public.get_published_official_exam_versions_v2()', 'execute') as auth_v2,
      has_function_privilege('authenticated', 'public.get_published_official_exam_versions()', 'execute') as auth_v1,
      has_table_privilege('authenticated', 'public.oppositions', 'select') as table_oppositions,
      has_table_privilege('authenticated', 'public.opposition_exams', 'select') as table_mapping`);
    assert.deepEqual(privileges, {
      anon_v2: false,
      auth_v2: true,
      auth_v1: true,
      table_oppositions: false,
      table_mapping: false,
    });
  } finally {
    await db.close();
  }
});

test("la RPC v2 falla cerrado sin correspondencia explícita y expone dos oposiciones en fixture", async () => {
  const db = await migratedDatabase();
  try {
    await db.query(
      `insert into public.official_exam_versions(
         exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key, is_published
       ) values (
         'sas-administrativo-2099-turno-libre', 'version-no-mapeada',
         'sas-administrativo-2099-turno-libre/versions/version-no-mapeada.json', 120,
         array['sas-administrativo-2099-turno-libre-q001'],
         '{"sas-administrativo-2099-turno-libre-q001":"B"}'::jsonb, true)`,
    );
    const { rows: withoutMapping } = await db.query(
      "select exam_id from public.get_published_official_exam_versions_v2()",
    );
    assert.ok(
      withoutMapping.every(({ exam_id: examId }) => examId !== "sas-administrativo-2099-turno-libre"),
      "un examen publicado sin mapeo explícito no se expone aunque su prefijo parezca de la oposición",
    );

    await db.query("insert into public.oppositions(id, public_name) values ('radiodiagnostico', 'Radiodiagnóstico')");
    await db.query(
      "insert into public.opposition_exams(exam_id, opposition_id) values ('sas-radiodiagnostico-2026-turno-libre', 'radiodiagnostico')",
    );
    await db.query(
      `insert into public.official_exam_versions(
         exam_id, exam_version_id, exam_version_path, duration_minutes, question_ids, answer_key, is_published
       ) values (
         'sas-radiodiagnostico-2026-turno-libre', 'version-rx-fixture',
         'sas-radiodiagnostico-2026-turno-libre/versions/version-rx-fixture.json', 120,
         array['sas-radiodiagnostico-2026-turno-libre-q001'],
         '{"sas-radiodiagnostico-2026-turno-libre-q001":"A"}'::jsonb, true)`,
    );

    const { rows: v2 } = await db.query("select * from public.get_published_official_exam_versions_v2()");
    const rx = v2.find(({ exam_id: examId }) => examId === "sas-radiodiagnostico-2026-turno-libre");
    assert.ok(rx, "la oposición publicada en fixture debe aparecer en la RPC v2");
    assert.equal(rx.opposition_id, "radiodiagnostico");
    assert.equal(rx.opposition_name, "Radiodiagnóstico");
    assert.equal(Object.hasOwn(rx, "answer_key"), false);
    assert.equal(v2.filter(({ exam_id: examId }) => examId === "sas-administrativo-2099-turno-libre").length, 0);

    const { rows: v1 } = await db.query("select * from public.get_published_official_exam_versions()");
    assert.equal(v1.length, 4, "la RPC v1 conserva el registro publicado completo, con o sin mapeo de oposición");
    assert.deepEqual(Object.keys(v1[0]).sort(), ["exam_id", "exam_version_id", "exam_version_path"]);
    assert.ok(v1.some(({ exam_id: examId }) => examId === "sas-radiodiagnostico-2026-turno-libre"));
    assert.ok(v1.some(({ exam_id: examId }) => examId === "sas-administrativo-2099-turno-libre"));
  } finally {
    await db.close();
  }
});

test("el frontend incorpora opposition_id únicamente por tuplo exacto con la RPC v2", async () => {
  assert.equal(
    typeof catalogModule.loadPublishedCatalog,
    "function",
    "app/src/catalog.js debe seguir exportando loadPublishedCatalog",
  );
  const staticCatalog = await readStaticCatalog();
  const realRegistry = staticCatalog.exams.map((entry) => ({
    exam_id: entry.id,
    exam_version_id: entry.latestVersion,
    exam_version_path: entry.latestPath,
    opposition_id: "administrativo",
    opposition_name: "Administrativo",
  }));

  const realBank = await catalogModule.loadPublishedCatalog(fileFetch, "./", realRegistry);
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
  const realRegistry = staticCatalog.exams.map((entry) => ({
    exam_id: entry.id,
    exam_version_id: entry.latestVersion,
    exam_version_path: entry.latestPath,
    opposition_id: "administrativo",
    opposition_name: "Administrativo",
  }));
  const realBank = await catalogModule.loadPublishedCatalog(fileFetch, "./", realRegistry);
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

test("el guard y el reloj oficiales se conservan: un activo sin offset fiable permanece bloqueado", () => {
  const activeExam = {
    status: "active",
    deadline_at: "2026-01-01T00:00:00Z",
    exam_id: "sas-administrativo-2023-turno-libre",
    origin: "official",
  };
  assert.equal(isActiveExam(activeExam, Number.NaN), true);
  assert.equal(isActiveExam({ ...activeExam, status: "completed" }, Number.NaN), false);
});
