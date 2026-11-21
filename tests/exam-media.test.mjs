// Pruebas de contrato aisladas de la unidad m05-casos-multimedia.
//
// Todo el contenido es SINTÉTICO: los PNG se generan aquí y la red se simula
// con un fetchImpl de fixture. Ninguna fuente RX privada se lee ni se publica,
// y los paquetes sin media demuestran que no se añade ninguna petición.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

import {
  resolveQuestionMedia,
  validatePackageMedia,
  verifyPackageMedia,
} from "../app/src/exam-media.js";
import { loadPublishedCatalog } from "../app/src/catalog.js";
import { loadHistoryReplay } from "../app/src/history.js";

const schemasUrl = new URL("../schemas/", import.meta.url);
const canonicalSchemaUrl = new URL("exam.schema.json", schemasUrl);
const extensionSchemaUrl = new URL("exam-media.schema.json", schemasUrl);
const appSourceUrl = new URL("../app/src/app.js", import.meta.url);
const stylesUrl = new URL("../app/src/styles.css", import.meta.url);

// --- PNG sintético -------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function pngBytes(width, height, [red, green, blue] = [190, 30, 45]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const offset = y * (1 + width * 3);
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[offset + 1 + x * 3] = red;
      raw[offset + 2 + x * 3] = green;
      raw[offset + 3 + x * 3] = blue;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// --- Fixture sintética ---------------------------------------------------------
const EXAM_ID = "contrato-rx-media-examen";
const OTHER_EXAM_ID = "contrato-admin-examen";
const BANK = "https://banco-contrato.test/";
const V1 = { id: "contrato-rx-version-v1", path: `${EXAM_ID}/versions/contrato-rx-version-v1.json` };
const V2 = { id: "contrato-rx-version-v2", path: `${EXAM_ID}/versions/contrato-rx-version-v2.json` };
const ALT_1 = "Radiografía posteroanterior de tórax de la serie oficial del caso";
const ALT_2 = "Radiografía lateral de tórax de la misma serie oficial del caso";
const ALT_3 = "Corte de tomografía computarizada identificado en el enunciado";

async function assetFixture(id, versionId, width, height, color) {
  const bytes = pngBytes(width, height, color);
  return {
    id,
    path: `${EXAM_ID}/media/${id}-${versionId}.png`,
    mime: "image/png",
    width,
    height,
    sha256: await sha256Hex(bytes),
    source: "Fixture sintética de contrato (sin fuente RX privada)",
    version: versionId,
    bytes,
    contentType: "image/png",
  };
}

async function mediaPackage(version) {
  const color = version.id === V1.id ? [190, 30, 45] : [30, 60, 190];
  const assets = [
    await assetFixture("asset-1", version.id, 320, 240, color),
    await assetFixture("asset-2", version.id, 320, 240, color),
    await assetFixture("asset-3", version.id, 480, 360, color),
  ];
  const questions = [1, 2, 3, 4].map((number) => ({
    id: `${EXAM_ID}-q${String(number).padStart(3, "0")}`,
    sourceNumber: number,
    active: true,
    status: "valid",
    displayLabel: null,
    text: `Enunciado ${number} del caso clínico sintético`,
    options: [{ id: "A", text: "Uno" }, { id: "B", text: "Dos" }, { id: "C", text: "Tres" }, { id: "D", text: "Cuatro" }],
    sourceAnswer: "B",
    correctOption: "B",
    sourcePage: number,
  }));
  questions[0].caseId = "caso-contrato-1";
  questions[0].media = [{ asset: "asset-1", alt: ALT_1 }];
  questions[1].caseId = "caso-contrato-1";
  questions[1].media = [
    { asset: "asset-1", alt: ALT_1 },
    { asset: "asset-2", alt: ALT_2 },
    { asset: "asset-3", alt: ALT_3 },
  ];
  return {
    schemaVersion: "2.0",
    id: EXAM_ID,
    title: "Examen RX sintético del contrato",
    category: "Radiodiagnóstico (fixture)",
    access: "Turno libre",
    variant: null,
    year: 2099,
    durationMinutes: 90,
    source: { pdf: "CONTRATO.pdf", sha256: "a".repeat(64), answerKeyPage: 2 },
    version: { id: version.id, contentSha256: "b".repeat(64) },
    questions,
    scorableSet: {
      state: "resolved", questionNumbers: [1, 2, 3, 4], count: 4,
      annulledNumbers: [], reserveNumbers: [], reserveUsedNumbers: [], reserveUsedLabels: {},
      annulledCount: 0, reserveTotal: 0, reserveUsedCount: 0, reserveUnusedCount: 0,
    },
    qa: { state: "publicable", blockedReason: null, flags: [], checks: {
      metadataComplete: true, optionsPerQuestionValid: true, answerCoverageValid: true,
      countsReconciled: true, annulledHandlingResolved: true, reserveHandlingResolved: true,
      duplicatesResolved: true,
    } },
    media: {
      assets: assets.map(({ bytes: _bytes, contentType: _contentType, ...asset }) => asset),
      cases: [{ id: "caso-contrato-1", label: "Caso clínico 1 (fixture)", assets: ["asset-1", "asset-2", "asset-3"] }],
    },
    __assets: assets,
  };
}

