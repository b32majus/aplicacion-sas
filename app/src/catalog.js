function isSafeLatestPath(path) {
  return typeof path === "string"
    && !path.startsWith("/")
    && !path.includes("..")
    && path.endsWith(".json");
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
    const activeQuestions = exam.questions?.filter(({ active }) => active) ?? [];
    const isCurrentPublicPackage = exam.id === entry.id
      && exam.version?.id === entry.latestVersion
      && exam.qa?.state === "publicable"
      && exam.scorableSet?.state === "resolved"
      && exam.scorableSet?.count === activeQuestions.length
      && Number.isInteger(exam.durationMinutes);

    if (!isCurrentPublicPackage) return null;
    return {
      id: exam.id,
      title: exam.title,
      activeCount: activeQuestions.length,
      durationMinutes: exam.durationMinutes,
      version: exam.version.id,
    };
  }));

  return entries.filter(Boolean);
}
