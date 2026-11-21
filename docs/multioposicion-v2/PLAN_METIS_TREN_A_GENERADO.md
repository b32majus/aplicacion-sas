# Metis plan report

- Status: PLAN_READY
- Reason: none
- BASE: 39b1252e043df7ae1b820cc0d653e50258e686a9
- Profile: none
- Model: openai/gpt-6.1-sol#medium
- Attempts: 1
- Duration: 118824 ms

## SAS v2 · Tren A: oposición, falladas y artificial

| # | unit | size | risk | UI | blockedBy | allowedPaths |
|---|---|---|---|---|---|---|
| 1 | m01-oposicion-oficial | M | complex | quality | — | app/src/catalog.js, app/src/app.js, app/index.html, supabase/migrations/20261113090000_opposition_registry.sql, tests/catalog.test.mjs, tests/artificial-exam.test.mjs, tests/history.test.mjs, tests/multiopposition-catalog.test.mjs, tests/e2e/ |
| 2 | m02-falladas-oposicion | M | complex | none | m01-oposicion-oficial | app/src/app.js, supabase/migrations/20261113091000_failed_opposition_boundary.sql, tests/multiopposition-failed.test.mjs, tests/failed-session-rpc.test.mjs, tests/official-flow-boundaries.test.mjs, tests/exam-rpc.test.mjs, tests/direct-answer-idempotency.test.mjs, tests/artificial-exam-rpc.test.mjs, tests/e2e/failed-study.spec.js, tests/e2e/resilient-persistence.spec.js |
| 3 | m03-artificial-oposicion | M | complex | quality | m01-oposicion-oficial, m02-falladas-oposicion | app/src/artificial-exam.js, app/src/app.js, supabase/migrations/20261113092000_artificial_opposition_boundary.sql, tests/multiopposition-artificial.test.mjs, tests/artificial-exam.test.mjs, tests/artificial-exam-rpc.test.mjs, tests/direct-answer-idempotency.test.mjs, tests/third-exam-registry.test.mjs, tests/e2e/artificial-exam.spec.js |

### m01-oposicion-oficial: Elegir oposición y practicar exámenes oficiales

1. Tras login, cualquier usuario autenticado puede elegir y cambiar desde catálogo entre oposiciones con exámenes publicados; ve únicamente los exámenes de la oposición seleccionada y puede estudiarlos en normal/aleatorio o realizar su examen oficial.
2. Una migración nueva registra oposiciones con nombre público y un mapeo administrativo explícito por exam_id, sembrando exactamente los 12 Administrativo existentes, sin inferir prefijos ni modificar paquetes, hashes o registros oficiales inmutables. Una RPC v2 autenticada devuelve exclusivamente metadata publicada y conserva operativa la RPC v1.
3. El frontend incorpora opposition_id únicamente al cruzar exactamente exam_id, exam_version_id y exam_version_path del catálogo con la RPC v2; identidades alteradas, correspondencias ausentes y errores de autorización fallan cerrado, sin fallback estático. El selector y cualquier preferencia local no constituyen ACL.
4. Se reutilizan sin reescritura las RPC oficiales, persistencia, scoring, reloj y guard global: cambiar de oposición no oculta un examen activo al guard ni desbloquea estudio; se puede reanudar el intento con su paquete histórico exacto. Un reloj activo sin offset fiable permanece bloqueado. Se conserva el catálogo autorizado completo para consumidores históricos, separándolo de la proyección visible.
5. La verificación nueva usa dos oposiciones publicadas solo en fixture aislada y demuestra selección, cambio, tuplo manipulado, fallo de RPC y examen Admin activo al navegar a RX y volver. Comprueba conservación de los 12 IDs/versiones/hashes, resultados, auth y RLS. Se adaptan los fixtures consumidores del contrato de catálogo sin debilitar sus aserciones.
6. No se añade lógica de fuentes compuestas, Dashboard, media, signup ni ACL por oposición. El despliegue es servidor antes que UI, con SQL forward-only y explicaciones operativas en español en la migración.

### m02-falladas-oposicion: Repasar las falladas de la oposición elegida

