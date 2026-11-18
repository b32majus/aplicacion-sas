# Metis unit · sas-v2a-prep2 · m02-falladas-oposicion

## Problema

Tras M01, la aplicación ya tiene registro de oposiciones, mapeo administrativo
explícito y catálogo privado proyectado por oposición. El recorrido «Todas mis
falladas», sin embargo, sigue siendo **global**: `eligibleFailureSources()`
recorre todo el catálogo autorizado y el RPC de inicio
`start_or_resume_failed_attempt(ámbito, fuentes)` acepta cualquier cola de
fuentes válidas sin comprobar a qué oposición pertenece cada una. Con una
segunda oposición publicada, el usuario vería y materializaría una sesión de
falladas mezclando bancos distintos, y todo el control sería solo visual
(cliente). Esta unidad (2/3 del tren A) convierte la oposición en frontera de
integridad del servidor para las Sesiones de falladas y acota el recorrido
cliente a la oposición seleccionada, sin tocar progreso, respuestas, algoritmo
de dos aciertos, guard global, scoring ni sincronización.

## Comportamiento solicitado (hechos numerados)

1. La migración nueva `supabase/migrations/20261113091000_failed_opposition_boundary.sql`
   (forward-only, con operativa explicada en español, sin `drop`/`alter table`
   ni operaciones sobre filas existentes) crea la RPC
   `public.start_or_resume_failed_attempt_v2(p_opposition_id text,
   p_scope_exam_id text, p_sources jsonb)` que, **antes de crear el intento o
   sus fuentes**, verifica en servidor:
   - **Oposición homogénea y correspondencia administrativa**: cada fuente está
     mapeada en `public.opposition_exams` a la `p_opposition_id` solicitada; sin
     fila de mapeo explícita no se materializa nada (fallo cerrado); el ámbito
     `p_scope_exam_id`, si lo hay, pertenece a la misma oposición.
   - **Fuentes publicadas exactas**: cada tuplo
     `(exam_id, exam_version_id, exam_version_path, question_id)` existe en
     `public.official_exam_versions` con `is_published`.
   Conserva además las comprobaciones existentes: reanudación fijada, guard
   `reject_study_interaction_during_active_exam`, cola con preguntas aún
   pendientes, sin duplicados, límites de forma. Grants: `revoke all` a
   public/anon/authenticated y `grant execute` a `authenticated`.
2. La **reanudación precede a toda verificación**: si el usuario ya tiene su
   única sesión de falladas activa (índice único `attempts_one_active_failed_session`
   existente), la RPC la devuelve con sus fuentes y versiones fijadas aunque se
   solicite otra oposición o la cola venga vacía; no se crea ninguna sesión
   adicional y los intentos históricos no se reinterpretan ni se filtran por la
   selección actual.
3. La **firma antigua** `public.start_or_resume_failed_attempt(text, jsonb)`
   sigue operativa con su privilegio `authenticated` (compatibilidad con
   frontend antiguo; el despliegue de servidor precede a la UI), pero ya no
   permite crear una sesión mezclada: el servidor deriva la oposición única de
   la cola desde el mapeo administrativo y falla cerrado si falta el mapeo o la
   cola mezcla oposiciones; las colas homogéneas existentes siguen funcionando.
4. La migración no toca filas ni esquema de `attempts`,
   `attempt_question_sources`, `question_progress` ni `attempt_answers` (no
   update/delete/alter), no redefine el algoritmo de dos aciertos
   (`confirm_failed_answer`, `complete_failed_attempt`, `apply_principal_answer`),
   ni scoring, sincronización, guard, dashboard ni las RPC del registro oficial.
5. El frontend (`app/src/app.js`, solo el recorrido de falladas sobre el
   resultado aceptado de M01): `eligibleFailureSources(scopeExamId = null)`
   **sin ámbito** deriva el recuento («N Falladas pendientes») y la cola
   exclusivamente de la oposición seleccionada, proyectando el catálogo
   autorizado completo con `filterCatalogByOpposition(catalog, selectedOppositionId)`;
   **con ámbito** sigue funcionando igual («Solo falladas» de un examen).
   `startFailedStudy` llama a la RPC v2 con `p_opposition_id:
   selectedOppositionId`, `p_scope_exam_id` y `p_sources`. La recuperación tras
   error de red conserva la sesión fijada (`persistence.restore({ kind:
   "failed" })`, `confirmationRetryAvailable = true`): los reintentos no crean
   sesiones adicionales ni sustituyen la recuperación histórica por una sesión
   nueva de otra oposición.
6. Los fixtures de los tests PGlite existentes
   (`tests/failed-session-rpc.test.mjs`, `tests/official-flow-boundaries.test.mjs`,
   `tests/exam-rpc.test.mjs`, `tests/direct-answer-idempotency.test.mjs`,
   `tests/artificial-exam-rpc.test.mjs`) incorporan mapeos administrativos
   explícitos para sus exámenes de fixture, **sin debilitar sus aserciones**
   (idempotencia, auth, bloqueo por Modo examen, pin de reanudación quedan
   intactos). La verificación conductual nueva del contrato vive en
   `tests/multiopposition-failed.test.mjs` (segunda oposición solo en fixture
   aislada): dos fuentes Administrativo válidas pasan; una fuente RX manipulada
   se rechaza en servidor sin cambios en intentos, fuentes, progreso ni
   respuestas; la firma antigua rechaza la mezcla y conserva la compatibilidad
   homogénea; la reanudación devuelve la sesión fijada entre oposiciones; las
   fuentes no publicadas siguen rechazándose; los reintentos idénticos no crean
   sesiones extra.
