# Aplicación SAS

> **Workflow vigente:** la documentación autoritativa actual está en [`docs/workflow/`](./docs/workflow/README.md). La SPEC vigente es `docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md` y el glosario canónico es `docs/workflow/aplicacion-sas-CONTEXT-final.md`. Los issues #5–#16 son el plan `/to-tickets` pendiente de auditoría externa. La descripción histórica que sigue se conserva solo como contexto del prototipo brownfield y puede estar superseded.

Herramienta web ligera para preparar exámenes de oposiciones del Servicio Andaluz de Salud (SAS), registrar el progreso de tres participantes y comparar su actividad y rendimiento acumulados.

## Alcance inicial

- 12 exámenes de 150 preguntas (1.800 preguntas iniciales).
- Importación directa desde PDF a JSON.
- Práctica por examen, por preguntas y, más adelante, por temática.
- Cronómetro por sesión y tiempo de respuesta por pregunta.
- Historial individual y comparativa entre participantes.
- Estadísticas de volumen, precisión, tiempo, preguntas y temas con más fallos.
- Incorporación posterior de nuevos PDF mediante el propio repositorio de GitHub.
- Explicaciones breves y clasificación temática pregeneradas con IA durante la importación.
- Tutor IA opcional bajo demanda para dudas adicionales.

## Arquitectura simplificada v1

- Frontend: HTML, CSS y JavaScript modular.
- Publicación: GitHub Pages.
- Banco de preguntas: JSON versionado en GitHub.
- Entrada administrativa: PDF subido a `data/source-pdfs/inbox/` desde GitHub.
- Automatización: GitHub Actions convierte PDF a JSON, enriquece las preguntas con IA, valida, actualiza el catálogo y despliega.
- Backend mínimo: Supabase para tres usuarios, sesiones y respuestas.
- Tutor opcional: Supabase Edge Function como proxy seguro hacia un proveedor LLM intercambiable.
- Comparativa: vistas SQL agregadas; sin salas, códigos, lobby ni sincronización en tiempo real.

Documentación:

- Arquitectura base: `docs/architecture-v1-simplified.md`.
- Capa de IA y evolución hacia temario/RAG: `docs/architecture-v2-ai.md`.
- Piloto de importación 2023: `docs/pilot-examen-adm-2023.md`.

## Piloto disponible

El examen `Examen_ADM_L_2023.pdf` se ha utilizado como primer caso real. El parser ha generado `app/public/data/exams/sas-administrativo-2023-turno-libre.json` con 78 preguntas y un informe QA en `docs/import-reports/sas-administrativo-2023-turno-libre.qa.md`.
