# Metis unit · sas-v2b-prep1 · m04-historial-dashboard

## Problema

Tras el Tren A (M01–M03), la aplicación ya tiene registro de oposiciones,
catálogo privado proyectado por oposición y fronteras de integridad en servidor
para falladas y artificial. El **Historial y el Dashboard siguen siendo
globales**: `loadPersonalHistory(client)` lee `personal_attempt_history` sin
ningún filtro de oposición, `showDashboard()` llama al legacy `get_dashboard`
que agrega TODO el histórico, y las comparativas asumen exactamente los tres
alias sin discriminar oposición ni rol. Con una segunda oposición publicada, un
usuario vería mezclados los intentos de ambas, el Dashboard sumaría métricas de
dos bancos y un admin/test no tendría resumen propio (el legacy le niega el
acceso con «El perfil no pertenece al Dashboard compartido»). Esta unidad
(1/2 del tren B) convierte la oposición en frontera de lectura en servidor para
el Historial y el Dashboard, acota las comparativas a participantes reales con
actividad en cada oposición, y conserva la revisión histórica fijada y el
Dashboard legacy de Administrativo intactos.

## Comportamiento solicitado (hechos numerados)

1. **Historial por oposición resuelto en servidor.** La lectura del Historial
   seleccionado contiene únicamente intentos de esa oposición. La oposición de
   cada intento la resuelve el SERVIDOR a partir del registro administrativo
   (`exam_id` mapeado en `opposition_exams` para intentos oficiales;
   `attempt_question_sources` para falladas y artificiales, solo cuando TODAS
   las fuentes resuelven a una misma oposición; un intento mezclado o sin
   mapeo no pertenece a ninguna oposición y ningún selector lo reclasifica).
   Cambiar el selector solo cambia el filtro de consulta: no reclasifica ni
   modifica intentos, fuentes, progreso ni respuestas. La migración nueva
   recrea `public.personal_attempt_history` conservando todas sus columnas, su
   `security_invoker = true` (RLS de `attempts` intacta), su endpoint y sus
   privilegios (`revoke all` + `grant select` a `authenticated`), y AÑADE al
   final la columna `opposition_id` resuelta en servidor mediante una función
   security definer que verifica autorización real (el intento debe pertenecer
   a `auth.uid()`; para intentos ajenos devuelve NULL sin revelar nada) y
   mantiene la prohibición de SELECT administrativo/directo.
2. **RPC v2 personal por oposición para cualquier cuenta legítima.**
   `public.get_opposition_dashboard_v2(p_opposition_id text)` (security
   definer, `search_path = ''`) devuelve el resumen personal del usuario
   autenticado en ESA oposición (incluidas cuentas admin/test, que hasta ahora
   no tenían Dashboard). Cada métrica, examen y pregunta del resultado
   pertenece exclusivamente a la oposición solicitada; falla cerrado si la
   oposición no está registrada o no hay sesión real. Grants: `revoke all` a
   public/anon/authenticated y `grant execute` a `authenticated`.
3. **Comparativas solo de participantes reales activos.** La sección
   comparativa de la RPC v2 agrega únicamente usuarios con rol `participant`
   en `public.app_access_roles` con actividad persistida (intentos) en ESA
   oposición; excluye admin/test y participantes sin actividad. «Falladas por
   todos» solo aparece cuando la pregunta está fallada por TODOS los
   participantes activos y hay al menos DOS: con grupo 0 o 1 no se expone
   nada, y ningún agregado permite inferir respuestas personales de un grupo
   unitario. El recuento mostrado usa el grupo real de la oposición, nunca un
   «3 de 3» fijo.
4. **Migración forward-only y compatibilidad legacy.** La migración nueva
   `supabase/migrations/20261118090000_opposition_history_dashboard.sql`
   (forward-only, operativa explicada en español, sin `drop`/`alter table` ni
   operaciones sobre filas) proporciona la lectura segura del Historial y la
   RPC v2, verifica autorización real, restringe EXECUTE y mantiene RLS y la
   prohibición de SELECT administrativo/directo sobre datos ajenos.
   `get_dashboard`, sus resultados legacy y los tres alias de
   `shared_profile_aliases` permanecen intactos (no se redefinen); tampoco se
   redefinen las RPC de estudio/examen/falladas/artificial ni el registro
   oficial.