function fixtureFetch(routes) {
  return async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\//, "");
    const route = routes.find(([suffix]) => path.endsWith(suffix));
    if (!route) {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0), json: async () => { throw new Error("404"); } };
    }
    const [, payload] = route;
    if (payload.__json) {
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(payload.__json), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => payload.contentType },
      arrayBuffer: async () => new Uint8Array(payload.bytes).buffer,
      json: async () => { throw new Error("no json"); },
    };
  };
}

function cloneWithoutFixtures(pkg, mutate) {
  const copy = structuredClone(pkg);
  delete copy.__assets;
  mutate(copy);
  return copy;
}

test("la extensión multimedia vive en un esquema separado y no toca el canónico", async () => {
  const extension = JSON.parse(await readFile(extensionSchemaUrl, "utf8"));
  const canonical = JSON.parse(await readFile(canonicalSchemaUrl, "utf8"));
  assert.equal(JSON.stringify(canonical).includes("caseId"), false);
  assert.equal(JSON.stringify(canonical).includes("packageMedia"), false);

  const defs = extension.$defs;
  assert.deepEqual(
    ["path", "mime", "width", "height", "sha256", "source", "version"].every((field) => defs.asset.required.includes(field)),
    true,
  );
  assert.equal(defs.asset.properties.mime.enum.includes("image/png"), true);
  const pathPattern = new RegExp(defs.asset.properties.path.pattern);
  assert.equal(pathPattern.test(`${EXAM_ID}/media/asset-1.png`), true);
  assert.equal(pathPattern.test(`${EXAM_ID}/../escape.png`), false);
  assert.equal(pathPattern.test("https://cdn.example.net/imagen.png"), false);
  assert.equal(pathPattern.test("/absoluta.png"), false);
  assert.equal(pathPattern.test(`${EXAM_ID}/%2e%2e/%2e%2e/escape.png`), false);
  assert.deepEqual(defs.questionMedia.properties.media.items.required, ["asset", "alt"]);
  assert.ok(defs.packageMedia.properties.assets);
  assert.ok(defs.packageMedia.properties.cases);
});

test("validatePackageMedia exige rutas seguras, referencias exactas y alt sin spoilers", async () => {
  const base = await mediaPackage(V1);
  validatePackageMedia(base);

  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.media.assets[0].path = `${EXAM_ID}/../escape.png`; })),
    /ruta|\.\./i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.media.assets[0].path = "https://cdn.example.net/imagen.png"; })),
    /remota|ruta/i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.media.assets[0].path = `${EXAM_ID}/%2e%2e/%2e%2e/escape.png`; })),
    /ruta|segura|\.\./i,
    "rechaza traversal codificado (%2e%2e) además del literal ..",
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.questions[1].media[1].asset = "asset-inexistente"; })),
    /referencia|asset/i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.questions[0].caseId = "caso-inexistente"; })),
    /caso/i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.questions[0].media[0].alt = ""; })),
    /alt|alternativo/i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.questions[0].media[0].alt = "La respuesta correcta es B"; })),
    /solución|spoiler|respuesta|correcta/i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { pkg.media.assets[0].sha256 = "no-es-un-hash"; })),
    /sha|hash/i,
  );
  assert.throws(
    () => validatePackageMedia(cloneWithoutFixtures(base, (pkg) => { delete pkg.media.assets[0].source; })),
    /origen|source/i,
  );

  const withoutMedia = cloneWithoutFixtures(base, (pkg) => {
    delete pkg.media;
    delete pkg.questions[0].caseId;
    delete pkg.questions[1].caseId;
    delete pkg.questions[0].media;
    delete pkg.questions[1].media;
  });
  validatePackageMedia(withoutMedia);
});

