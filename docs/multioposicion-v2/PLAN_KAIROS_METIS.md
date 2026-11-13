# Plan de ejecución KairOS — multioposición v2

**Estado:** REVISIÓN DE TAMAÑO DE UNIDADES (2026-11-13). Diseño **propuesto, pendiente de GO**; no se ha iniciado Metis.
**Protocolo:** Metis 9.9 — ver `/srv/kairos-lab/KairOS_Protocol/ARRANQUE.md`, `PROTOCOLOS.md`, `metis/README.md` y `HERDR.md`. Trabajo grande/sensible por cambios de Supabase, RLS, RPC y conservación de históricos.
**Base:** `origin/main 39b1252e043df7ae1b820cc0d653e50258e686a9`; 12 exámenes Administrativo ya en producción. Documento vinculado al Issue #32 y PR #33 (DRAFT).

## Por qué cambiar el plan anterior de M01–M03

El borrador anterior era demasiado amplio por unidad:
- M01 juntaba selector, catálogo, estudio oficial, examen cronometrado y salvaguardas del reloj.
- M02 juntaba falladas, artificial, dashboard y privacidad; son 3 contratos RPC distintos.
- M03 juntaba motor de medios, UI, QA y extracción/publicación de 10 exámenes; combinaba ingeniería con revisión documental intensiva.

**Dato comprobado en código:** el motor oficial ya es genérico por `exam_id`, versión y duración; la autorización de paquete usa `get_published_official_exam_versions` + `loadPublishedCatalog`. El punto de mezcla real está en `startFailedStudy(null)`/fuentes y `startArtificial` (ambos reciben fuentes múltiples); el Dashboard v1 es la otra pieza fuertemente global (`get_dashboard()`, tres aliases). Evitar reescribir motor de examen/estudio/score sin evidencia de una dependencia real.

## Unidades verticales (5, con contratos disjuntos)

| Unidad | Resultado completo y observable | Cambio acotado | Oráculo NUEVO e independiente |
| --- | --- | --- | --- |
| **M01 — Elegir oposición + catálogo/estudio oficial** | Login → elegir Admin/RX → ver sólo el catálogo autorizado de esa oposición → entrar en un examen/estudio oficial existente → volver a selección. Reanudar un examen activo conserva deadline y fuente. | Mapeo inmutable de oposición a `exam_id` en backend + RPC metadata autenticada compatible; añadir `oppositionId` al catálogo estático, selector/contexto y filtrado. **Reutilizar** RPCs de estudio/examen actuales sin reescribirlas. Antes de publicar RX probar segunda oposición con fixture; hasta entonces mostrar Admin sin sección vacía engañosa. | Dos catálogos con registro concordante; manipulaciones tuplo estático/servidor fallan cerradas; 12 Admin/históricos sin cambios; cambio de oposición no elude examen activo. |
| **M02 — Falladas de la oposición** | En Admin/RX: «Todas mis falladas» sólo de la oposición elegida; también falladas de un examen; reanudación y revisión histórica fieles. | Filtrar candidatos por oposición; autorizar en servidor el conjunto de fuentes de falladas multi-examen; compatibilidad con las sesiones existentes sin `opposition_id` materializado. No cambiar el algoritmo de dos aciertos o los datos antiguos. | Mezclar una fuente de otra oposición es rechazado servidor; no desaparecen falladas históricas Admin; reanudar sesión anterior funciona; no se afectan usuarios ajenos. |
| **M03 — Examen artificial de una oposición** | Generar 75 preguntas de una sola oposición en modo estudio/examen; corregir, reanudar y reproducir histórico sin mezclar origen. | Filtrado de pool, validación servidor de identidad y oposición de **todas** las fuentes, conservar los 75 y los locks/deadline existentes. No retocar recuentos, scoring ni sincronización salvo necesidad demostrable. | 75 fuentes homogéneas aceptadas y una fuente de otra oposición rechazada; oposición con <75 bloquea de forma explicativa; idempotencia y reloj intactos. |
| **M04 — Historial filtrado + Dashboard por oposición** | Ver mi historial de la oposición y sus resultados; comparativas y preguntas falladas por cohorte SIN sumar otra oposición ni incluir test/admin. | Filtro histórico sobre intentos/fuentes fijados; nueva RPC de agregados por oposición compatible con legacy `get_dashboard`; cohorte `participant` por actividad real en esa oposición, sin límite global de 3; estados vacíos útiles. Evitar reescribir RLS cruda ni identidades. | Métricas y ranking sólo de la oposición; falladas compartidas con N >= 2, nunca «1 de 1»; ninguna respuesta ajena, `admin/test` no ranking; los tres originales siguen comparándose en Admin. |
| **M05 — Pregunta visual completa, sin publicación masiva RX** | Un **caso de prueba** con imágenes se ve ampliable y enlazado en estudio, examen, falladas, artificial e historial, móvil y escritorio. | Esquema JSON multimedia **opcional**, metadatos `caseId` y rutas/sha inmutables, assets verificables, renderer/zoom accesible y QA. Ejecutar con **fixture multimedia sintética o autorizada** (no publicar un examen RX incompleto) y sin alterar los 12 paquetes Admin. | Media íntegra funciona en todos los modos; falta/hash corrupto/ruta insegura bloquea QA; sin retroeditar versiones; replay histórico conserva la media exacta. |

**Tamaño:** 5 unidades con resultado de usuario y una familia principal de riesgos por unidad. No crear tickets separados para una tabla, un botón, un mock o un helper: no son verticales. No añadir nuevas abstracciones para funcionalidades que el motor actual ya cubre.