7. No se implementa artificial por oposición, Dashboard ni media; los stubs de
   las especificaciones e2e consumidoras (`tests/e2e/failed-study.spec.js`,
   `tests/e2e/resilient-persistence.spec.js`) se adaptan a las rutas v2 ya
   existentes (registro v2 con oposición y RPC de inicio v2) sin cambiar sus
   aserciones de comportamiento.

## Fuera de alcance

- m03-artificial-oposicion: RPC artificial con verificación por oposición,
  bloqueo N<75, fuentes compuestas del artificial; aquí el artificial queda
  intacto (pool global).
- M04/M05: Historial/Dashboard por oposición, privacidad, comparativas,
  cohortes, rankings, media.
- ACL por oposición, signup público, campos nuevos en `catalog.json`, parser,
  paquetes versionados, `official-exam-registrations/`, flujos CI, y sembrar
  Radiodiagnóstico en la migración de producción (solo fixture de tests).
- Cambios retroactivos en migraciones históricas (solo forward-only).
- Cualquier cambio en `app/src/history.js`, `app/src/active-attempt-persistence.js`,
  `app/src/catalog.js` o el resto de módulos: sus contratos se conservan.

## Open questions

- **Verificación conductual dentro del oráculo.** El entorno de verificación de
  Metis ejecuta el oráculo y los witnesses sobre una copia limpia del checkout,
  sin `node_modules` ni motor PostgreSQL, por lo que el oráculo verifica el
  contrato SQL y el recorrido de frontend de forma estructural y ejecuta su
  prueba conductual con PostgreSQL embebido (PGlite) **solo si el entorno
  dispone de node_modules** (en ese caso, en BASE falla y con la solución pasa).
  La cobertura conductual completa corresponde a la suite general
  (`npm test`), que el escritor debe mantener en verde.
- La redacción exacta de los mensajes de error es libre mientras sea en español
  y falle cerrado; el oráculo solo exige que el rechazo mencione la oposición.
- Lectura amplia de «firma antigua»: podría exigir deprecarla o renombrarla;
  la lectura estrecha (elegida) la mantiene operativa y endurecida, porque el
  issue pide expresamente conservar su compatibilidad con fuentes homogéneas.
- Lectura amplia del punto 5: podría exigir una prueba e2e nueva de
  recuperación tras error de red; la lectura estrecha conserva el recorrido
  existente (estructura + stubs v2) y cubre la recuperación en
  `tests/multiopposition-failed.test.mjs` a nivel de sesión fijada.
- La reanudación de una sesión fijada de otra oposición navega a ella aunque la
  oposición seleccionada sea distinta (comportamiento ya existente con el
  catálogo completo de M01); no se añade UI de aviso propio.

## Trazabilidad

| Requisito | Verificación |
|---|---|
| 1. RPC v2 con frontera de oposición y fuentes publicadas antes de materializar | Oráculo estructural: «la migración nueva crea la RPC v2…» (mapeo `opposition_exams` = `p_opposition_id`, `official_exam_versions` + `is_published`, verificación antes de ambos inserts, guard y pendientes conservados, grants) |
| 2. Reanudación fijada precede a la verificación; único intento activo; histórico intacto | Oráculo estructural (reanudación antes del mapeo) y conductual (PGlite): «el servidor acepta fuentes homogéneas…» (misma sesión, cero sesiones nuevas, snapshot sin cambios) |
| 3. Firma antigua endurecida sin mezcla, compatible homogénea, grant conservado | Oráculo estructural: «la migración endurece la firma antigua…» + conductual (rechazo de mezcla por firma antigua; homogénea operativa) |
| 4. Sin cambios en progreso, respuestas, scoring, sync, guard ni registro | Oráculo estructural: «la migración es forward-only y no reinterpreta…» + witnesses del tren (`tests/exam-clock.test.mjs`, `tests/active-attempt-persistence.test.mjs`) y suite general `npm test` |
| 5. Todas mis falladas = oposición seleccionada; Solo falladas por examen; recuperación tras error de red | Oráculo estructural: «la ruta de falladas materializa la oposición seleccionada…» (cola y recuento por `selectedOppositionId`, ámbito por examen, restore fijado, reintentos) |
| 6. Fixtures con mapeos explícitos; verificación nueva dos-Admin-pasa / RX-rechazada | Suite general `npm test`: `tests/multiopposition-failed.test.mjs` y los cinco fixtures adaptados; conductual equivalente en el oráculo cuando hay node_modules |
| 7. Consumidores y e2e siguen funcionando sobre las rutas v2 | Witness `tests/artificial-exam.test.mjs`, `tests/catalog.test.mjs`, `tests/history.test.mjs` (npm test) y oracle de M01 (`metis/oracles/oposicion-oficial.test.mjs`) |

```metis-unit
{
  "schema": "metis.unit/v1",
  "unit": "m02-falladas-oposicion",
  "riskClass": "complex",
  "uiImpact": "none",
  "sizeClass": "M",
  "maxCorrections": 1,
  "allowedPaths": [
    "app/src/app.js",
    "supabase/migrations/20261113091000_failed_opposition_boundary.sql",
    "tests/multiopposition-failed.test.mjs",
    "tests/failed-session-rpc.test.mjs",
    "tests/official-flow-boundaries.test.mjs",
    "tests/exam-rpc.test.mjs",
    "tests/direct-answer-idempotency.test.mjs",
    "tests/artificial-exam-rpc.test.mjs",
    "tests/e2e/failed-study.spec.js",
    "tests/e2e/resilient-persistence.spec.js"
  ],
  "doNotTouch": [
    "metis/",
    "docs/metis/"
  ],
  "ports": [],
  "witness": [
    {
      "id": "oracle-falladas-oposicion",
      "cmd": ["node", "--test", "metis/oracles/falladas-oposicion.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": true
    }
  ]
}
```
