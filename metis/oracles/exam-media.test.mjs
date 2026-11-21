// Oráculo Metis · unidad m05-casos-multimedia
// Contrato: los paquetes nuevos pueden declarar opcionalmente (en un esquema de
// extensión SEPARADO, sin tocar el canónico histórico) caseId y referencias
// exactas y ordenadas a imágenes compartidas, con ruta interna relativa
// inmutable, MIME, dimensiones, SHA-256, origen y versión. La carga valida e
// integra esa media con error explícito (nunca una pregunta aparentemente
// completa sin su imagen) y la presentación alcanza estudio normal/aleatorio,
// examen cronometrado, falladas y artificial (arranque y reanudación) y la
// revisión histórica, que resuelve SIEMPRE contra el paquete/versión de origen
// fijado aunque cambie el catálogo o la oposición seleccionada, sin mutar
// respuestas ni escribir nada. Cada imagen es ampliable por toque y teclado con
// cierre accesible y recuperación del foco; el alt es descriptivo, no diagnóstico
// y no revela la solución. La multimedia no altera score, respuestas,
// temporización, progreso, cierre ni bloqueo global, y los exámenes sin imágenes
// conservan su comportamiento exacto.
//
// Sin dependencias externas: los PNG sintéticos se generan aquí y la red se
// simula con un fetchImpl de fixture (ninguna fuente RX privada se lee).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const schemasUrl = new URL("../../schemas/", import.meta.url);
const canonicalSchemaUrl = new URL("exam.schema.json", schemasUrl);
const extensionSchemaUrl = new URL("exam-media.schema.json", schemasUrl);
const examMediaModuleUrl = new URL("../../app/src/exam-media.js", import.meta.url);
const catalogModuleUrl = new URL("../../app/src/catalog.js", import.meta.url);
const historyModuleUrl = new URL("../../app/src/history.js", import.meta.url);
const appSourceUrl = new URL("../../app/src/app.js", import.meta.url);
const stylesUrl = new URL("../../app/src/styles.css", import.meta.url);

// --- PNG sintético (válido para navegadores y para el verificador de bytes) ----
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
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadExamMediaModule(label) {
  try {
    return await import(examMediaModuleUrl.href);
  } catch {
    return assert.fail(`Falta app/src/exam-media.js con el contrato multimedia de la unidad (${label}).`);
  }
}

// --- Fixture sintética: examen RX con dos preguntas del MISMO caso -------------
const EXAM_ID = "oracle-rx-media-examen";
const BANK = "https://banco-fixture.test/";
const V1 = { id: "oracle-rx-version-v1", path: `${EXAM_ID}/versions/oracle-rx-version-v1.json` };
const V2 = { id: "oracle-rx-version-v2", path: `${EXAM_ID}/versions/oracle-rx-version-v2.json` };
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
    source: "Fuente oficial sintética del oráculo (sin RX privada)",
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
  questions[0].caseId = "caso-oracle-1";
  questions[0].media = [{ asset: "asset-1", alt: ALT_1 }];
  questions[1].caseId = "caso-oracle-1";
  questions[1].media = [
    { asset: "asset-1", alt: ALT_1 },
    { asset: "asset-2", alt: ALT_2 },
    { asset: "asset-3", alt: ALT_3 },
  ];
  return {
    schemaVersion: "2.0",
    id: EXAM_ID,
    title: "Examen RX sintético del oráculo",
    category: "Radiodiagnóstico (fixture)",
    access: "Turno libre",
    variant: null,
    year: 2099,
    durationMinutes: 90,
    source: { pdf: "ORACULO.pdf", sha256: "a".repeat(64), answerKeyPage: 2 },
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
      cases: [{ id: "caso-oracle-1", label: "Caso clínico 1 (fixture)", assets: ["asset-1", "asset-2", "asset-3"] }],
    },
    __assets: assets,
  };
}

