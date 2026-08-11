import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPublishedCatalog } from "../app/src/catalog.js";

const bankUrl = new URL("../app/public/data/exams/", import.meta.url);
const staticCatalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const authorizedVersions = staticCatalog.exams.map((entry) => ({
  exam_id: entry.id,
  exam_version_id: entry.latestVersion,
  exam_version_path: entry.latestPath,
}));

async function fileFetch(path) {
  try {
    const body = await readFile(new URL(path, bankUrl), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404 };
  }
}

test("muestra solo las versiones publicables actuales producidas por T01", async () => {
  const catalog = await loadPublishedCatalog(fileFetch, "./", authorizedVersions);
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map(({ id }) => id), [
    "sas-administrativo-2018-promocion-interna",
    "sas-administrativo-2021-turno-libre",
  ]);
  assert.equal(catalog.every(({ activeCount }) => activeCount === 150), true);
  assert.equal(catalog.every(({ durationMinutes }) => durationMinutes === 180), true);
  assert.equal(catalog.every(({ versionPath }) => versionPath.includes("/versions/")), true);
  assert.equal(catalog.every(({ questions }) => questions.length === 150), true);
});

test("descarta un paquete que no sea la versión publicable indicada", async () => {
  const fakeFetch = async (path) => {
    if (path.endsWith("catalog.json")) {
      return {
        ok: true,
        json: async () => ({ exams: [{ id: "exam", title: "Exam", latestPath: "exam.json", latestVersion: "current" }] }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        id: "exam",
        title: "Exam",
        durationMinutes: 120,
        version: { id: "older" },
        qa: { state: "publicable" },
        scorableSet: { state: "resolved", count: 1 },
        questions: [{ active: true }],
      }),
    };
  };
  assert.deepEqual(await loadPublishedCatalog(fakeFetch, "/bank/", [{
    exam_id: "exam", exam_version_id: "current", exam_version_path: "exam.json",
  }]), []);
});

test("el catálogo estático y el registro oficial se intersectan por identidad exacta", async () => {
  const third = {
    id: "exam-third",
    title: "Tercer examen",
    latestPath: "exam-third/versions/version-third.json",
    latestVersion: "version-third",
  };
  const packageBody = {
    id: third.id,
    title: third.title,
    durationMinutes: 120,
    version: { id: third.latestVersion },
    qa: { state: "publicable" },
    scorableSet: { state: "resolved", count: 1, questionNumbers: [1] },
    questions: [{ id: "exam-third-q1", sourceNumber: 1, active: true }],
  };
  const fetchWithThird = async (path) => ({
    ok: true,
    status: 200,
    json: async () => structuredClone(path.endsWith("catalog.json")
      ? { exams: [third] }
      : packageBody),
  });
  const exact = [{
    exam_id: third.id,
    exam_version_id: third.latestVersion,
    exam_version_path: third.latestPath,
  }];

  assert.deepEqual(await loadPublishedCatalog(fetchWithThird, "/bank/", []), []);
  assert.deepEqual(await loadPublishedCatalog(async () => ({
    ok: true, status: 200, json: async () => ({ exams: [] }),
  }), "/bank/", exact), []);
  assert.equal((await loadPublishedCatalog(fetchWithThird, "/bank/", exact))[0].id, third.id);
  assert.deepEqual(await loadPublishedCatalog(fetchWithThird, "/bank/", [{
    ...exact[0], exam_version_path: "exam-third/versions/other.json",
  }]), []);
  assert.deepEqual(await loadPublishedCatalog(fetchWithThird, "/bank/", [{
    ...exact[0], exam_version_id: "other-version",
  }]), []);
});