1. Todas mis falladas materializa únicamente preguntas de la oposición seleccionada; los recuentos y fuentes corresponden a ella y Solo falladas de un examen sigue funcionando.
2. Una migración nueva endurece el inicio/materialización de falladas: el servidor verifica oposición homogénea, correspondencia administrativa y fuentes publicadas exactas antes de crear un intento o sus fuentes. El acceso mediante la firma antigua tampoco permite crear una sesión mezclada; se conserva su compatibilidad con fuentes homogéneas existentes.
3. Se mantiene una única sesión activa por usuario y la reanudación devuelve sus fuentes/versiones fijadas, aunque se cambie de oposición o el catálogo actual sea distinto. Los intentos históricos no se reinterpretan ni se filtran por la selección actual.
4. No se modifican filas históricas de progreso, respuestas, algoritmo de dos aciertos, guard global, scoring ni sincronización. Errores de red y reintentos no crean sesiones adicionales ni hacen pasar una recuperación histórica por una nueva sesión de otra oposición.
5. La verificación nueva demuestra que dos fuentes Admin válidas pasan y una fuente RX manipulada se rechaza en servidor sin cambios en intentos, fuentes, progreso o respuestas; cubre reanudación histórica fijada y recuperación tras error de red. Los fixtures de los tests existentes incorporan mapeos administrativos explícitos, conservando sus testigos de idempotencia, auth y bloqueo.
6. No se implementan artificial, Dashboard ni media; los cambios en app.js se limitan al recorrido de falladas sobre el resultado aceptado de M01.

### m03-artificial-oposicion: Generar artificiales de una sola oposición

1. En la oposición seleccionada se generan artificiales de exactamente 75 preguntas activas distintas al azar, tanto en estudio como en examen. Con 74 preguntas distintas disponibles el inicio se bloquea con mensaje claro en español, sin completar con otro banco ni duplicar preguntas.
2. Una migración nueva exige que todos los p_sources pertenezcan a la oposición solicitada y coincidan exactamente con versiones, rutas y preguntas activas de paquetes publicados. La firma antigua conserva el funcionamiento de fuentes homogéneas, pero tampoco puede materializar una mezcla; un rechazo no deja progreso, intentos ni fuentes parciales.
3. La reanudación y revisión usan la composición persistida del artificial, no el pool de la oposición actualmente seleccionada; siguen funcionando aunque ese pool tenga menos de 75 preguntas o hayan cambiado las versiones publicadas. Se conserva la identidad de pregunta de origen al actualizar progreso.
4. Se reutilizan los motores de estudio y examen, los 120 minutos del artificial, deadline absoluto, cierres, scoring, persistencia e idempotencia existentes. No se cambian plazos, locking ni finalize=true; se conserva el orden attempt-row antes de UUID advisory lock.
5. La verificación nueva demuestra N=75 válido en ambos modos, N=74 bloqueado, duplicados y fuente extrínseca rechazados por servidor sin efectos parciales, y reanudación/revisión con versiones fijadas. Se ejecutan los tests existentes de confirmación repetida con UUID idéntico, sincronización, deadline, scoring e historia sin crear testigos redundantes de esos contratos.
6. No se implementan Dashboard, rankings multioposición, media ni publicación de RX real; los cambios en app.js se hacen sobre el resultado aceptado de M02.

## Coverage