// fetchImpl de fixture: sirve JSON (paquetes/catálogo) y bytes de assets por ruta.
function fixtureFetch(routes) {
  return async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\//, "");
    const route = routes.find(([suffix]) => path.endsWith(suffix));
    if (!route) return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0), json: async () => { throw new Error("404"); } };
    const [, payload] = route;
    if (payload.__json) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(payload.__json), arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      headers: { get: () => payload.contentType },
      arrayBuffer: async () => new Uint8Array(payload.bytes).buffer,
      json: async () => { throw new Error("no json"); },
    };
  };
}

test("la extensión multimedia vive en un esquema separado y no toca el esquema canónico histórico", async () => {
  let extension;
  try {
    extension = JSON.parse(await readFile(extensionSchemaUrl, "utf8"));
  } catch {
    return assert.fail("Falta schemas/exam-media.schema.json con el documento de la extensión multimedia.");
  }
  const canonical = JSON.parse(await readFile(canonicalSchemaUrl, "utf8"));
  assert.equal(
    JSON.stringify(canonical).includes("caseId") || JSON.stringify(canonical).includes("packageMedia"),
    false,
    "el esquema canónico histórico no declara la extensión (queda sin cambios)",
  );

  const defs = extension.$defs ?? {};
  const asset = defs.asset ?? {};
  for (const field of ["path", "mime", "width", "height", "sha256", "source", "version"]) {
    assert.ok(asset.required?.includes(field), `el asset declarado exige ${field} (origen y versión trazables)`);
  }
  assert.ok(asset.properties?.mime?.enum?.length, "el MIME declarado está acotado a formatos de imagen verificables");
  assert.equal(asset.properties?.mime?.enum?.includes("image/png"), true, "image/png está permitido");

  // La ruta interna es relativa, inmutable y segura: el patrón del esquema rechaza
  // rutas con .., absolutas y URL remotas.
  const pathPattern = asset.properties?.path?.pattern;
  assert.ok(typeof pathPattern === "string", "la ruta del asset está restringida por patrón");
  const pathRegex = new RegExp(pathPattern);
  assert.equal(pathRegex.test(`${EXAM_ID}/media/asset-1.png`), true, "la ruta interna relativa es válida");
  assert.equal(pathRegex.test(`${EXAM_ID}/../escape.png`), false, "el patrón rechaza rutas con ..");
  assert.equal(pathRegex.test("https://cdn.example.net/imagen.png"), false, "el patrón rechaza URL remotas");
  assert.equal(pathRegex.test("/absoluta.png"), false, "el patrón rechaza rutas absolutas");

  const questionMedia = defs.questionMedia ?? {};
  const ref = questionMedia.properties?.media?.items ?? {};
  assert.deepEqual(ref.required, ["asset", "alt"], "cada referencia exige el asset y su texto alternativo");

  const packageMedia = defs.packageMedia ?? {};
  assert.ok(packageMedia.properties?.assets, "la extensión declara el bloque de assets compartidos");
  assert.ok(packageMedia.properties?.cases, "la extensión declara la agrupación de casos");
});

test("validatePackageMedia exige referencias exactas, rutas seguras y alt sin spoilers", async () => {
  const media = await loadExamMediaModule("validatePackageMedia");
  const base = await mediaPackage(V1);
  media.validatePackageMedia(base); // válida: no lanza

  const clone = (pkg, mutate) => {
    const copy = structuredClone(pkg);
    delete copy.__assets;
    mutate(copy);
    return copy;
  };

  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.media.assets[0].path = `${EXAM_ID}/../escape.png`; })),
    /\.\.|ruta/i,
    "rechaza rutas con ..",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.media.assets[0].path = "https://cdn.example.net/imagen.png"; })),
    /remota|http|ruta/i,
    "rechaza URL remotas/externas",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.questions[1].media[1].asset = "asset-inexistente"; })),
    /referencia|asset/i,
    "rechaza referencias de asset inexistentes (referencia errónea)",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.questions[0].caseId = "caso-inexistente"; })),
    /caso/i,
    "rechaza referencias de caso inexistentes",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.questions[0].media[0].alt = ""; })),
    /alt|alternativo/i,
    "rechaza alt vacío (no descriptivo)",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.questions[0].media[0].alt = "La respuesta correcta es B"; })),
    /solución|spoiler|respuesta|correcta/i,
    "el alt nunca revela la solución",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { pkg.media.assets[0].sha256 = "no-es-un-hash"; })),
    /sha|hash/i,
    "exige SHA-256 declarado",
  );
  assert.throws(
    () => media.validatePackageMedia(clone(base, (pkg) => { delete pkg.media.assets[0].source; })),
    /origen|source/i,
    "exige el origen trazable del asset",
  );
  // Un paquete sin media y una pregunta sin referencias son válidos (no-op).
  const withoutMedia = clone(base, (pkg) => { delete pkg.media; pkg.questions[0].caseId = undefined; pkg.questions[1].caseId = undefined; delete pkg.questions[0].media; delete pkg.questions[1].media; });
  media.validatePackageMedia(withoutMedia);
});

