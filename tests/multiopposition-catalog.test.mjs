// Contrato de catálogo multioposición (unidad m01-oposicion-oficial).
//
// Dos oposiciones SOLO en fixture (Administrativo real del catálogo estático +
// una oposición Radiodiagnóstico ficticia servida por el fetch simulado): el
// frontend incorpora la oposición por tuplo exacto, falla cerrado ante una
// identidad alterada y proyecta por oposición sin mutar el catálogo completo.
// La parte conductual de la migración (RPC v2/v1 y privilegios) se verifica en
// PostgreSQL con PGlite aplicando todas las migraciones del repositorio.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import {
  filterCatalogByOpposition,
  listPublishedOppositions,
  loadPublishedCatalog,
} from "../app/src/catalog.js";

const bankUrl = new URL("../app/public/data/exams/", import.meta.url);
const staticCatalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

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

function twoOppositionFixture() {
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

test("dos oposiciones en fixture: tuplo exacto, selección y proyección sin mutar el catálogo completo", async () => {
  const { fetchImpl, registry, rxExamId } = twoOppositionFixture();
  const complete = await loadPublishedCatalog(fetchImpl, "./", registry);
  const snapshot = structuredClone(complete);

  assert.deepEqual(complete.map(({ id, oppositionId }) => ({ id, oppositionId })), [
    { id: "sas-administrativo-2023-turno-libre", oppositionId: "administrativo" },
    { id: rxExamId, oppositionId: "radiodiagnostico" },
  ]);
  assert.ok(complete.every(({ oppositionName }) => oppositionName));

  assert.deepEqual(listPublishedOppositions(complete), [
    { id: "administrativo", name: "Administrativo" },
    { id: "radiodiagnostico", name: "Radiodiagnóstico" },
  ]);

  const visible = filterCatalogByOpposition(complete, "radiodiagnostico");
  assert.deepEqual(visible.map(({ id }) => id), [rxExamId]);
  assert.deepEqual(
    filterCatalogByOpposition(complete, "administrativo").map(({ id }) => id),
    ["sas-administrativo-2023-turno-libre"],
  );
  assert.deepEqual(filterCatalogByOpposition(complete, "oposicion-inexistente"), []);
  assert.deepEqual(filterCatalogByOpposition(complete, undefined), []);

  visible.push({ id: "intruso" });
  assert.equal(complete.length, 2, "la proyección devuelve un array nuevo y el catálogo completo no se muta");
  assert.deepEqual(complete, snapshot, "el catálogo autorizado completo conserva su contenido");

  const reprojected = filterCatalogByOpposition(complete, "radiodiagnostico");
  assert.deepEqual(reprojected.map(({ id }) => id), [rxExamId]);
});

test("una identidad alterada o una fila sin oposición hace fallar cerrado la entrada", async () => {
  const { fetchImpl, registry, rxExamId } = twoOppositionFixture();

  const altered = registry.map((row) => (
    row.exam_id === rxExamId ? { ...row, exam_version_path: `${rxExamId}/versions/otra.json` } : row
  ));
  const onlyAdmin = await loadPublishedCatalog(fetchImpl, "./", altered);
  assert.deepEqual(onlyAdmin.map(({ id }) => id), ["sas-administrativo-2023-turno-libre"]);

  const withoutOpposition = registry.map(({ opposition_id: dropId, opposition_name: dropName, ...row }) => row);
  assert.deepEqual(await loadPublishedCatalog(fetchImpl, "./", withoutOpposition), []);

  const renamedOpposition = registry.map((row) => (
    row.exam_id === rxExamId ? { ...row, opposition_name: "" } : row
  ));
  assert.deepEqual((await loadPublishedCatalog(fetchImpl, "./", renamedOpposition)).map(({ id }) => id), [
    "sas-administrativo-2023-turno-libre",
  ]);

  await assert.rejects(
    loadPublishedCatalog(fetchImpl, "./", null),
    /registro oficial publicado no está disponible/,
    "sin registro publicado no hay fallback al catálogo estático libre",
  );
});

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
  return db;
}

