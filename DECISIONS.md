# DECISIONS — Aplicación SAS

Record only durable decisions that change future work. Detailed debate remains in workflow artifacts, Issues and PRs.

## D-001 — SPEC v2 and CONTEXT are authoritative

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
`docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md` is the current functional/technical contract and `docs/workflow/aplicacion-sas-CONTEXT-final.md` is the canonical glossary. Earlier specs/architectures are traceability only when they conflict.

### Why
SPEC v2 passed independent re-review and was declared ready for ticketing.

### Consequences
- Future agents do not reopen settled product decisions without new material evidence.
- Legacy README/architecture/code cannot override SPEC v2.

### Revisit when
- New evidence makes a SPEC v2 decision materially impossible or unsafe.

---

## D-002 — Brownfield salvage, not preservation by inertia

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
Keep the repository/history and reuse useful pieces such as parser principles, QA fixture, Pages deploy, CSS/markup and small helpers. Replace legacy core/schema/controller pieces when preserving them would distort SPEC v2.

### Why
The prototype predates the final workflow and contains both useful evidence and superseded assumptions.

### Consequences
- No greenfield rewrite by default.
- No compatibility layer solely to preserve experimental abstractions.

### Revisit when
- Implementation evidence shows a supposedly replaceable component is already aligned and cheaper to adapt.

---

## D-003 — T01–T12 plan is externally audited READY

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
GitHub Issues #5–#16 are the approved tracer-bullet implementation graph. The external ticket audit returned `READY`; result is archived in `docs/workflow/AUDIT-TICKETS-RESULT.md`.

### Why
The auditor checked coverage, dependencies, privacy, deadlines, versioning, idempotency, seams and excluded scope against SPEC v2/CONTEXT.

### Consequences
- Do not regenerate planning from scratch.
- Correct tickets only if implementation reveals a material contradiction.

### Revisit when
- A ticket reaches a real blocker proving the approved plan cannot satisfy the contract.

---

## D-004 — Overnight execution is sequential, fresh-context and fail-closed

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
For unattended work, linearize the approved DAG in ticket order T01→T12. Use a persistent Herdr workshop/backend only as supervisor; each ticket gets a fresh OpenCode writer/reviewer context. Advance only after a verified PASS/checkpoint; any material BLOCKED condition stops the train. No auto-merge.

### Why
This sacrifices parallel throughput overnight in exchange for minimal branch races, deterministic dependency availability and easy morning review.

### Consequences
- Later tickets may inherit earlier already-passed sibling changes even when not strict blockers; this is intentional for the unattended linear train.
- PRs may be stacked/cumulative; incremental review range remains previous successful head → current candidate.
- T12 stays last overnight even though its graph blockers would allow it after T02.

### Revisit when
- Sil is present and wants to exploit the true frontier in parallel.

---

## D-005 — Matt skills are implementation methods; KairOS owns the routine reviewer

```text
DATE: 2026-08-10
STATUS: ACTIVE
ADR: none
```

### Decision
Use the locally installed Matt Pocock skills where they add implementation value, especially `/tdd` at the two already-approved seams. Do not routinely run Matt `/code-review` in addition to the KairOS fresh tree-bound reviewer. If the installed `/implement` automatically launches an independent `/code-review`, do not use it as the top-level overnight command; implement the ticket inside the fresh KairOS writer with the same vertical/TDD discipline instead.

### Why
Current upstream `/implement` ends with `/code-review`, while the KairOS workflow explicitly avoids duplicate reviewers and binds its reviewer to the exact candidate tree/evidence.

### Consequences
- Planning skills remain closed during implementation.
- Seam confirmation required by `/tdd` is already satisfied by SPEC v2/tickets; agents do not ask Sil again.
- KairOS reviewer unavailability is a STOP, not a reason to silently substitute another review path.
- Skills are not installed or upgraded during the unattended train.

### Revisit when
- The installed `/implement` is intentionally adapted to delegate its final review exclusively to KairOS, or KairOS review policy changes.

---

## D-006 — Evolución multioposición sin clonar producto

```text
DATE: 2026-11-13
STATUS: ACTIVE — decisión de Sil
```

Una app, un login y un backend: Administrativo y Radiodiagnóstico comparten motor. Cualquier persona autenticada puede entrar y alternar libremente entre oposiciones disponibles; no hay roles/ACL por oposición. Los historiales y las estadísticas de cada oposición se mantienen separados. Diseño y aceptación en `docs/multioposicion-v2/CONTRATO_Y_ARQUITECTURA.md`.

---

## D-007 — No reabrir decisiones v1 supersedidas

```text
DATE: 2026-11-13
STATUS: ACTIVE — decisiones anteriores reiteradas
```

- Publicación de exámenes nuevos a partir de **JSON canónico preparado/revisado manualmente**, no parser universal PDF de producción.
- Uso por **enlace GitHub Pages**; la instalación nativa PWA no es objetivo funcional.
- Regla de anuladas/reservas: sustitución por orden, restantes anuladas sin puntuación y normalización nominal/efectivo; fuente oficial y plantilla definitiva prevalecen.
- No abrir una nueva auditoría general del motor T01–T12 por añadir otra oposición.

---

## D-008 — Metis para v2; revisión una vez y cierre acotado

```text
DATE: 2026-11-13
STATUS: PROPOSED — pendiente de Issue/plan aprobado
```

Se propone Metis 9.9 para implementar v2 por alcance y riesgo (RLS, migraciones y exámenes en producción). Unidades verticales M01–M03, preparación con oráculos demostrados BASE-falla/referencia-pasa 3/3, **una** auditoría de preparación y corrección por `prep-check`/`train-resume`. Esta decisión no autoriza ni un train ni un deploy. Véase `docs/multioposicion-v2/PLAN_KAIROS_METIS.md`.

---

## D-009 — Radiodiagnóstico incluye media radiológica versionada

```text
DATE: 2026-11-13
STATUS: PROPOSED — validación de diseño pendiente
```

El PDF RX adjunto contiene cuadernillos visuales vinculados a casos prácticos. La nueva arquitectura precisa referencias inmutables a media/casos, visor responsive y trazabilidad de página/hash sin alterar paquetes históricos de Administrativo. Cada paquete RX sigue una validación manual de imágenes y plantilla antes de PR/registro. Véase `docs/multioposicion-v2/FUENTE_RX.md`.

---

## D-010 — Resolver oposición desde el registro autenticado, sin ampliar catalog.json

```text
DATE: 2026-11-13
STATUS: ACTIVE — resolución técnica acotada del primer PLANNER_STOP de Metis
```

El validador canónico exige campos exactos en `catalog.json`. No modificar ese formato ni el parser histórico para v2: la RPC autenticada de registro v2 añade `opposition_id` y el frontend sólo lo utiliza **tras** la coincidencia exacta del tuplo `exam_id`/`version_id`/`path` con el catálogo estático. Fallo cerrado sin acuerdo. Esto evita una migración innecesaria de los 12 paquetes existentes.