test("verifyPackageMedia exige existencia, hash, MIME y dimensiones reales de cada asset", async () => {
  const media = await loadExamMediaModule("verifyPackageMedia");
  const base = await mediaPackage(V1);
  const routes = base.__assets.map((asset) => [asset.path, asset]);
  await media.verifyPackageMedia(base, fixtureFetch(routes), BANK);

  const missing = structuredClone(base);
  const missingRoutes = routes.filter(([suffix]) => !suffix.endsWith(missing.__assets[1].path));
  await assert.rejects(
    () => media.verifyPackageMedia(missing, fixtureFetch(missingRoutes), BANK),
    /asset|disponible|ausente/i,
    "un asset ausente produce un error explícito",
  );

  const corrupt = structuredClone(base);
  corrupt.__assets[1].bytes = pngBytes(320, 240, [1, 2, 3]); // mismo tamaño, otro contenido
  const corruptRoutes = corrupt.__assets.map((asset) => [asset.path, asset]);
  await assert.rejects(
    () => media.verifyPackageMedia(corrupt, fixtureFetch(corruptRoutes), BANK),
    /hash|sha|integridad|corrupt/i,
    "un asset corrupto (hash distinto) produce un error explícito",
  );

  const wrongMime = structuredClone(base);
  wrongMime.media.assets[2].mime = "image/gif"; // declarado GIF, bytes PNG
  await assert.rejects(
    () => media.verifyPackageMedia(wrongMime, fixtureFetch(routes), BANK),
    /mime|tipo/i,
    "el MIME declarado debe corresponder a los bytes servidos",
  );

  const wrongDims = structuredClone(base);
  wrongDims.media.assets[0].width = 640; // declarado 640, real 320
  await assert.rejects(
    () => media.verifyPackageMedia(wrongDims, fixtureFetch(routes), BANK),
    /dimens/i,
    "las dimensiones declaradas deben coincidir con las reales",
  );

  // Los paquetes sin media no desencadenan ninguna petición.
  const withoutMedia = structuredClone(base);
  delete withoutMedia.media;
  let fetches = 0;
  await media.verifyPackageMedia(withoutMedia, async () => { fetches += 1; return { ok: true, status: 200, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) }; }, BANK);
  assert.equal(fetches, 0, "un examen sin imágenes conserva su comportamiento exacto");
});

test("resolveQuestionMedia resuelve en orden contra el paquete de origen y falla con referencias erróneas", async () => {
  const media = await loadExamMediaModule("resolveQuestionMedia");
  const base = await mediaPackage(V1);
  const resolved = media.resolveQuestionMedia(base.questions[1], base, BANK);
  assert.ok(Array.isArray(resolved) && resolved.length === 3, "resuelve todas las referencias en orden");
  assert.deepEqual(resolved.map(({ assetId }) => assetId), ["asset-1", "asset-2", "asset-3"], "el orden declarado se conserva");
  assert.equal(resolved[0].alt, ALT_1, "el alt descriptivo viaja con la imagen");
  assert.ok(resolved.every(({ url }) => url.startsWith(BANK)), "la URL se deriva del paquete de origen");
  assert.equal(media.resolveQuestionMedia(base.questions[2], base, BANK), null, "una pregunta sin imágenes no declara media");

  const broken = structuredClone(base);
  broken.questions[1].media[1].asset = "otro-asset";
  assert.throws(() => media.resolveQuestionMedia(broken.questions[1], broken, BANK), /referencia|asset/i, "una referencia errónea es error explícito");
});

