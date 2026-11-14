# Metis unit · sas-v2a-prep2 · m03-artificial-oposicion

## Problema

Tras M01 y M02, la aplicación ya tiene registro de oposiciones, catálogo privado
proyectado por oposición y una frontera de integridad en servidor para las
Sesiones de falladas. El **Examen artificial sigue siendo global**: la ruta de
inicio materializa sus 75 fuentes con `materializeArtificialSources(catalog)`
sobre el catálogo autorizado completo (con todas las oposiciones) y la RPC de
inicio `start_or_resume_artificial_attempt(modo, fuentes)` acepta cualquier cola
de fuentes válidas sin comprobar a qué oposición pertenece cada una. Con una
segunda oposición publicada, el usuario generaría un artificial mezclando bancos
distintos y todo el control sería solo visual (cliente). Esta unidad (3/3 del
tren A) convierte la oposición en frontera de integridad del servidor para el
artificial y acota el pool del cliente a la oposición seleccionada, manteniendo
la reanudación, revisión, plazos, cierres, scoring, persistencia e idempotencia
intactos.

## Comportamiento solicitado (hechos numerados)

1. Migración nueva `supabase/migrations/20261113092000_artificial_opposition_boundary.sql`
   (forward-only, con operativa explicada en español, sin `drop`/`alter table`
   ni operaciones sobre filas existentes) crea la RPC
   `public.start_or_resume_artificial_attempt_v2(p_mode text, p_opposition_id
   text, p_sources jsonb)` que, **antes de crear el intento o sus fuentes**,
   verifica en servidor:
   - **Oposición homogénea y correspondencia administrativa**: cada fuente está
     mapeada en `public.opposition_exams` a la `p_opposition_id` solicitada;
     una fuente sin mapeo o de otra oposición impide materializar nada (fallo
     cerrado). La oposición solicitada debe existir en `public.oppositions`.
   - **Fuentes publicadas exactas**: cada tupla
     `(exam_id, exam_version_id, exam_version_path, source_question_id)` existe
     en `public.official_exam_versions` con `is_published`.
   - **Exactamente 75 referencias distintas**: la selección con menos de 75 se
     bloquea («exactamente 75 Preguntas activas distintas») y las duplicadas se
     rechazan («no puede repetir una referencia»); nunca se completa con otro
     banco ni se duplican preguntas.
   Conserva además las comprobaciones existentes: reanudación fijada, guard de
   Modo examen activo para el estudio, límites de forma. Grants: `revoke all` a
   public/anon/authenticated y `grant execute` a `authenticated`.
2. La **reanudación precede a toda verificación**: en estudio, si el usuario
   tiene su único intento artificial activo, la RPC lo devuelve con su
   composición persistida (fuentes, identidades de origen y versiones fijadas)
   aunque se solicite otra oposición o la selección llegue vacía o corta; en
   Modo examen, el único intento activo se reanuda igual y ningún intento se
   re-materializa con el pool actual. No se crean intentos adicionales y los
   intentos históricos no se reinterpretan. La identidad de pregunta de origen
   (`source_question_id`) se conserva al actualizar progreso (el progreso de
   `confirm_artificial_study_answer` anota el `exam_id` y la pregunta de origen
   del paquete, no la identidad sintética `artificial-qNNN`).
3. La **firma antigua** `public.start_or_resume_artificial_attempt(text, jsonb)`
   sigue operativa con su privilegio `authenticated` (compatibilidad con
   frontend antiguo; el despliegue de servidor precede a la UI), pero ya no
   permite materializar una mezcla: el servidor deriva la oposición única de la
   selección desde el mapeo administrativo y falla cerrado si falta el mapeo o
   la selección mezcla oposiciones; las selecciones homogéneas siguen
   funcionando.
