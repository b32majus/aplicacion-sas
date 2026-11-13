# HANDOFF — Aplicación SAS

## EMPEZAR AQUÍ

- **Fecha:** 2026-11-13.
- **Producción conocida:** PR #31 integrada, `main=39b1252e043df7ae1b820cc0d653e50258e686a9`; 12 exámenes Administrativo publicados y registrados; 7 cuentas Auth (3 test, 1 admin, 3 participantes).
- **Trabajo actual:** preparar evolución multioposición v2; no hay código ni migraciones v2 aplicados.
- **Decisión firme de Sil:** UNA app y login; cualquier usuario autenticado puede elegir libremente Administrativo o Radiodiagnóstico. Sin instalación PWA obligatoria. JSON canónico manual/asistido, sin parser universal.
- **Protocolo seleccionado:** Metis (riesgo en base, RLS, permisos, examenes y datos); leído ARRANQUE → PROTOCOLOS → metis/README del repositorio KairOS vigente.
- **Worktree de planificación:** `/srv/kairos-lab/projects/aplicacion-sas/worktrees/multioposicion-v2`; rama `plan/multioposicion-v2`, basada en `origin/main` 39b1252.
- **Checkout ajeno:** NO tocar `/srv/kairos-lab/projects/aplicacion-sas/repo`, actualmente `fix/publish-full-corpus`, ni sesiones Herdr ni otros worktrees.
- **Documentos de referencia:** `docs/multioposicion-v2/CONTRATO_Y_ARQUITECTURA.md`, `PLAN_KAIROS_METIS.md`, `FUENTE_RX.md`.
- **Fuente RX:** `EXAMENES RX(1).pdf`, 353 págs., SHA256 5e5c65f056386f37fa6fb7903d89c866a72c4547f28434eb3caa6db5c0a5118e. Aún NO transferida/verificada en VPS.
- **Puntos críticos:** conservar 12 versiones e históricos Admin; relación oposición-examen verificada por servidor; no mezclar fuente artificial/falladas; Dashboard v1 limitado a tres aliases; soporte de casos con imágenes.
- **Plan propuesto REVISADO, PENDIENTE DE GO:** cinco verticales M01 selector+catálogo/estudio oficial conservando RPCs; M02 falladas por oposición; M03 artificiales por oposición; M04 historial+dashboard/privacidad por oposición; M05 imágenes y QA con fixture, sin publicar examen RX incompleto. Dos lotes Metis (A: M01–M03; B: M04–M05); luego DIA para el primer examen RX real y los demás paquetes manuales.
- **Estado KairOS:** Sil dio GO al plan de cinco unidades; Issue #32 y PR #33 actualizados. `plan-units sas-v2a-p1` -> `PLANNER_STOP` por esquema cerrado de catálogo, corregido sin tocar parser. `plan-units sas-v2a-p2` -> **PLAN_READY**, 3 unidades M complejas, dependencia M01→M02→M03. Archivos `docs/multioposicion-v2/PLAN_METIS_TREN_A_GENERADO.md` y `PLAN_METIS_TREN_A.json`. Pendiente aprobación humana del plan concreto. No ejecutados prep-train, train, SQL hosted ni deploy.
- **Próximo paso:** Sil revisa el PLAN_READY generado; tras su aprobación, preparar **sólo** tren A con `prep-train`, después auditoría única y GO a train. Tren B se planifica contra canon integrado de A.
- **Preflight al retomar:** leer ARRANQUE, PROTOCOLOS, metis/README, luego este bloque; contrastar GitHub (`gh pr list`, `gh issue list`) y `git worktree list` / `git log`.
- **GO:** GO de documentación y plan-units ya usado; prep-train, train, merge y deploy NO ejecutados. Producción necesita GO específico según KairOS.

## Fuentes antiguas

La SPEC v1 de Administrativo, Issues T01–T12 y `DECISIONS.md` siguen siendo trazabilidad y contratos de v1, pero sus estados de implementación de agosto están desactualizados; para v2 manda el contrato de la carpeta anterior, sin alterar la historia de v1.