5. **Revisión histórica fijada tras cambiar de oposición.** Abrir un intento
   histórico, incluso mediante enlace directo `#history=<id>` tras cambiar la
   oposición seleccionada, conserva identidad, paquete/versiones originarios y
   respuestas persistidas: la revisión solo LEE (`loadHistoryReplay` sobre el
   paquete fijado por `exam_version_path`), sin recalcular corrección ni
   escribir score, progreso, historial o cierre. El fallback del enlace
   directo recarga el Historial propio SIN filtro de oposición para
   encontrar el intento. Reanudar conserva fuentes fijadas (RPC v2 con
   `p_opposition_id` y recuperación `persistence.restore`) y el bloqueo global
   del Modo examen (`isActiveExam`) intactos.
6. **UI coherente por oposición.** Historial y Dashboard identifican
   visiblemente la oposición consultada (`Oposición consultada: <nombre>`
   público del servidor, nunca etiqueta local), muestran estados vacíos que
   mencionan la oposición consultada y errores coherentes (se conserva el
   aviso contextual `dashboardLoadStatus`), y permiten volver al catálogo
   (botones existentes). Ninguna vista presenta datos de una selección
   anterior durante cargas o cambios de navegación: guard de navegación
   (`routeSerial`) en Historial y Dashboard y descarte de respuestas
   obsoletas. A 390 px ninguna vista genera scroll horizontal de página: las
   tablas amplias del Dashboard (comparativa, rankings, preguntas) se
   desplazan dentro de su contenedor `.table-scroll` y la rejilla del
   contenido (`#dashboard-content`) nunca se dimensiona por el ancho mínimo
   de una tabla (`grid-template-columns: minmax(0, 1fr)`), todo ello sin
   tocar `styles.css`.
7. **Pruebas aisladas y receta visual.** Se añaden pruebas SQL/JS
   (`tests/multiopposition-history-dashboard.test.mjs`, PGlite y módulos,
   sin red) y pruebas de navegador exclusivamente aisladas
   (`tests/e2e/opposition-history-dashboard.spec.js` +
   `tests/playwright-tren-b.config.js`), sin credenciales ni llamadas a
   Supabase alojado: las pruebas de navegador interceptan la red con fixtures
   de dos oposiciones y comprueban también compatibilidad legacy (el endpoint
   `personal_attempt_history` y el aviso contextual del Dashboard se
   conservan) y ausencia de mutaciones (ninguna petición de escritura desde
   Historial/Dashboard). La receta visual revisa oposición visible, estados
   vacíos y navegación a 390 y 1280 px.
8. **Oráculo discriminante único M04.** Escenario integrado con dos
   oposiciones (solo de fixture la segunda), tres participantes designados
   (uno de ellos SIN actividad en la segunda oposición) y cuentas admin/test
   con actividad; combina intentos oficiales, falladas y artificiales;
   verifica aislamiento de todas las métricas, exámenes y preguntas entre
   oposiciones; umbrales de grupo 0/1/2 («Falladas por todos»); autorización
   negativa (oposición inexistente, sin sesión, RLS intacta, sin SELECT
   administrativo); revisión fijada tras cambiar selección; y resultado legacy
   de `get_dashboard` idéntico antes/después de la migración. Debe fallar en
   BASE y pasar en referencia 3/3.

## Fuera de alcance

- m05-casos-multimedia: imágenes/casos versionados en estudio, examen,
  falladas, artificial e historial; aquí ninguna pregunta muestra imágenes.
- Cohortes, rankings multioposición, medias nuevas o cualquier política de
  agregación no descrita arriba; ACL por oposición; signup público.
- `get_dashboard`, `shared_profile_aliases`, el registro oficial y las RPC de
  escritura (estudio, examen, falladas, artificial, sincronización): intactos.
- Sembrar Radiodiagnóstico (o cualquier segunda oposición) en producción: la
  segunda oposición vive SOLO en fixtures de test/receta.
- Cambios retroactivos en migraciones históricas (solo forward-only).
- `app/src/active-attempt-persistence.js`, `app/src/study-session.js`,
  `app/src/catalog.js`, `app/src/quiz-core.js`, `app/src/exam-clock.js` y el
  resto de módulos: contratos conservados.
- DoNotTouch del tren (`.github/`, `docs/workflow/`, `exam-inputs/`,
  `scripts/`, `package.json`, `package-lock.json`, `catalog.json`, paquetes y
  versiones Admin) sin cambios.

## Open questions

- **Verificación conductual dentro del oráculo.** El entorno de verificación
  de Metis ejecuta el oráculo sobre una copia limpia del checkout, sin
  `node_modules`, por lo que el oráculo verifica el contrato SQL y los
  recorridos de frontend de forma estructural y ejecuta su escenario
  conductual con PostgreSQL embebido (PGlite) **solo si el entorno dispone de
  node_modules** (en ese caso falla en BASE y pasa con la solución). La
  cobertura conductual completa corresponde a la suite general (`npm test`,
  con `tests/multiopposition-history-dashboard.test.mjs`).