4. La migración no toca filas ni esquema de `attempts`,
   `attempt_question_sources`, `question_progress` ni `attempt_answers` (no
   update/delete/alter), no redefine las RPC de respuesta artificial
   (`confirm_artificial_study_answer`, `complete_artificial_study_attempt`,
   `finish_artificial_exam_attempt`, `apply_artificial_question_progress`) ni el
   resto de motores (`confirm_normal_answer`, `complete_normal_attempt`,
   `finish_exam_attempt`, sincronización, guard, dashboard, registro oficial);
   los 120 minutos del Modo examen artificial, el deadline absoluto, los
   cierres, el scoring, la persistencia, `finalize=true` y el orden attempt-row
   antes del UUID advisory lock quedan intactos.
5. El frontend (`app/src/app.js`, solo el recorrido del artificial sobre el
   resultado aceptado de M02): el pool del Examen artificial deriva
   exclusivamente de la oposición seleccionada con
   `filterCatalogByOpposition(catalog, selectedOppositionId)`; `startArtificial`
   materializa `materializeArtificialSources` sobre ese pool proyectado (nunca
   sobre el catálogo completo) y llama a la RPC v2 con
   `p_opposition_id: selectedOppositionId`. Con menos de 75 Preguntas activas
   en la oposición seleccionada el inicio se bloquea con un mensaje claro en
   español que menciona el requisito de 75 Preguntas activas distintas (ambos
   botones deshabilitados salvo que exista un intento artificial activo que se
   pueda continuar), y cambiar de oposición en el catálogo reevalúa esa
   disponibilidad. La recuperación tras error de red conserva el intento
   persistido (`persistence.restore({ kind })`).
6. `app/src/artificial-exam.js` conserva su contrato público de módulo:
   `ARTIFICIAL_QUESTION_COUNT = 75` y `materializeArtificialSources(pool,
   random)` devuelve exactamente 75 referencias únicas del pool recibido (una
   proyección de una sola oposición) y lanza en español cuando el pool tiene
   menos de 75, sin selección parcial ni duplicados.
7. La reanudación y la revisión histórica del artificial usan la composición
   persistida (`attempt_question_sources` + versiones fijadas por
   `exam_version_path`, vía `loadCompositeQuestions` y `loadHistoryReplay`), no
   el pool de la oposición actualmente seleccionada; siguen funcionando aunque
   ese pool tenga menos de 75 preguntas o hayan cambiado las versiones
   publicadas.
8. La verificación conductual nueva del contrato vive en
   `tests/multiopposition-artificial.test.mjs` (segunda oposición solo en
   fixture aislada): 75 fuentes de una oposición pasan en estudio y en examen
   (120 minutos, deadline absoluto); N=74 se bloquea; una fuente mezclada y una
   fuente con versión no publicada se rechazan en servidor sin intentos,
   fuentes, progreso ni respuestas parciales; la firma antigua rechaza mezclas
   y conservan la compatibilidad homogénea; la reanudación devuelve la
   composición fijada entre oposiciones. Los fixtures de los tests existentes
   ya mapean sus exámenes a `administrativo` (frontera de M02);
   `tests/third-exam-registry.test.mjs` incorpora esa misma línea de mapeo en
   su fixture (único cambio: está en `allowedPaths` porque su registro de
   fixture quedaba fuera de todo mapeo administrativo y la firma antigua
   endurecida exige el mapeo; sus aserciones de conservación no se debilitan).
   Los stubs de `tests/e2e/artificial-exam.spec.js` se adaptan a la RPC v2 y al
   registro v2 con oposición, sin debilitar sus aserciones de comportamiento.

## Fuera de alcance

- M04: Historial/Dashboard por oposición, privacidad, comparativas, cohortes,
  rankings multioposición y cualquier política nueva de agregación o media.
- M05: soporte de imágenes, QA de visor, y la preparación/publicación del
  primer RX real (se hará contra el resultado aprobado del tren A, fuera de
  estas unidades).
