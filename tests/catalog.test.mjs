import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPublishedCatalog } from "../app/src/catalog.js";

const bankUrl = new URL("../app/public/data/exams/", import.meta.url);

async function fileFetch(path) {
  try {
    const body = await readFile(new URL(path, bankUrl), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404 };
  }
}

test("muestra solo las versiones publicables actuales producidas por T01", async () => {
  const catalog = await loadPublishedCatalog(fileFetch, "./");
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map(({ id }) => id), [
    "sas-administrativo-2018-promocion-interna",
    "sas-administrativo-2021-turno-libre",
  ]);
  assert.equal(catalog.every(({ activeCount }) => activeCount === 150), true);
  assert.equal(catalog.every(({ durationMinutes }) => durationMinutes === 180), true);
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
  assert.deepEqual(await loadPublishedCatalog(fakeFetch, "/bank/"), []);
});
