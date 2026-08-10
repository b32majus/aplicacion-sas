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

export async function loadPublishedCatalog(fetchImpl, bankBaseUrl) {
  const catalog = await fetchJson(fetchImpl, `${bankBaseUrl}catalog.json`, "el catálogo");
  if (!Array.isArray(catalog.exams)) throw new Error("El catálogo publicado no es válido.");

  const entries = await Promise.all(catalog.exams.map(async (entry) => {
    if (!isSafeLatestPath(entry.latestPath)) return null;
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
      questions: activeQuestions,
      package: exam,
    };
  }));

  return entries.filter(Boolean);
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
