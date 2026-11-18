function isSafeLatestPath(path) {
  return typeof path === "string"
    && !path.startsWith("/")
    && !path.includes("..")
    && path.endsWith(".json");
}

function validatePublishedVersion(exam, { id, version, path }) {
  const activeQuestions = exam.questions?.filter(({ active }) => active) ?? [];
  const officialOrder = exam.scorableSet?.questionNumbers;
  const activeOrder = activeQuestions.map(({ sourceNumber }) => sourceNumber);
  const isPublishedVersion = exam.id === id
    && exam.version?.id === version
    && exam.qa?.state === "publicable"
    && exam.scorableSet?.state === "resolved"
    && exam.scorableSet?.count === activeQuestions.length
    && Array.isArray(officialOrder)
    && officialOrder.length === activeOrder.length
    && activeOrder.every((number, index) => number === officialOrder[index])
    && Number.isInteger(exam.durationMinutes);

  if (!isSafeLatestPath(path) || !isPublishedVersion) {
    throw new Error("La versión fijada del examen no es válida.");
  }
  return { exam, activeQuestions };
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`No se pudo cargar ${label} (${response.status}).`);
  return response.json();
}

// Una fila del registro oficial solo autoriza la entrada del catálogo cuando su
// tuplo exacto (exam_id, exam_version_id, exam_version_path) coincide y trae la
// oposición publicada desde el servidor. Sin oposición explícita no autoriza nada.
function oppositionOfRegistryRow(row) {
  const oppositionId = row?.opposition_id;
  const oppositionName = row?.opposition_name;
  if (
    typeof row?.exam_id !== "string"
    || typeof row?.exam_version_id !== "string"
    || typeof row?.exam_version_path !== "string"
    || typeof oppositionId !== "string" || !oppositionId
    || typeof oppositionName !== "string" || !oppositionName
  ) return null;
  return { oppositionId, oppositionName };
}

function registryByTuple(authorizedVersions) {
  const registry = new Map();
  for (const row of authorizedVersions) {
    const opposition = oppositionOfRegistryRow(row);
    if (!opposition) continue;
    const key = `${row.exam_id}\0${row.exam_version_id}\0${row.exam_version_path}`;
    const previous = registry.get(key);
    if (previous === undefined) {
      registry.set(key, opposition);
    } else if (previous !== null && (
      previous.oppositionId !== opposition.oppositionId
      || previous.oppositionName !== opposition.oppositionName
    )) {
      registry.set(key, null);
    }
  }
  return registry;
}

export async function loadPublishedCatalog(fetchImpl, bankBaseUrl, authorizedVersions) {
  if (!Array.isArray(authorizedVersions)) {
    throw new Error("El registro oficial publicado no está disponible.");
  }
  const registry = registryByTuple(authorizedVersions);
  const catalog = await fetchJson(fetchImpl, `${bankBaseUrl}catalog.json`, "el catálogo");
  if (!Array.isArray(catalog.exams)) throw new Error("El catálogo publicado no es válido.");

  const entries = await Promise.all(catalog.exams.map(async (entry) => {
    if (!isSafeLatestPath(entry.latestPath)) return null;
    const opposition = registry.get(`${entry.id}\0${entry.latestVersion}\0${entry.latestPath}`);
    if (!opposition) return null;
    const exam = await fetchJson(fetchImpl, `${bankBaseUrl}${entry.latestPath}`, entry.title || "el examen");
    let activeQuestions;
    try {
      ({ activeQuestions } = validatePublishedVersion(exam, {
        id: entry.id,
        version: entry.latestVersion,
        path: entry.latestPath,
      }));
    } catch {
      return null;
    }
    return {
      id: exam.id,
      title: exam.title,
      activeCount: activeQuestions.length,
      durationMinutes: exam.durationMinutes,
      version: exam.version.id,
      versionPath: entry.latestPath,
      oppositionId: opposition.oppositionId,
      oppositionName: opposition.oppositionName,
      questions: activeQuestions,
      package: exam,
    };
  }));

  return entries.filter(Boolean);
}

// Oposiciones publicadas según el registro del servidor: una oposición aparece
// solo si tiene al menos un examen publicado. Los nombres son siempre los
// públicos que llegó el catálogo autorizado, nunca etiquetas del frontend.
export function listPublishedOppositions(catalog) {
  const oppositions = [];
  const seen = new Set();
  for (const entry of Array.isArray(catalog) ? catalog : []) {
    const { oppositionId, oppositionName } = entry || {};
    if (
      typeof oppositionId !== "string" || !oppositionId
      || typeof oppositionName !== "string" || !oppositionName
      || seen.has(oppositionId)
    ) continue;
    seen.add(oppositionId);
    oppositions.push({ id: oppositionId, name: oppositionName });
  }
  return oppositions;
}

// Proyección visible de una oposición: devuelve las entradas del catálogo
// autorizado completo que pertenecen a esa oposición, sin mutar el catálogo.
export function filterCatalogByOpposition(catalog, oppositionId) {
  if (typeof oppositionId !== "string" || !oppositionId) return [];
  return (Array.isArray(catalog) ? catalog : []).filter((entry) => entry?.oppositionId === oppositionId);
}

export async function loadPinnedExam(fetchImpl, bankBaseUrl, attempt) {
  if (!isSafeLatestPath(attempt.exam_version_path)) {
    throw new Error("La ruta de la versión fijada no es válida.");
  }
  const exam = await fetchJson(
    fetchImpl,
    `${bankBaseUrl}${attempt.exam_version_path}`,
    "la versión fijada del examen",
  );
  return validatePublishedVersion(exam, {
    id: attempt.exam_id,
    version: attempt.exam_version_id,
    path: attempt.exam_version_path,
  });
}
