# Plan de ejecución KairOS — multioposición v2

**Estado:** PREPARACIÓN DE DISEÑO. La implementación no ha empezado.
**Protocolo escogido:** **Metis**, leído en `/srv/kairos-lab/KairOS_Protocol/ARRANQUE.md`, `PROTOCOLOS.md` y `metis/README.md` (2026-11-13). Motivo: migraciones, RLS, autorización de contenido, exámenes activos y datos históricos de producción.
**Versión congelada:** `/srv/kairos-lab/qualification/metis-pilot-9.9/bin/metis.mjs`. Para `train` y `train-resume` siempre `--prep-dir`; no lanzar otras sesiones ni orquestadores Herdr, no matar procesos de otros proyectos.

## Reglas del trabajo

1. Un **Issue v2 aprobado** por Sil antes de `plan-units`. Este diseño no es autorización para ejecutar migraciones, PR merge ni deploy.
2. `plan-units` -> aprobación del plan -> `prep-train` -> **una sola auditoría de preparación** por Cora (OK/REHACER) -> `train --prep-dir ...` -> PR_READY -> merge humano. Correcciones por `prep-check` o `train-resume`, no auditorías repetidas.
3. Las unidades son **verticales**, cada una con dominio+pantalla+recorrido+oráculo que FALLA en BASE y PASA 3/3 con referencia privada. No microtareas para inflar el train.
4. El writer, gate y evaluador de Metis usan roles/modelos según el repo-config vigente; nunca leer `reference.patch` durante la auditoría.
5. Sólo nuevos tests testigo fuera de los comandos ya incluidos en gate; los tests existentes se usan como regresión ordinaria.
6. Nada de push/PR/merge/deploy sin GO de Sil; un GO en bloque debe referirse a una propuesta concreta. Deploy siempre exige GO separado. Ninguna operación de producción forma parte de `train`.
7. No editar el checkout de trabajo de Sil ni sus worktrees actuales: `/srv/kairos-lab/projects/aplicacion-sas/repo` sigue en `fix/publish-full-corpus`. Trabajo de planificación en `worktrees/multioposicion-v2`, rama `plan/multioposicion-v2`.

## Plan de unidades propuesto para aprobar en `plan-units`

| Unidad vertical | Usuario demuestra | Dominios y backend | Oráculo representativo (red/green) |
| --- | --- | --- | --- |
| **M01 — Elegir oposición y estudiar sin mezclar** | Login -> elegir Admin/RX -> catálogo pertinente -> estudio o examen oficial de esa oposición -> volver a elegir; intento en curso conservado. | `oppositions`, mapeo exacto de registro, RPC de autorización v2, filtros en catálogo, selector y navegación, guard de exam global. Backfill inocuo de los 12 IDs Admin. | UI E2E selecciona oposición y no muestra otras; RPC niega fuentes cruzadas; 12 activos históricos conservados. |
| **M02 — Falladas, artificiales e indicadores por oposición** | Crear examen artificial dentro de un banco, repasar «mis falladas» del banco y ver dashboard personal/compartido sin datos del otro. | RPCs de fuentes mixtas, progreso/estadísticas scoping, `get_opposition_dashboard_v2`, cohorte de participantes por oposición, RLS/agregados y tarjetas de UX. | Artificial con fuente extraña falla en servidor; históricos siguen trazables; test/admin no rankean; sin contaminación de métricas ni respuestas privadas. |
| **M03 — Caso radiológico con imágenes y publicación completa** | Abrir un examen real RX, resolver una pregunta ligada a imágenes ampliables, terminar, corregir e inspeccionar el histórico con imágenes. | Esquema multimedia, assets versionados, visor responsive/accesible, QA/hashes, un examen RX con JSON+SQL y plantilla revisada. | Recurso alterado/missing falla publicación; visual estudio/examen/historia; puntuación server y replay versionado; test navegable en móvil. |

**Después del motor v2:** incorporar el resto de exámenes RX en tandas de publicación humana (DIA por paquete/lote bien acotado). No usar Metis para copiar mecánicamente decenas de ítems si la plataforma ya está validada.

## Gates por unidad y de integración

- **Antes de escribir:** base/código/historias exactos, validación de todos los paths en allowlist, test rojo en BASE y 3/3 referencia. No ejecutar agentes por intuición.
- **M01:** integridad de autorización y separación entre bancos, compatibilidad con front v1 y con old schema hasta despliegue seguro; pruebas de reloj y bloqueo interoposición.
- **M02:** tests de no contaminación cross-opposition, privacidad RLS y ranking con N distintos; no usar cuentas reales para pruebas destructivas.
- **M03:** integridad bit a bit de media, verificación humana de fuente/plantilla, render de imágenes en 2 tamaños, modo historia y caso compartido.
- **Todo:** `npm test`, `npm run build`, verificadores del Banco, `git diff --check`, tests focales hosted con cuentas técnicas cuando corresponda; fallos mock/flaky clasificados antes de modificar producto.
- **Antes de producción:** preflight conteos, backup+restauración probada, migraciones forward-only, verificación registros actuales, PR+CI, GO específico para migración/registro y GO de deploy, smoke en URL real.

## Contratos que NO se renegocian

- Acceso abierto a todas las oposiciones **para usuarios ya autenticados**; signup público no.
- 12 Administrativo integrados y estables; no alterar sus JSON versionados.
- JSON canónico manual/asistido; parser PDF universal no requerido.
- GitHub Pages por URL, no instalación nativa PWA como criterio.
- El cliente puede mostrar respuestas oficiales públicas durante estudio, pero las RPC de nota usan la clave canónica de servidor.
- El reloj y el lock de idempotencia siguen siendo invariantes transversales.

## Primeras acciones autorizadas tras aprobación

1. Crear/actualizar Issue v2 con este contrato; marcarlo APPROVED sólo tras conformidad de Sil.
2. Ejecutar Metis `plan-units` desde una preparación nueva, no desde el worktree de producción.
3. Revisar una sola vez el resultado del plan y aprobar los tickets verticales.
4. Preparar cada unidad en `prep-train`; aprobar o REHACER con defectos concretos.
5. Iniciar train y detenerse en PR_READY; no tocar Supabase hosted todavía.

## Evidencia y trazabilidad

- Contrato: `CONTRATO_Y_ARQUITECTURA.md`
- Fuente de imágenes/preguntas: `FUENTE_RX.md`
- Estado de sesión y siguiente paso: `HANDOFF.md` raíz, bloque `EMPEZAR AQUÍ`
- Registro de calidad: `CALIDAD.md` raíz
- No hemos creado aún oráculos, referencias privadas, config del train ni ejecutado Metis. No afirmar lo contrario.