- ACL por oposición, signup público, campos nuevos en `catalog.json`, parser,
  paquetes versionados, `official-exam-registrations/`, flujos CI, y sembrar
  Radiodiagnóstico en la migración de producción (solo fixture de tests).
- Cambios retroactivos en migraciones históricas (solo forward-only).
- Cualquier cambio en `app/src/history.js`, `app/src/active-attempt-persistence.js`,
  `app/src/study-session.js` o `app/src/catalog.js`: sus contratos se conservan.
- Reescrituras de los motores de estudio/examen, plazos, locking y `finalize=true`.

## Open questions

- **Verificación conductual dentro del oráculo.** El entorno de verificación de
  Metis ejecuta el oráculo y los witnesses sobre una copia limpia del checkout,
  sin `node_modules` ni motor PostgreSQL, por lo que el oráculo verifica el
  contrato SQL y el recorrido de frontend de forma estructural y ejecuta su
  prueba conductual con PostgreSQL embebido (PGlite) **solo si el entorno
  dispone de node_modules**. La cobertura conductual completa corresponde a la
  suite general (`npm test`, con `tests/multiopposition-artificial.test.mjs`).
- La redacción exacta de los mensajes de error es libre mientras sea en español
  y falle cerrado; el oráculo exige que el bloqueo por pool corto mencione las
  75 Preguntas activas distintas y la oposición seleccionada, y que el
  rechazo de mezcla del servidor mencione la oposición.
- Lectura estrecha de «coincidan exactamente con versiones, rutas y preguntas
  activas de paquetes publicados»: el registro oficial
  (`official_exam_versions` con `is_published`) es la fuente de verdad del
  servidor para el tuplo y la pertenencia de la pregunta (como ya hace la RPC
  actual); revalidar la «actividad» reconstruyendo el paquete JSON en servidor
  sería una política nueva y se difiere.
- Lectura amplia de «firma antigua»: podría exigir deprecarla o renombrarla;
  la lectura estrecha (elegida) la mantiene operativa y endurecida porque el
  issue pide expresamente conservar su funcionamiento con fuentes homogéneas.
- Con pool corto, los botones del artificial quedan deshabilitados salvo que
  exista un intento artificial activo que se pueda continuar (reanudación
  accesible desde la UI); la reanudación también sigue accesible por ruta
  hash/persistencia. El oráculo no fija esta decisión de UI más allá del
  bloqueo con mensaje claro.
- La reanudación de un intento artificial fijado de otra oposición navega a él
  aunque la oposición actualmente seleccionada sea distinta (comportamiento ya
  existente con la reanudación precedida a verificación); no se añade UI de
  aviso propio.

## Trazabilidad