- **Recreación de `personal_attempt_history`.** La lectura estrecha (elegida)
  recrea la vista EXISTENTE con `create or replace view` añadiendo la columna
  `opposition_id` al final, porque el consumidor histórico
  `tests/e2e/history.spec.js` (fuera de allowedPaths) intercepta exactamente
  el endpoint `personal_attempt_history` y debe seguir funcionando sin
  modificarlo. Una lectura amplia podría crear una vista v2 nueva y adaptar
  ese consumidor; se descarta para no tocar archivos fuera de allowedPaths.
- **Grupo unitario en la comparativa.** El umbral de dos se aplica a «Falladas
  por todos» (lectura estrecha del issue); la tabla de participantes puede
  mostrar los agregados del único participante activo de una oposición, nunca
  admin/test ni participantes sin actividad. El oráculo solo exige la
  exclusión de ajenos y el umbral 0/1/2 de «Falladas por todos», sin fijar si
  la tabla se oculta por completo con un único participante.
- **Nombre del alias sin alias asignado.** Un participante real sin fila en
  `shared_profile_aliases` (imposible con tres slots, previsto para futuras
  oposiciones) se muestra como «Participante»; el oráculo no fija esta
  etiqueta.
- La redacción exacta de mensajes y textos es libre mientras identifique la
  oposición consultada en español; el oráculo exige la mención, no la frase.
- Las pruebas E2E históricas con credenciales
  (`tests/e2e/dashboard.spec.js`, `tests/e2e/history.spec.js`) no se ejecutan
  contra Supabase alojado en la verificación del tren; solo deben seguir
  siendo compatibles por contrato (endpoint y aviso contextual conservados).

## Trazabilidad

| Requisito | Verificación |
|---|---|
| 1. Historial = oposición consultada, resuelta en servidor (exam_id / fuentes completas), sin reclasificar | Oráculo estructural: «la migración nueva proporciona la lectura segura de Historial…» (vista security_invoker con `opposition_id`, mapeo + fuentes, `having count`, autorización `auth.uid`, privilegios); conductual (PGlite): resolución por tipo de intento, intento mezclado sin oposición, filtros exactos; módulo: «el módulo de Historial filtra por oposición en servidor…» |
| 2. RPC v2 personal por oposición para cualquier cuenta legítima | Oráculo estructural: «la migración crea la RPC v2 del Dashboard por oposición…» (security definer, auth real, fallo cerrado, grants); conductual: resumen personal de admin/test y participant, aislamiento de métricas/exámenes/preguntas |
| 3. Comparativas solo de participantes reales activos; umbrales 0/1/2 | Oráculo estructural (rol `participant`, actividad por intentos, `>= 2`, agregación de progreso); conductual: perfiles exactos por oposición (P3 sin actividad fuera, admin/test fuera), `failed_by_all` con grupo 3/2/1/0 y preguntas falladas por subconjuntos fuera |
| 4. Migración forward-only, autorización real, EXECUTE restringido, RLS y legacy intactos | Oráculo estructural: «la migración es forward-only y conserva el Dashboard legacy…» (sin drop/alter/DML, sin redefinir `get_dashboard` ni motores, sin grants administrativos); conductual: `get_dashboard` idéntico antes/después, RLS y `permission denied` verificados con rol authenticated |
| 5. Revisión fijada por enlace directo tras cambiar selección, sin escrituras; reanudación fijada y bloqueo global | Oráculo estructural: «la ruta de Historial consulta la oposición seleccionada…» (fallback sin filtro, sin `rpc(`/escrituras en la revisión, `restore` fijado, `isActiveExam`); módulo: revisión con paquete/versiones originarias y respuestas sin mutar; conductual: snapshot estable entre lecturas |
| 6. Oposición visible, vacíos y errores coherentes, vuelta al catálogo, sin datos obsoletos, sin scroll horizontal a 390 px | Oráculo estructural: «la ruta de Dashboard usa la RPC v2…» y prueba de Historial (guard `routeSerial` en ambas vistas, etiquetas `history-opposition`/`dashboard-opposition`, vacío con oposición, `dashboardLoadStatus` conservado, botones de vuelta) + Receta visual: `historial-administrativo-1280` (C1), `dashboard-administrativo-1280` (C2), `historial-vacio-radiodiagnostico-1280` (C3), `dashboard-vacio-radiodiagnostico-1280` (C4), `historial-vacio-390` (C5) y la medición del kit de capturas (sin scroll horizontal de página a 390 px) |
| 7. Pruebas SQL/JS y navegador aisladas; compatibilidad legacy y sin mutaciones | Witness `multiopposition-history-dashboard` (regression-js) + spec de navegador con fixtures (`tests/e2e/opposition-history-dashboard.spec.js`, escrituras vigiladas) + receta visual sin credenciales |
| 8. Oráculo discriminante único M04 (falla en BASE, pasa 3/3) | Witness `oracle-m04-historial-dashboard` (`metis/oracles/opposition-history-dashboard.test.mjs`, `mustFailAtBase: true`) |

