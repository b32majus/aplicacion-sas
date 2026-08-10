# START HERE — Aplicación SAS

## Purpose
PWA privada para tres usuarios que preparan Administrativo/a del SAS con exámenes oficiales, estudio, simulación cronometrada, recuperación de falladas, historial y comparación agregada.

## Current phase
IMPLEMENTATION READY — SPEC v2 y plan T01–T12 auditados externamente con veredicto `READY`.

## Current vs target

```text
CURRENT: prototipo brownfield 2023 + parser piloto + deploy Pages + documentación canónica + tickets auditados
TARGET:  implementar T01–T12 respetando el grafo, con fresh context por ticket, tests en Seam 1/Seam 2 y PRs revisables
```

## Read order

1. `PROJECT.md`
2. `DECISIONS.md`
3. `docs/workflow/README.md`
4. `docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md`
5. `docs/workflow/aplicacion-sas-CONTEXT-final.md`
6. `docs/workflow/AUDIT-TICKETS-RESULT.md`
7. `docs/workflow/OVERNIGHT-SEQUENTIAL-RUN.md` cuando se ejecute el train desatendido
8. Issue activo de GitHub

## Active work

```text
ACTIVE ISSUE/WO: #5 — T01 Banco oficial canónico, versionado y verificable
ACTIVE HANDOFF: NONE
HUMAN DECISIONS OPEN: NONE para el plan funcional auditado
NEXT CAUSAL STEP: ejecutar T01; avanzar solo tras PASS al siguiente ticket de la cola aprobada
```

## Do not reopen without new material evidence

- SPEC-to-spec-v2 es el contrato funcional/técnico vigente.
- CONTEXT-final define el vocabulario canónico.
- No IA explicativa, RAG, taxonomía temática, tiempo por pregunta, Realtime, offline-first, React/Vue/Next ni backend propio en v1.
- El propio Intento activo es la fuente de verdad del progreso reanudable; no `study_progress` separado.
- `question_progress` se ancla a la identidad estable de pregunta entre versiones.
- Importación ambigua bloquea; no inventar anuladas/reservas/respuestas.
- Código brownfield puede reutilizarse si ayuda, pero no condiciona la arquitectura cuando contradice SPEC v2.

## Repository/runtime notes

- GitHub: `b32majus/aplicacion-sas`
- Workspace VPS esperado históricamente: `/srv/kairos-lab/projects/aplicacion-sas`; verificar identidad real antes de ejecutar.
- Herdr/OpenCode puede permanecer persistente como workshop/backend, pero cada ticket debe ejecutarse con **fresh cognitive context**.
- No auto-merge, no push directo a `main`, no force-push, no deploy/activación privilegiada durante el train.