test("el catálogo valida e integra la media con error explícito y conserva los exámenes sin imágenes", async () => {
  const { loadPublishedCatalog } = await import(catalogModuleUrl);
  const rxV1 = await mediaPackage(V1);
  const rxV2 = await mediaPackage(V2);
  const admin = {
    ...rxV2,
    id: "oracle-admin-examen",
    title: "Examen Administrativo (fixture sin imágenes)",
    questions: rxV2.questions.map(({ caseId: _caseId, media: _media, ...question }) => question),
  };
  delete admin.media;

  const registryRows = [
    { exam_id: EXAM_ID, exam_version_id: V2.id, exam_version_path: V2.path, opposition_id: "rx-fixture", opposition_name: "Radiodiagnóstico (fixture)" },
    { exam_id: admin.id, exam_version_id: V2.id, exam_version_path: `${admin.id}/versions/${V2.id}.json`, opposition_id: "administrativo", opposition_name: "Administrativo" },
  ];
  const catalogJson = { __json: { exams: registryRows.map(({ exam_id: id, exam_version_id: latestVersion, exam_version_path: latestPath }) => ({ id, latestVersion, latestPath })) } };
  const routes = [
    ["catalog.json", catalogJson],
    [V2.path, { __json: rxV2 }],
    [`${admin.id}/versions/${V2.id}.json`, { __json: admin }],
    ...[rxV2, admin].flatMap((pkg) => (pkg.__assets ?? []).map((asset) => [asset.path, asset])),
  ];

  const entries = await loadPublishedCatalog(fixtureFetch(routes), BANK, registryRows);
  const rxEntry = entries.find(({ id }) => id === EXAM_ID);
  assert.ok(rxEntry, "el paquete con media válido se carga");
  const mediaQuestion = rxEntry.questions.find(({ id }) => id === `${EXAM_ID}-q002`);
  assert.ok(
    Array.isArray(mediaQuestion?.media) && mediaQuestion.media.every((item) => typeof item?.url === "string"),
    "las preguntas activas llevan su media resuelta (con URL del paquete de origen) en orden",
  );
  assert.equal(mediaQuestion.media.length, 3, "las preguntas activas llevan su media resuelta en orden");
  assert.equal(mediaQuestion.media[0].alt, ALT_1, "el alt viaja con cada imagen");
  const adminEntry = entries.find(({ id }) => id === admin.id);
  assert.equal(adminEntry.questions.every(({ media }) => media === undefined || media === null), true, "los exámenes sin imágenes no declara media");

  // Variante: asset ausente → la carga del catálogo RECHAZA con error explícito.
  const missingRoutes = routes.filter(([suffix]) => !suffix.endsWith(rxV2.__assets[1].path));
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(missingRoutes), BANK, registryRows),
    /asset|ausente|multimedia/i,
    "un asset ausente nunca produce un catálogo aparentemente completo",
  );

  // Variante: asset corrupto → error explícito.
  const corruptRoutes = routes.map(([suffix, payload]) => [
    suffix,
    suffix.endsWith(rxV2.__assets[0].path) ? { ...payload, bytes: pngBytes(320, 240, [9, 9, 9]) } : payload,
  ]);
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(corruptRoutes), BANK, registryRows),
    /hash|sha|integridad|corrupt/i,
    "un asset corrupto produce un error explícito",
  );

  // Variante: referencia errónea → error explícito.
  const brokenRef = structuredClone(rxV2);
  brokenRef.questions[1].media[1].asset = "asset-fantasma";
  const brokenRoutes = routes.map(([suffix, payload]) => [suffix, suffix.endsWith(V2.path) ? { __json: brokenRef } : payload]);
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(brokenRoutes), BANK, registryRows),
    /referencia|asset/i,
    "una referencia errónea produce un error explícito",
  );

  // Variante: ruta insegura → error explícito.
  const unsafe = structuredClone(rxV2);
  unsafe.media.assets[0].path = `${EXAM_ID}/../versions/escape.png`;
  const unsafeRoutes = routes.map(([suffix, payload]) => [suffix, suffix.endsWith(V2.path) ? { __json: unsafe } : payload]);
  await assert.rejects(
    () => loadPublishedCatalog(fixtureFetch(unsafeRoutes), BANK, registryRows),
    /ruta|\.\.|segura/i,
    "una ruta insegura produce un error explícito",
  );
});