## Consumidores que siguen funcionando (sin modificarlos)

`app/src/app.js`, `tests/dashboard.test.mjs` (RPC legacy sin parámetros y
formato de métricas), `tests/dashboard-load-status.test.mjs` (aviso
contextual y su llamada), `tests/history.test.mjs` (vista, RLS, reproducción
fijada), `tests/access-roles.test.mjs` (alias, exclusión admin/test del
legacy), `tests/e2e/dashboard.spec.js` y `tests/e2e/history.spec.js`
(endpoint `personal_attempt_history` y RPC `get_dashboard` intactos).

```metis-unit
{
  "schema": "metis.unit/v1",
  "unit": "m04-historial-dashboard",
  "riskClass": "complex",
  "uiImpact": "quality",
  "sizeClass": "M",
  "maxCorrections": 1,
  "allowedPaths": [
    "supabase/migrations/20261118090000_opposition_history_dashboard.sql",
    "app/src/history.js",
    "app/src/dashboard.js",
    "app/src/app.js",
    "app/index.html",
    "tests/multiopposition-history-dashboard.test.mjs",
    "tests/e2e/opposition-history-dashboard.spec.js",
    "tests/playwright-tren-b.config.js"
  ],
  "doNotTouch": [
    "metis/",
    "docs/metis/"
  ],
  "ports": [4314],
  "witness": [
    {
      "id": "oracle-m04-historial-dashboard",
      "cmd": ["node", "--test", "metis/oracles/opposition-history-dashboard.test.mjs"],
      "timeoutSec": 240,
      "mustFailAtBase": true
    }
  ],
  "visualRecipe": "metis/visual-recipe-m04-historial-dashboard.mjs",
  "visual": {
    "cmd": ["node", "metis/visual-recipe-m04-historial-dashboard.mjs"],
    "timeoutSec": 480,
    "shots": [
      "historial-administrativo-1280",
      "historial-detalle-fijado-1280",
      "dashboard-administrativo-1280",
      "historial-vacio-radiodiagnostico-1280",
      "dashboard-vacio-radiodiagnostico-1280",
      "revision-enlace-directo-1280",
      "historial-vacio-390",
      "dashboard-390"
    ],
    "criteria": [
      "C1: En historial-administrativo-1280 se ve la vista de Historial con «Oposición consultada: Administrativo» visible y la lista de intentos de ESA oposición con sus métricas y el botón «Abrir en solo lectura»; toda la interfaz en español.",
      "C2: En dashboard-administrativo-1280 se ve «Oposición consultada: Administrativo», el resumen personal, la comparación entre participantes con alias de participantes reales y las secciones por examen/pregunta de esa oposición.",
      "C3: En historial-vacio-radiodiagnostico-1280, con la segunda oposición seleccionada, el Historial muestra «Oposición consultada: Radiodiagnóstico (fixture)» y un estado vacío en español que menciona la oposición consultada, sin ningún intento de la selección anterior.",
      "C4: En dashboard-vacio-radiodiagnostico-1280 el Dashboard de la segunda oposición muestra la oposición consultada y estados vacíos coherentes (sin exámenes oficiales publicados, sin comparativas ni «Falladas por todos»), sin datos de otra oposición.",
      "C5: En historial-vacio-390 y dashboard-390 los mismos estados permanecen legibles y navegables a 390 px, con la identificación de la oposición visible y los accesos de vuelta al catálogo, sin scroll horizontal de página (las tablas amplias del Dashboard se desplazan dentro de su contenedor, nunca la página).",
      "C6: En historial-detalle-fijado-1280 y revision-enlace-directo-1280 la revisión histórica muestra el paquete/versiones originarios («Versión histórica fijada: …»), las respuestas persistidas en solo lectura y conserva la navegación de vuelta, tras abrirse incluso por enlace directo con la otra oposición seleccionada."
    ]
  }
}
```