test("verifyPackageMedia comprueba existencia, hash, MIME y dimensiones reales", async () => {
  const base = await mediaPackage(V1);
  const routes = base.__assets.map((asset) => [asset.path, asset]);
  await verifyPackageMedia(base, fixtureFetch(routes), BANK);

  const missingRoutes = routes.filter(([suffix]) => !suffix.endsWith(base.__assets[1].path));
  await assert.rejects(
    () => verifyPackageMedia(structuredClone(base), fixtureFetch(missingRoutes), BANK),
    /asset|ausente|disponible/i,
  );

  const corrupt = structuredClone(base);
  corrupt.__assets[1].bytes = pngBytes(320, 240, [1, 2, 3]);
  await assert.rejects(
    () => verifyPackageMedia(corrupt, fixtureFetch(corrupt.__assets.map((asset) => [asset.path, asset])), BANK),
    /hash|sha|integridad|corrupt/i,
  );

  const wrongMime = structuredClone(base);
  wrongMime.media.assets[2].mime = "image/gif";
  await assert.rejects(
    () => verifyPackageMedia(wrongMime, fixtureFetch(routes), BANK),
    /mime|tipo/i,
  );

  const wrongDimensions = structuredClone(base);
  wrongDimensions.media.assets[0].width = 640;
  await assert.rejects(
    () => verifyPackageMedia(wrongDimensions, fixtureFetch(routes), BANK),
    /dimens/i,
  );

  const encodedTraversal = structuredClone(base);
  encodedTraversal.media.assets[0].path = `${EXAM_ID}/%2e%2e/%2e%2e/escape.png`;
  let encodedFetches = 0;
  await assert.rejects(
    () => verifyPackageMedia(encodedTraversal, async () => {
      encodedFetches += 1;
      return { ok: true, status: 200, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }, BANK),
    /ruta|segura|\.\./i,
    "la ruta codificada se rechaza antes de descargar",
  );
  assert.equal(encodedFetches, 0, "ninguna ruta insegura llega a la red");

  const withoutMedia = structuredClone(base);
  delete withoutMedia.media;
  let fetches = 0;
  await verifyPackageMedia(withoutMedia, async () => { fetches += 1; return {}; }, BANK);
  assert.equal(fetches, 0, "un paquete sin media no realiza ninguna petición");
});

test("resolveQuestionMedia conserva el orden y el alt contra el paquete de origen", async () => {
  const base = await mediaPackage(V1);
  const resolved = resolveQuestionMedia(base.questions[1], base, BANK);
  assert.deepEqual(resolved.map(({ assetId }) => assetId), ["asset-1", "asset-2", "asset-3"]);
  assert.equal(resolved[0].alt, ALT_1);
  assert.equal(resolved.every(({ url }) => url.startsWith(BANK)), true);
  assert.equal(resolveQuestionMedia(base.questions[2], base, BANK), null);

  const broken = structuredClone(base);
  broken.questions[1].media[1].asset = "otro-asset";
  assert.throws(() => resolveQuestionMedia(broken.questions[1], broken, BANK), /referencia|asset/i);

  const encodedTraversal = structuredClone(base);
  encodedTraversal.media.assets[0].path = `${EXAM_ID}/%2e%2e/%2e%2e/escape.png`;
  assert.throws(
    () => resolveQuestionMedia(encodedTraversal.questions[0], encodedTraversal, BANK),
    /ruta|segura|\.\./i,
    "la resolución tampoco acepta traversal codificado",
  );
});

test("el catálogo valida e integra la media con error explícito y conserva los exámenes sin imágenes", async () => {
  const rxV2 = await mediaPackage(V2);
  const admin = {
    ...rxV2,
    id: OTHER_EXAM_ID,
    title: "Examen Administrativo (fixture sin imágenes)",
    questions: rxV2.questions.map(({ caseId: _caseId, media: _media, ...question }) => ({
      ...question,
      id: `${OTHER_EXAM_ID}-q${String(question.sourceNumber).padStart(3, "0")}`,
    })),
  };
  delete admin.media;

  const registryRows = [
    { exam_id: EXAM_ID, exam_version_id: V2.id, exam_version_path: V2.path, opposition_id: "rx-fixture", opposition_name: "Radiodiagnóstico (fixture)" },
    { exam_id: admin.id, exam_version_id: V2.id, exam_version_path: `${admin.id}/versions/${V2.id}.json`, opposition_id: "administrativo", opposition_name: "Administrativo" },
  ];
  const catalogJson = {
    __json: {
      exams: registryRows.map(({ exam_id: id, exam_version_id: latestVersion, exam_version_path: latestPath }) => ({ id, latestVersion, latestPath })),
    },
  };
  const routes = [
    ["catalog.json", catalogJson],
    [V2.path, { __json: rxV2 }],
    [`${admin.id}/versions/${V2.id}.json`, { __json: admin }],
    ...rxV2.__assets.map((asset) => [asset.path, asset]),
  ];

  const entries = await loadPublishedCatalog(fixtureFetch(routes), BANK, registryRows);
  const rxEntry = entries.find(({ id }) => id === EXAM_ID);
  const mediaQuestion = rxEntry.questions.find(({ id }) => id === `${EXAM_ID}-q002`);
  assert.equal(mediaQuestion.media.length, 3);
  assert.equal(mediaQuestion.media[0].alt, ALT_1);
  assert.equal(mediaQuestion.media.every(({ url }) => typeof url === "string"), true);
  const adminEntry = entries.find(({ id }) => id === admin.id);
  assert.equal(adminEntry.questions.every(({ media }) => media === null), true);

  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(routes.filter(([suffix]) => !suffix.endsWith(rxV2.__assets[1].path))), BANK, registryRows),
    /asset|ausente|disponible/i,
  );

  const corruptRoutes = routes.map(([suffix, payload]) => [
    suffix,
    suffix.endsWith(rxV2.__assets[0].path) ? { ...payload, bytes: pngBytes(320, 240, [9, 9, 9]) } : payload,
  ]);
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(corruptRoutes), BANK, registryRows),
    /hash|sha|integridad|corrupt/i,
  );

  const brokenReference = structuredClone(rxV2);
  brokenReference.questions[1].media[1].asset = "asset-fantasma";
  const brokenRoutes = routes.map(([suffix, payload]) => [suffix, suffix.endsWith(V2.path) ? { __json: brokenReference } : payload]);
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(brokenRoutes), BANK, registryRows),
    /referencia|asset/i,
  );

  const unsafe = structuredClone(rxV2);
  unsafe.media.assets[0].path = `${EXAM_ID}/../versions/escape.png`;
  const unsafeRoutes = routes.map(([suffix, payload]) => [suffix, suffix.endsWith(V2.path) ? { __json: unsafe } : payload]);
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(unsafeRoutes), BANK, registryRows),
    /ruta|\.\.|segura/i,
  );
});