test("la revisión histórica resuelve la media de la versión fijada y no escribe nada", async () => {
  const { loadHistoryReplay } = await import(historyModuleUrl);
  const rxV1 = await mediaPackage(V1);
  const rxV2 = await mediaPackage(V2);

  // Revisión de un intento OFICIAL fijado a v1 mientras el catálogo actual ya es v2.
  const attempt = {
    id: "40000000-0000-4000-8000-0000000000f1",
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
    id: "50000000-0000-4000-8000-0000000000f1",
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
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const path = String(url).replace(/^https?:\/\/[^/]+\//, "");
    if (path.endsWith(V1.path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(rxV1) };
    if (path.endsWith(V2.path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(rxV2) };
    const asset = rxV1.__assets.find(({ path: assetPath }) => path.endsWith(assetPath))
      ?? rxV2.__assets.find(({ path: assetPath }) => path.endsWith(assetPath));
    if (asset) return { ok: true, status: 200, headers: { get: () => asset.contentType }, arrayBuffer: async () => new Uint8Array(asset.bytes).buffer };
    return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0), json: async () => { throw new Error("404"); } };
  };

  const replay = await loadHistoryReplay(client, fetchImpl, BANK, attempt);
  const first = replay.questions.find(({ id }) => id === `${EXAM_ID}-q001`);
  const second = replay.questions.find(({ id }) => id === `${EXAM_ID}-q002`);
  assert.ok(
    Array.isArray(first?.media) && first.media.every((item) => typeof item?.url === "string"),
    "la revisión presenta la imagen compartida del caso RESUELTA contra su versión fijada",
  );
  assert.ok(
    Array.isArray(second?.media) && second.media.every((item) => typeof item?.url === "string"),
    "la revisión conserva el orden de varias imágenes resueltas",
  );
  assert.equal(first.media.length, 1, "la revisión presenta la imagen compartida del caso");
  assert.equal(second.media.length, 3, "la revisión conserva el orden de varias imágenes");
  assert.ok(
    second.media.every(({ url }) => url.includes(V1.id)),
    "las imágenes de la revisión vienen de la versión FIJADA, no de la versión actual del catálogo",
  );
  assert.equal(second.media.some(({ url }) => url.includes(V2.id)), false, "nunca se resuelve contra la versión vigente");
  assert.deepEqual(answers, originalAnswers, "las respuestas históricas y su corrección persistida quedan intactas");
  assert.deepEqual(reads, ["attempt_answers"], "la revisión solo lee respuestas (nunca escribe)");

  // Un paquete histórico fijado NO se puede mostrar como completo si falta
  // o está corrupta una de sus imágenes: este error se comprueba también
  // al reproducir el intento, no únicamente durante la carga del catálogo.
  const pinnedAssetPath = rxV1.__assets[0].path;
  const missingPinnedAsset = async (url) => String(url).endsWith(pinnedAssetPath)
    ? { ok: false, status: 404, headers: { get: () => "" },
        arrayBuffer: async () => new ArrayBuffer(0) }
    : fetchImpl(url);
  await assert.rejects(
    () => loadHistoryReplay(client, missingPinnedAsset, BANK, attempt),
    /asset|imagen|image|media|ausente|404/i,
    "la revisión histórica debe rechazar una imagen ausente en el paquete fijado",
  );

  const corruptedPinnedBytes = pngBytes(320, 240, [17, 201, 77]);
  const corruptPinnedAsset = async (url) => String(url).endsWith(pinnedAssetPath)
    ? { ok: true, status: 200, headers: { get: () => "image/png" },
        arrayBuffer: async () => new Uint8Array(corruptedPinnedBytes).buffer }
    : fetchImpl(url);
  await assert.rejects(
    () => loadHistoryReplay(client, corruptPinnedAsset, BANK, attempt),
    /integridad|hash|sha|corrupt|asset|imagen|image|media/i,
    "la revisión histórica debe rechazar una imagen corrupta y no mostrarla como válida",
  );

  // Pregunta compuesta (sesión de falladas): cada pregunta resuelve contra SU
  // paquete de origen, con el catálogo actual apuntando a otra versión.
  const otherExamId = "oracle-admin-examen";
  const otherPackage = {
    ...rxV1,
    id: otherExamId,
    title: "Examen Administrativo (fixture sin imágenes)",
    questions: rxV1.questions.map(({ caseId: _caseId, media: _media, ...question }) => ({ ...question, id: `${otherExamId}-q${String(question.sourceNumber).padStart(3, "0")}` })),
  };
  delete otherPackage.media;
  const failedAttempt = {
    id: "40000000-0000-4000-8000-0000000000f2",
    exam_id: EXAM_ID,
    exam_version_id: V2.id,
    exam_version_path: V2.path,
    question_ids: [`${EXAM_ID}-q001`, `${otherExamId}-q001`],
    kind: "failed",
    strategy: "failed",
    status: "active",
    origin: "official",
    failed_scope_exam_id: EXAM_ID,
  };
  const sources = [
    { position: 0, exam_id: EXAM_ID, exam_version_id: V1.id, exam_version_path: V1.path, question_id: `${EXAM_ID}-q001`, source_question_id: `${EXAM_ID}-q001` },
    { position: 1, exam_id: otherExamId, exam_version_id: V1.id, exam_version_path: `${otherExamId}/versions/${V1.id}.json`, question_id: `${otherExamId}-q001`, source_question_id: `${otherExamId}-q001` },
  ];
  const compositeClient = {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order: async () => table === "attempt_question_sources" ? { data: structuredClone(sources), error: null } : { data: structuredClone(answers), error: null },
      };
      return builder;
    },
  };
  const compositeRequested = [];
  const compositeFetch = async (url) => {
    compositeRequested.push(String(url));
    const path = String(url).replace(/^https?:\/\/[^/]+\//, "");
    if (path.endsWith(V1.path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(rxV1) };
    if (path.endsWith(V2.path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(rxV2) };
    if (path.endsWith(`${otherExamId}/versions/${V1.id}.json`)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => structuredClone(otherPackage) };
    const asset = rxV1.__assets.find(({ path: assetPath }) => path.endsWith(assetPath));
    if (asset) return { ok: true, status: 200, headers: { get: () => asset.contentType }, arrayBuffer: async () => new Uint8Array(asset.bytes).buffer };
    return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0), json: async () => { throw new Error("404"); } };
  };
  const compositeReplay = await loadHistoryReplay(compositeClient, compositeFetch, BANK, failedAttempt);
  const mediaComposite = compositeReplay.questions[0];
  const textComposite = compositeReplay.questions[1];
  assert.ok(
    Array.isArray(mediaComposite?.media) && mediaComposite.media.every((item) => typeof item?.url === "string"),
    "la compuesta del examen con media conserva el contexto de SU versión de origen",
  );
  assert.equal(mediaComposite.media.length, 1, "la compuesta del examen con media conserva el contexto de SU versión de origen");
  assert.ok(mediaComposite.media[0].url.includes(V1.id), "la compuesta no se resuelve contra el catálogo actual");
  assert.equal(textComposite.media ?? null, null, "la pregunta del examen sin imágenes no declara media");
});