## Secuencia eficiente / lotes de ejecución

1. **Metis train A: M01→M02→M03**. Tres unidades conectadas por la elección de oposición y la validación de fuentes; prueba incremental tras cada una. No desplegar funcionalidades incompletas a producción.
2. **Metis train B: M04→M05** tras integrar/rebasar de forma normal el estado aprobado del train A. Las pruebas de Dashboard y multimedia quedan independientes de los fallos y riesgos del tren anterior; evitar trabajos paralelos en `app/src/app.js` (≈1711 líneas).
3. **DIA posterior — contenido RX real**, sólo cuando M05 esté validada: preparar manualmente/asistido **un examen completo** representativo del PDF con sus imágenes/plantilla, validarlo como paquete inmutable y registrarlo sólo tras GO. El resto del corpus RX se incorpora en **lotes de exámenes independientes**, sin Metis para simple autoría documental.

**Los trenes y número de unidades son propuesta**, no un comando ejecutado: `plan-units` deberá concretar tamaños y allowedPaths, y podrá fusionar o dividir **sólo si hay evidencia clara** (no por ceremonia). Si M05 crece más de lo esperable, limitarla primero a un único caso visual de prueba con replay y QA completo, no intentar extraer PDF en la misma unidad.

## Contratos transversales y protección de producción

- **Acceso libre entre oposiciones para autenticados**; la selección no es una ACL. Un usuario puede invocar un examen oficial de cualquiera de las oposiciones. La integridad que hay que imponer en servidor es que **una sesión de fuentes múltiples no mezcle** identidades de oposiciones. Evitar rediseñar autorización oficial sin motivo.
- Usuarios y roles se mantienen: `participant` aparece en comparativas de oposiciones con actividad; `test/admin` conserva acceso normal y estadísticas privadas pero queda fuera de ranking. Regla visible de N para «falladas por todos» fija antes de M04.
- No tocar los 12 JSON/versiones inmutables ni la puntuación normalizada; no cambiar deadline, lock order ni RLS actual salvo cambios acotados necesarios. Migraciones forward-only, sin destructivas ni secretos.
- Backend v2 compatible antes de frontend v2; mapeo de 12 Admin estable, sin exponer claves correctas en RPC metadata. Si un banco no coincide con registro publicado, se oculta (fail closed).
- No alterar las sesiones vivas de Herdr ni usar lanzadores alternativos. Worktrees aislados y preferiblemente agentes visibles dentro de Herdr cuando corresponda.
- No introducir parser automático nuevo: contenido RX vía JSON revisado y activos con procedencia. Acceso principal vía GitHub Pages, sin PWA instalable como criterio.
- Copia PDF RX aún **no verificada en VPS**: M01–M04 pueden desarrollarse sin ella; la publicación DIA requiere disponer de la fuente y comprobarla.

## Contrato de gate: evidencia proporcional al riesgo

- Cada unidad trae: usuario/recorrido + interfaz + invariante servidor si aplica + 5–8 criterios de aceptación + **un oráculo discriminante** que falla en BASE y pasa 3/3 sobre referencia privada. Las suites ya lanzadas por gate no se duplican como testigos.
- **M01:** contrato RPC/estático y UX de navegación; compatibilidad con 12 versiones y resume global.
- **M02 y M03:** tests SQL/PGlite y test hosted focal de fuentes cruzadas; offline/replay vigentes; no ejecutar sobre participantes reales.
- **M04:** RLS/privacidad/agregados con 2–4 participantes técnicos, más compatibilidad con aliases v1.
- **M05:** media hash/QA + Playwright viewport móvil/escritorio y replay; sin publicar fixture técnico como oficial.
- Validaciones globales de CI: `npm test`, build, verificadores catálogo/registro, `git diff --check`. No perseguir full-Playwright 25/25 si hay fallo flaky no ligado a la unidad; clasificar `PRODUCT_DEFECT | TEST_FIXTURE_DEFECT | ENVIRONMENT_LIMITATION`.
- Antes de producción: snapshot y copia recuperable de datos, verificación del ledger, CI+PR, hosted seguro, autorización expresa de Sil para cada migración/registro y otro GO para deploy. Merge sólo con gate válido y autorización conforme ARRANQUE.

## Ejecución KairOS

- **Antes de cualquier run:** Issue #32 aprobado por Sil, `plan-units` y aprobación humana de unidades.
- `prep-train` por lote; prepara referencia privada y oráculos (BASE rojo, referencia verde 3/3).
- Una sola auditoría de preparación por Cora, veredicto OK/REHACER. Tras REHACER: `prep-check` acotado, sin otra auditoría general.
- `train --prep-dir` (Metis congelado 9.9) → PR_READY → revisión/merge humano según GO. Fallos infra → `train-resume --prep-dir`; `ORACLE_DRIFT` → parche puntual de oráculo + `prep-check` + resume.
- Sin GO explícito: **no push, no PR, no merge, no deploy**. Este plan revisado se conserva sólo en el worktree hasta autorización para publicarlo en PR #33.
- No ejecutar código, DDL, migraciones hosted, despliegues ni modificar checkout `repo` durante esta revisión.

## Referencias

- `CONTRATO_Y_ARQUITECTURA.md`: decisiones del producto y fronteras.
- `FUENTE_RX.md`: 10 bloques del PDF y cuadernillos visuales.
- `HANDOFF.md`: estado y arranque; `CALIDAD.md`: calidad.
- `KairOS_Protocol/HERDR.md`: sesiones en Herdr y reglas de concurrencia.