test("la migración registra la oposición y expone la metadata solo por la RPC v2 con mapeo explícito", async () => {
  const db = await migratedDatabase();
  try {
    const mappedExamId = "sas-administrativo-2023-turno-libre";
    const unmappedExamId = "exam-publicado-sin-mapeo";
    await db.query(
      `insert into public.official_exam_versions(
         exam_id, exam_version_id, exam_version_path, duration_minutes,
         question_ids, answer_key, is_published
       ) values
         ($1, 'version-multi', $2, 120, array['q1'], '{"q1":"B"}'::jsonb, true),
         ($3, 'version-x', $4, 90, array['q1'], '{"q1":"B"}'::jsonb, true)`,
      [
        mappedExamId,
        `${mappedExamId}/versions/version-multi.json`,
        unmappedExamId,
        `${unmappedExamId}/versions/version-x.json`,
      ],
    );

    const { rows: v1Rows } = await db.query("select * from public.get_published_official_exam_versions()");
    assert.equal(v1Rows.length, 4, "la RPC v1 sigue operativa con su contrato de tres columnas");
    for (const row of v1Rows) {
      assert.deepEqual(Object.keys(row).sort(), ["exam_id", "exam_version_id", "exam_version_path"]);
    }
    assert.ok(
      v1Rows.some(({ exam_id }) => exam_id === unmappedExamId),
      "la RPC v1 no conoce oposiciones y conserva su comportamiento",
    );

    const { rows: v2Rows } = await db.query("select * from public.get_published_official_exam_versions_v2()");
    for (const row of v2Rows) {
      assert.deepEqual(Object.keys(row).sort(), [
        "exam_id", "exam_version_id", "exam_version_path", "opposition_id", "opposition_name",
      ], "la RPC v2 expone exactamente las cinco columnas de metadata y nunca la clave");
    }
    assert.ok(
      v2Rows.every(({ opposition_id: oppositionId }) => oppositionId === "administrativo"),
      "todo lo publicado y mapeado pertenece a la oposición sembrada",
    );
    assert.ok(
      !v2Rows.some(({ exam_id }) => exam_id === unmappedExamId),
      "un examen publicado sin fila de mapeo explícita no se expone",
    );
    assert.deepEqual(
      v2Rows.find(({ exam_id }) => exam_id === mappedExamId),
      {
        exam_id: mappedExamId,
        exam_version_id: "version-multi",
        exam_version_path: `${mappedExamId}/versions/version-multi.json`,
        opposition_id: "administrativo",
        opposition_name: "Administrativo",
      },
    );
    assert.equal(v2Rows.length, 3, "las dos siembras históricas y la nueva fila mapeada");

    const { rows: [seeded] } = await db.query(
      "select id, public_name from public.oppositions order by id",
    );
    assert.deepEqual(seeded, { id: "administrativo", public_name: "Administrativo" });

    await db.query("set role authenticated");
    await assert.rejects(
      db.query("select * from public.oppositions"),
      /permission denied/i,
      "el registro no admite lectura directa de autenticados",
    );
    await assert.rejects(
      db.query("select * from public.opposition_exams"),
      /permission denied/i,
      "el mapeo no admite lectura directa de autenticados",
    );
    const { rows: viaRpc } = await db.query("select * from public.get_published_official_exam_versions_v2()");
    assert.equal(viaRpc.length, 3, "la RPC v2 es ejecutable por authenticated y solo por authenticated");
    await db.exec("reset role");

    const { rows: [privileges] } = await db.query(`select
      has_table_privilege('anon', 'public.oppositions', 'select') as anon_table,
      has_table_privilege('authenticated', 'public.oppositions', 'select') as auth_table,
      has_table_privilege('authenticated', 'public.opposition_exams', 'select') as auth_mapping,
      has_function_privilege('authenticated', 'public.get_published_official_exam_versions_v2()', 'execute') as auth_v2,
      has_function_privilege('authenticated', 'public.get_published_official_exam_versions()', 'execute') as auth_v1,
      has_function_privilege('anon', 'public.get_published_official_exam_versions_v2()', 'execute') as anon_v2`);
    assert.deepEqual(privileges, {
      anon_table: false,
      auth_table: false,
      auth_mapping: false,
      auth_v2: true,
      auth_v1: true,
      anon_v2: false,
    });
  } finally {
    await db.close();
  }
});