| Requisito | Verificación |
|---|---|
| 1. RPC v2 con frontera de oposición, fuentes publicadas exactas, 75 únicas, antes de materializar | Oráculo estructural: «la migración nueva crea la RPC v2…» (mapeo `opposition_exams` = `p_opposition_id`, `official_exam_versions` + `is_published` + pregunta del paquete, exactamente 75, sin duplicados, orden verificación < inserts, grants) |
| 2. Reanudación precede a la verificación; composición persistida; identidad de origen en progreso | Oráculo estructural (reanudación antes del registro/mapeo) y conductual (PGlite): «el servidor aplica la frontera…» (mismo intento con otra oposición y cola vacía, cero intentos nuevos, snapshot sin cambios, progreso anotado con `source_question_id`); Modo examen en «el Modo examen artificial conserva 120 minutos…» |
| 3. Firma antigua endurecida sin mezcla, compatible homogénea, grant conservado | Oráculo estructural: «la migración endurece la firma antigua…» + conductual (rechazo de mezcla y sin mapeo por firma antigua; homogénea reanuda) |
| 4. Forward-only; motores, plazos, scoring, locking e identidad intactos | Oráculo estructural: «la migración es forward-only y conserva motores…» + witnesses del tren (`tests/direct-answer-idempotency.test.mjs`, `tests/third-exam-registry.test.mjs`, `tests/artificial-exam-rpc.test.mjs`) y suite general `npm test` |
| 5. Pool del artificial = oposición seleccionada; bloqueo con <75 y mensaje claro; reevaluación al cambiar de oposición | Oráculo estructural: «la ruta del artificial genera el pool de la oposición seleccionada…» + conductual de módulo: «el materializador…» + criterio visual C2 (estado bloqueado con 74) |
| 6. Materializador: 75 únicas del pool proyectado, sin duplicados, bloqueo en español | Oráculo: «el materializador devuelto como módulo…» + witness `tests/artificial-exam.test.mjs` |
| 7. Reanudación y revisión con composición persistida y versiones fijadas | Oráculo: «la revisión del artificial usa la composición persistida…» (+ recuperación `restore({ kind })` en la prueba estructural de la ruta); consumers `app/src/history.js`, `app/src/active-attempt-persistence.js`, `app/src/study-session.js` intactos |
| 8. Contrato conductual nuevo y e2e alineados | Suite general `npm test`: `tests/multiopposition-artificial.test.mjs` + fixtures adaptados (`tests/third-exam-registry.test.mjs`); stubs v2 en `tests/e2e/artificial-exam.spec.js` (requiere credenciales E2E, fuera del entorno de witnesses) |
| UI: catálogo con artificial disponible (Administrativo) y estudio con 75 orígenes | Receta visual: `catalogo-artificial-administrativo` (C1), `artificial-estudio-75-preguntas` (C3) |

```metis-unit
{
  "schema": "metis.unit/v1",
  "unit": "m03-artificial-oposicion",
  "riskClass": "complex",
  "uiImpact": "quality",
  "sizeClass": "M",
  "maxCorrections": 1,
  "allowedPaths": [
    "app/src/artificial-exam.js",
    "app/src/app.js",
    "supabase/migrations/20261113092000_artificial_opposition_boundary.sql",
    "tests/multiopposition-artificial.test.mjs",
    "tests/artificial-exam.test.mjs",
    "tests/artificial-exam-rpc.test.mjs",
    "tests/direct-answer-idempotency.test.mjs",
    "tests/third-exam-registry.test.mjs",
    "tests/e2e/artificial-exam.spec.js"
  ],
  "doNotTouch": [
    "metis/",
    "docs/metis/"
  ],
  "ports": [4312],
  "witness": [
    {
      "id": "oracle-artificial-oposicion",
      "cmd": ["node", "--test", "metis/oracles/artificial-oposicion.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": true
    }
  ],
  "visualRecipe": "metis/visual-recipe-m03-artificial-oposicion.mjs",
  "visual": {
    "cmd": ["node", "metis/visual-recipe-m03-artificial-oposicion.mjs"],
    "timeoutSec": 480,
    "shots": [
      "catalogo-artificial-administrativo",
      "catalogo-artificial-bloqueado-radiodiagnostico",
      "artificial-estudio-75-preguntas"
    ],
    "criteria": [
      "C1: En catalogo-artificial-administrativo se ve la vista privada de catálogo con la oposición «Administrativo» seleccionada y la sección «Examen artificial» disponible: botones «Generar en Modo estudio» y «Generar en Modo examen» activos y sin mensaje de error del artificial; toda la interfaz en español.",
      "C2: En catalogo-artificial-bloqueado-radiodiagnostico, tras cambiar la oposición a una con solo 74 preguntas activas, la sección «Examen artificial» aparece bloqueada con un mensaje claro en español que menciona las «75 Preguntas activas distintas» de la oposición seleccionada y que no se completa con otro banco ni se duplican preguntas; solo se muestran exámenes de esa oposición.",
      "C3: En artificial-estudio-75-preguntas se ve la vista de estudio del Examen artificial con el progreso «1 de 75», el enunciado con sus opciones y las acciones del motor de estudio existente, generado solo con fuentes de la oposición solicitada."
    ]
  }
}
```
