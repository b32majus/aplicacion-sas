# Aplicación SAS

> **Workflow vigente:** la documentación autoritativa actual está en [`docs/workflow/`](./docs/workflow/README.md). La SPEC vigente es `docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md` y el glosario canónico es `docs/workflow/aplicacion-sas-CONTEXT-final.md`. Los issues #5–#16 son el plan T01–T12 auditado externamente. El texto que sigue describe el estado actual del Banco de exámenes (Seam 1) y el prototipo brownfield como contexto histórico.

Herramienta web ligera para preparar exámenes de oposiciones del Servicio Andaluz de Salud (SAS): banco de exámenes oficiales, estudio, simulación cronometrada, recuperación de falladas, historial y comparación agregada entre tres participantes.

## Banco de exámenes (Seam 1 — importador real)

Los 12 PDF oficiales iniciales (`Examen_ADM_*.pdf`) entran en el **importador real** y producen un **paquete canónico** por examen (JSON), un **informe QA** y un estado explícito `publicable` o `bloqueado_para_revision`.

```text
.kairos-fixtures/Examen_ADM_*.pdf
        │
        ▼
scripts/parse_sas_exam.py   ← importador real (caja negra, Seam 1)
        │
        ▼
app/public/data/exams/catalog.json        catálogo que apunta a la versión actual
app/public/data/exams/<exam-id>/versions/<sha256>.json  versión inmutable direccionable
app/public/data/exams/<exam-id>.json      alias actual para el consumidor brownfield
app/public/data/exams/<exam-id>.qa.md     informe QA
app/public/data/exams/blocked/*.qa.md     informes de exámenes bloqueados (sin JSON)
```

- **Identidad estable**: cada examen tiene un `id` canónico (p. ej. `sas-administrativo-2023-turno-libre`) y cada pregunta una identidad `exam + número fuente`, independiente de la versión JSON.
- **Versiones inmutables**: la versión combina el SHA-256 del PDF fuente y el hash del paquete canónico final; una fuente o corrección distinta produce una versión que convive con las anteriores en `<exam-id>/versions/`. El catálogo apunta solo a la actual. `source.sha256` conserva la traza del PDF y `version.contentSha256` cubre también el QA final.
- **Anuladas**: quedan inactivas conservando la numeración fuente (el salto queda visible). **Reservas**: solo se activan con evidencia en la fuente; sin evidencia permanecen inactivas conservando su numeración (151–153).
- **Nunca se corrige la fuente**: las anomalías menores de texto (p. ej. el fragmento desplazado `sancionadoras.` en la pregunta 35 del 2023) se conservan sin cambios y entran en el informe QA.
- **Bloqueo explícito**: respuestas ausentes, opciones inválidas, recuentos irreconciliables, anulación/reservas ambiguas o duplicados con contenido distinto producen `bloqueado_para_revision` con un motivo concreto; no se adivina nada.

### Uso

```bash
# Importar un PDF concreto (publica JSON + QA en app/public/data/exams)
.venv/bin/python scripts/import_sas_exam.py .kairos-fixtures/Examen_ADM_L_2023.pdf

# Importar y clasificar los 12 PDF iniciales
.venv/bin/python scripts/import_sas_bank.py

# Verificación (truth test Seam 1 + tests del prototipo)
npm test
```

Requisitos del entorno Python: `pip install -r requirements-parser.txt` (PyMuPDF y jsonschema).

## Prototipo brownfield (contexto histórico)

- Frontend HTML/CSS/JS nativo en `app/` (Vite como herramienta de build, GitHub Pages como alojamiento).
- Arquitectura simplificada v1 y capa de IA/RAG: `docs/architecture-v1-simplified.md` y `docs/architecture-v2-ai.md` (superseded por SPEC v2 cuando contradicen).
- Piloto de importación 2023: `docs/pilot-examen-adm-2023.md`.