test("la revisión histórica resuelve la media de la versión fijada sin escribir", async () => {
  const rxV1 = await mediaPackage(V1);
  const rxV2 = await mediaPackage(V2);
  const attempt = {
    id: "60000000-0000-4000-8000-0000000000f1",
    exam_id: EXAM_ID,
    exam_version_id: V1.id,
    exam_version_path: V1.path,
    question_ids: [`${EXAM_ID}-q001`, `${EXAM_ID}-q002`],
    kind: "exam",
    strategy: "exam",
    status: "completed",
    origin: "official",
  };
  const answers = [{
    id: "61000000-0000-4000-8000-0000000000f1",
    question_id: `${EXAM_ID}-q001`,
    answer_sequence: 1,
    selected_option: "A",
    correct_option: "B",
    is_correct: false,
    confirmed_at: "2026-11-18T09:00:00Z",
  }];
  const originalAnswers = structuredClone(answers);
  const reads = [];
  const client = {
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
  const fetchImpl = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\//, "");
    if (path.endsWith(V1.path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(rxV1) };
    if (path.endsWith(V2.path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(rxV2) };
    const asset = rxV1.__assets.find(({ path: assetPath }) => path.endsWith(assetPath));
    if (asset) return { ok: true, status: 200, headers: { get: () => asset.contentType }, arrayBuffer: async () => new Uint8Array(asset.bytes).buffer };
    return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const replay = await loadHistoryReplay(client, fetchImpl, BANK, attempt);
  const first = replay.questions.find(({ id }) => id === `${EXAM_ID}-q001`);
  const second = replay.questions.find(({ id }) => id === `${EXAM_ID}-q002`);
  assert.equal(first.media.length, 1);
  assert.equal(second.media.length, 3);
  assert.equal(second.media.every(({ url }) => url.includes(V1.id)), true);
  assert.equal(second.media.some(({ url }) => url.includes(V2.id)), false);
  assert.deepEqual(answers, originalAnswers);
  assert.deepEqual(reads, ["attempt_answers"]);

  const missingPinned = async (url) => String(url).endsWith(rxV1.__assets[0].path)
    ? { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) }
    : fetchImpl(url);
  await assert.rejects(
    () => loadHistoryReplay(client, missingPinned, BANK, attempt),
    /asset|imagen|image|media|ausente|404/i,
  );
});

test("el render compartido presenta media con ampliación accesible y sin desbordes", async () => {
  const source = await readFile(appSourceUrl, "utf8");
  const renderStudyStart = source.indexOf("function renderStudy()");
  assert.ok(renderStudyStart > -1);
  const renderStudySource = source.slice(renderStudyStart, source.indexOf("\nasync function confirmAnswer", renderStudyStart));
  assert.match(renderStudySource, /buildQuestionMediaList|question\.media/);

  const renderHistoryStart = source.indexOf("function renderHistoryQuestions(replay)");
  assert.ok(renderHistoryStart > -1);
  const renderHistorySource = source.slice(renderHistoryStart, source.indexOf("\nasync function showHistoryDetail", renderHistoryStart));
  assert.match(renderHistorySource, /buildQuestionMediaList|question\.media/);

  assert.match(source, /createElement\("dialog"\)/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /addEventListener\(\s*"close"/);
  assert.match(source, /\.focus\(\)/);
  assert.match(source, /\.alt\s*=/);

  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /max-width:\s*100%/);
});