| requirement | units |
|---|---|
| Cualquier usuario ya autenticado elige libremente una oposición desde el mismo login y puede cambiarla desde catálogo. | m01-oposicion-oficial |
| Catálogo filtrado mediante el tuplo exacto autorizado; oposición exclusivamente de opposition_id de RPC v2, sin modificar catalog.json esquema 1.0 ni parser. | m01-oposicion-oficial |
| Mapeo administrativo verificable por servidor, sin prefijos; sembrar los 12 Administrativo exactos conservando paquetes, IDs, versiones, hashes y resultados. | m01-oposicion-oficial |
| Normal, aleatorio y examen oficial reutilizan el motor existente; guard y deadline globales sobreviven al cambio de oposición, con reanudación históricamente fijada y fallo cerrado sin offset fiable. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |
| Login, RLS y roles participant|test|admin existentes, sin ACL por oposición ni signup; test/admin acceden a todas las oposiciones sin incorporarse a rankings. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |
| Registrar oposición y nombre público en servidor; RPC v2 autenticada solo de metadata, compatible con RPC v1 y sin answer keys. | m01-oposicion-oficial |
| Todas mis falladas contiene solo preguntas de la oposición seleccionada y Solo falladas de un examen continúa funcionando. | m02-falladas-oposicion |
| El servidor rechaza nuevas sesiones de falladas con fuentes de oposiciones diferentes, independientemente de parámetros manipulados; no basta filtrado visual. | m02-falladas-oposicion |
| Falladas históricas conservan fuentes y versiones, sin mutar progreso ni algoritmo de racha/dos aciertos; red y reintentos no crean duplicados o sesiones extrañas. | m02-falladas-oposicion |
| Artificial de 75 preguntas activas distintas al azar de una sola oposición, en estudio y examen; menos de 75 bloquea con mensaje claro, sin mezcla ni repetición. | m03-artificial-oposicion |
| Servidor verifica oposición solicitada y paquetes/versiones publicados exactos de todos los p_sources artificiales; rechaza fuentes extrínsecas sin progreso parcial. | m03-artificial-oposicion |
| Artificial reanudable y revisable con fuentes fijadas, historial y progreso de origen conservados; mantener tiempo, cierres, scoring, idempotencia y finalize=true. | m03-artificial-oposicion |
| Fallo de autorización/correspondencia oculta exámenes nuevos sin fallback estático; preferencia local no es ACL ni verdad de servidor. | m01-oposicion-oficial |
| Solo migraciones nuevas forward-only, servidor antes que UI, frontend antiguo compatible, sin operación destructiva ni cambios a rutas protegidas, cuentas reales o Supabase hosted. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |
| Ningún nuevo examen oficial contra fuente no publicada o JSON no aprobado; segunda oposición únicamente en fixture aislada, nunca ficticia en producción. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |
| Conservar orden de locks attempt-row antes de UUID advisory lock y ejecutar tests existentes de UUID idempotente y sincronización sin testigos redundantes. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |
| Sin secretos frontend, servidor adicional o PWA obligatoria; español en código nuevo, documentación, pruebas y UI; sin refactor general, cambios de CI, locks o parser. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |
| Mantener tres verticales secuenciales M01-M03; M04 Historial/Dashboard, M05 Media y preparación/publicación manual-asistida del RX real quedan fuera. | m01-oposicion-oficial, m02-falladas-oposicion, m03-artificial-oposicion |

## Consumers

- `app/src/history.js` → m01-oposicion-oficial
- `app/src/history.js` → m02-falladas-oposicion
- `app/src/history.js` → m03-artificial-oposicion
- `app/src/dashboard.js` → m01-oposicion-oficial
- `app/src/artificial-exam.js` → m03-artificial-oposicion
- `app/src/active-attempt-persistence.js` → m01-oposicion-oficial
- `app/src/active-attempt-persistence.js` → m02-falladas-oposicion
- `app/src/active-attempt-persistence.js` → m03-artificial-oposicion
- `app/src/study-session.js` → m03-artificial-oposicion
- `app/src/exam-clock.js` → m01-oposicion-oficial
- `tests/catalog.test.mjs` → m01-oposicion-oficial
- `tests/history.test.mjs` → m01-oposicion-oficial
- `tests/artificial-exam.test.mjs` → m01-oposicion-oficial
- `tests/e2e/` → m01-oposicion-oficial
- `tests/failed-session-rpc.test.mjs` → m02-falladas-oposicion
- `tests/official-flow-boundaries.test.mjs` → m02-falladas-oposicion
- `tests/exam-rpc.test.mjs` → m02-falladas-oposicion
- `tests/direct-answer-idempotency.test.mjs` → m02-falladas-oposicion
- `tests/artificial-exam-rpc.test.mjs` → m02-falladas-oposicion
- `tests/artificial-exam.test.mjs` → m03-artificial-oposicion
- `tests/artificial-exam-rpc.test.mjs` → m03-artificial-oposicion
- `tests/direct-answer-idempotency.test.mjs` → m03-artificial-oposicion
- `tests/third-exam-registry.test.mjs` → m03-artificial-oposicion
- `tests/e2e/artificial-exam.spec.js` → m03-artificial-oposicion
- `tests/e2e/failed-study.spec.js` → m02-falladas-oposicion
- `tests/e2e/resilient-persistence.spec.js` → m02-falladas-oposicion

## Open questions

- M04 resolverá Historial/Dashboard por oposición, privacidad, comparativas, cohortes y cualquier política nueva de ranking; este tren solo conserva los contratos existentes.
- M05 y la preparación, QA y publicación del primer RX real se realizarán contra el resultado aprobado del tren A, fuera de estas unidades.

## For human approval

Metis has only checked that the plan is well formed. Whether this split is the right one is your decision.
Each unit is then prepared with `metis prep` (S13b chains them).

## Attempts

### Attempt 1

- Session: ses_e28e0ca96ffewwcfvtwhM2CeJt
- Exit code: 0

Nothing was written to the repository: Metis does not push and does not merge.