test("el render compartido de pregunta presenta media con ampliación accesible en todos los recorridos", async () => {
  const source = await readFile(appSourceUrl, "utf8");

  // renderStudy es el render compartido de estudio normal/aleatorio, examen
  // cronometrado, falladas y artificial (arranque y reanudación por restore).
  const renderStudyStart = source.indexOf("function renderStudy()");
  assert.ok(renderStudyStart > -1, "app.js conserva el render compartido de pregunta");
  const renderStudySource = source.slice(renderStudyStart, source.indexOf("\nasync function confirmAnswer", renderStudyStart));
  assert.match(renderStudySource, /question\.media|buildQuestionMediaList|renderQuestionMedia/, "el render compartido presenta question.media");

  // La revisión histórica también presenta las imágenes del intento.
  const renderHistoryStart = source.indexOf("function renderHistoryQuestions(replay)");
  assert.ok(renderHistoryStart > -1, "app.js conserva el render de la revisión histórica");
  const renderHistorySource = source.slice(renderHistoryStart, source.indexOf("\nasync function showHistoryDetail", renderHistoryStart));
  assert.match(renderHistorySource, /question\.media|buildQuestionMediaList/, "la revisión histórica presenta la media fijada");

  // Ampliación accesible: botón que abre diálogo modal, cierre y recuperación de foco.
  assert.match(source, /createElement\("dialog"\)/, "la ampliación usa un diálogo modal creado desde JS (el HTML no se toca)");
  assert.match(source, /showModal\(\)/, "la ampliación se abre como diálogo modal");
  assert.match(source, /addEventListener\(\s*"close"/, "al cerrar el diálogo se recupera el foco");
  assert.match(source, /\.focus\(\)/, "el foco vuelve al botón que abrió la ampliación");
  assert.match(source, /\.alt\s*=/, "cada imagen declara su texto alternativo descriptivo");

  // Presentación sin desbordes: la hoja de estilos acota las imágenes a su contenedor.
  const styles = await readFile(stylesUrl, "utf8");
  // La nomenclatura CSS y el texto exacto del botón no forman parte del contrato;
  // el test E2E comprueba la accesibilidad y la receta visual, el desbordamiento.
  assert.match(styles, /max-width:\s*100%/, "las imágenes nunca superan el ancho de su contenedor (sin desbordes a 390 px)");
});

test("las sesiones conservan su comportamiento con preguntas con media (cero efectos colaterales)", async () => {
  const { QuizSession } = await import(new URL("../../app/src/quiz-core.js", import.meta.url));
  const { ExamSession, NormalStudySession } = await import(new URL("../../app/src/study-session.js", import.meta.url));
  const base = await mediaPackage(V1);
  const withMedia = base.questions.map((question) => ({ ...question, media: question.media ? question.media.map((ref) => ({ ...ref, url: `https://banco-fixture.test/${ref.asset}` })) : undefined }));

  // El score no cambia por llevar imágenes.
  const session = new QuizSession({
    id: EXAM_ID, title: "t", durationMinutes: 90, version: { id: "v" },
    qa: { state: "publicable" }, scorableSet: { state: "resolved", count: 4, questionNumbers: [1, 2, 3, 4] },
    questions: withMedia,
  });
  const answer = session.answerCurrent("A");
  assert.equal(answer.isCorrect, false, "responder una pregunta con media puntúa igual");
  assert.equal(session.incorrectCount, 1, "el recuento de falladas no cambia por la multimedia");
  const normal = new NormalStudySession({
    id: EXAM_ID, version: { id: V1.id }, questions: withMedia,
  }, {
    exam_id: EXAM_ID, exam_version_id: V1.id, question_ids: withMedia.map(({ id }) => id), current_position: 0,
  });
  assert.equal(normal.currentQuestion.media.length, 1, "la sesión de estudio conserva la media de la pregunta");
  const exam = new ExamSession({
    id: EXAM_ID, version: { id: V1.id }, questions: withMedia,
  }, {
    kind: "exam", exam_id: EXAM_ID, exam_version_id: V1.id, question_ids: withMedia.map(({ id }) => id), current_position: 0,
  });
  assert.equal(exam.currentQuestion.media.length, 1, "la sesión de examen conserva la media de la pregunta");
});
