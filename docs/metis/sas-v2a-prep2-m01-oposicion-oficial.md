# Metis unit · sas-v2a-prep2 · m01-oposicion-oficial

## Problema

La aplicación SAS v2 publica hoy 12 exámenes oficiales de Administrativo y el
motor de estudio/examen (RPC oficiales, persistencia, scoring, reloj, guard
global) funciona. No existe, sin embargo, ninguna noción de **oposición** ni en
el servidor ni en la UI: cualquier nueva oposición (p. ej. Radiodiagnóstico) no
tiene dónde registrarse, el frontend no puede saber a qué oposición pertenece un
examen autorizado y el catálogo privado mezcla en una sola lista todos los
exámenes. Esta unidad (1/3 del tren A) añade el registro de oposiciones con
nombre público, un mapeo administrativo explícito por `exam_id`, una RPC v2
autenticada de metadata publicada y la selección/cambio de oposición en el
catálogo tras login, reutilizando el motor existente sin reescritura.

## Comportamiento solicitado (hechos numerados)

1. La migración nueva `supabase/migrations/20261113090000_opposition_registry.sql`
   (forward-only, con explicaciones operativas en español) crea las tablas
   `public.oppositions (id text primary key, public_name text not null unique)` y
   `public.opposition_exams (exam_id text primary key, opposition_id text not null
   references public.oppositions(id))`. Ambas son propiedad administrativa: RLS
   activada, sin privilegios directos de lectura para `anon` ni `authenticated`;
   el acceso es únicamente vía RPC.
2. La migración siembra **exactamente una** oposición (`id` `administrativo`,
   `public_name` `Administrativo`) y el mapeo explícito de **exactamente los 12**
   `exam_id` existentes del catálogo estático `catalog.json`, todos hacia
   `administrativo`. No añade ni elimina filas en `official_exam_versions`, no
   modifica paquetes, hashes ni registros oficiales inmutables, y la oposición
   **nunca** se infiere por prefijo del `exam_id`: un examen publicado sin fila
   de mapeo explícita no se expone.
3. La migración crea la RPC v2 `public.get_published_official_exam_versions_v2()`
   (SQL estable, `security definer`, `search_path = ''`) que devuelve, por cada
   examen publicado **con mapeo explícito**, exactamente las columnas
   `exam_id, exam_version_id, exam_version_path, opposition_id, opposition_name`.
   No expone `answer_key` ni ningún otro campo. `execute` concedida a
   `authenticated` y revocada para `public`/`anon`.
4. La RPC v1 `public.get_published_official_exam_versions()` se conserva operativa
   tras la migración, con sus tres columnas y su privilegio `authenticated`
   intactos (compatibilidad con frontend antiguo; despliegue servidor antes que UI).
5. El frontend llama a la RPC v2 y **solo** a la v2 para autorizar el catálogo:
   `loadPublishedCatalog(fetch, bankBaseUrl, authorizedVersions)` incorpora a cada
   entrada del catálogo `oppositionId` y `oppositionName` tomados **exclusivamente**
   de la fila del registro cuyo tuplo `(exam_id, exam_version_id, exam_version_path)`
   coincide exactamente con la entrada del catálogo estático. Una fila sin
   `opposition_id`/`opposition_name`, con identidad alterada o ausente excluye la
   entrada (fallo cerrado); un error de autorización del registro falla la carga,
   **sin fallback al catálogo estático libre**.
6. `app/src/catalog.js` exporta además:
   `listPublishedOppositions(catalog)` → lista `[{ id, name }]` de las oposiciones
   que tienen al menos un examen publicado (nombres públicos del servidor, nunca
   del frontend) y `filterCatalogByOpposition(catalog, oppositionId)` → las
   entradas de esa oposición. Ninguna función muta el catálogo recibido.
7. El catálogo autorizado cargado en memoria permanece **completo** (todas las
   oposiciones autorizadas con su `oppositionId`): la proyección por oposición es
   solo la cuadrícula visible. Los consumidores históricos conservan su contrato
   sin cambios: `history.js`, `dashboard.js`, `active-attempt-persistence.js`,
   `exam-clock.js`, falladas de un examen, artificial global y las rutas de
   reanudación por hash con paquete histórico exacto.
8. Tras login, la vista de catálogo incorpora un control de selección accesible
   con etiqueta exacta **«Oposición»**, con una opción por oposición publicada
   etiquetada con su nombre público. La cuadrícula de exámenes muestra **solo**
   los exámenes de la oposición elegida y cambiar la selección en el catálogo
   re-renderiza la proyección (elegir y cambiar entre oposiciones con exámenes
   publicados).
9. La preferencia de oposición puede recordarse localmente (localStorage), pero
   **no constituye ACL ni fuente de verdad del servidor**: si la oposición
   preferida deja de estar publicada, se selecciona la primera publicada; el
   contenido visible siempre procede de los datos del servidor.
10. El guard global y el reloj se conservan: un Modo examen activo sigue
    bloqueando el estudio incompatible con independencia de la oposición
    seleccionada, y un reloj activo sin offset fiable permanece bloqueado. La
    reanudación de un intento con su identidad exacta sigue funcionando al
    cambiar de oposición y volver.
11. `app/public/data/exams/catalog.json` queda intacto (esquema 1.0, sin ningún
    campo de oposición); no se toca `scripts/parse_sas_exam.py` ni los registros
    oficiales; no se siembra ninguna segunda oposición en producción.
12. Los fixtures consumidores del contrato de catálogo se adaptan añadiendo
    `opposition_id`/`opposition_name` a las filas del registro simulado, **sin
    debilitar sus aserciones** (`tests/catalog.test.mjs`,
    `tests/artificial-exam.test.mjs`, `tests/history.test.mjs`), y el nuevo
    contrato de catálogo multioposición se prueba en
    `tests/multiopposition-catalog.test.mjs` (dos oposiciones solo en fixture,
    tuplo alterado falla cerrado, proyección sin mutar el catálogo completo).

## Fuera de alcance

- m02-falladas-oposicion: «Todas mis falladas» por oposición y RPC de inicio con
  fuentes homogéneas; aquí «Todas mis falladas» y «Solo falladas» conservan su
  alcance global actual.
- m03-artificial-oposicion: artificial por oposición; aquí el artificial conserva
  su pool global del banco publicado.
- M04/M05: Historial/Dashboard por oposición, privacidad, comparativas,
  cohortes, rankings, media.
- ACL por oposición, signup público, lógica de fuentes compuestas, cambios en
  `catalog.json`, parser, paquetes versionados, `official-exam-registrations/`,
  flujos CI, o sembrar Radiodiagnóstico en la migración de producción.
- Cambios retroactivos en migraciones históricas (solo forward-only).

## Open questions

- **Verificación del contrato SQL de forma estructural.** El entorno de
  verificación de Metis ejecuta el oráculo y los witnesses sobre una copia limpia
  del checkout, sin `node_modules` ni motor PostgreSQL, por lo que el contrato de
  la migración (hechos 1–4) se comprueba de forma estructural sobre el archivo
  `20261113090000_opposition_registry.sql` (tablas, siembra exacta de los 12
  mapeos, columnas y grants de la RPC v2, conservación de la v1, ausencia de
  operaciones sobre los registros oficiales). La verificación conductual en
  PostgreSQL (RPC v2/v1, fail-closed en runtime) queda cubierta por la suite
  general del repositorio con PGlite (`npm test`), que el escritor debe mantener
  en verde; si la persona que aprueba exige ejecución SQL conductual dentro del
  oráculo, hace falta que el entorno de verificación instale dependencias.
- La redacción exacta de los textos de UI (hint del selector, encabezados) es
  libre siempre que el control sea accesible con la etiqueta exacta
  «Oposición» y las opciones usen el nombre público del servidor; toda la UI en
  español.
- La lectura amplia de «errores de autorización fallan cerrado» podría exigir
  además reintentos con backoff o mensajes dedicados; esta unidad solo exige que
  la carga falle mostrando el error, sin fallback estático (comportamiento ya
  existente, conservado).
- La lectura amplia del punto 9 podría exigir purgar la preferencia local al
  cerrar sesión; esta unidad solo exige que la preferencia no autorice nada y se
  invalide si la oposición ya no está publicada.

## Trazabilidad

| Requisito | Verificación |
|---|---|
| 1. Tablas de oposición propiedad administrativa | Oráculo (estructural): «la migración nueva crea el registro…» (+ revoke de tablas en «la migración crea la RPC v2…») |
| 2. Siembra exacta de 12 mapeos explícitos, sin prefijos, sin tocar registros oficiales | Oráculo (estructural): «la migración siembra exactamente los 12…» (mapeo literal contra `catalog.json`, sin insert/update/delete sobre `official_exam_versions`) |
| 3. RPC v2 metadata publicada, columnas exactas, sin answer_key, grants | Oráculo (estructural): «la migración crea la RPC v2…» (5 columnas metadata, cuerpo con registro publicado + oposición + `is_published`, revoke/grant a authenticated) |
| 4. RPC v1 operativa | Oráculo (estructural): «la migración crea la RPC v2…» (sin revoke/drop de la v1); conductual: suite general del repositorio (`tests/third-exam-registry.test.mjs`) |
| 5. opposition_id solo por tuplo exacto, fallo cerrado sin fallback estático | Oráculo: «el frontend incorpora opposition_id…» |
| 6. Export `listPublishedOppositions` / `filterCatalogByOpposition` | Oráculo: «el selector deriva las oposiciones…» |
| 7. Catálogo completo separado de la proyección; consumidores intactos | Oráculo: «el selector deriva…» y «los consumidores históricos conservan su contrato…» + witnesses `tests/catalog.test.mjs`, `tests/artificial-exam.test.mjs`, `tests/active-attempt-persistence.test.mjs` |
| 8. Selector accesible «Oposición» y proyección por oposición en UI | Receta visual: `catalogo-administrativo` (C1), `catalogo-radiodiagnostico` (C2), `examen-seleccionado-radiodiagnostico` (C3) |
| 9. Preferencia local sin valor de ACL | Oráculo: proyección siempre derivada del catálogo del servidor (misma prueba del selector); criterio C2 |
| 10. Guard y reloj conservados; reanudación intacta | Oráculo: «los consumidores históricos conservan su contrato…» + witness `tests/exam-clock.test.mjs`, `tests/active-attempt-persistence.test.mjs` |
| 11. `catalog.json` intacto (esquema 1.0, sin oposición) | Oráculo: `readStaticCatalog` en todas las pruebas de frontend |
| 12. Fixtures adaptados sin debilitar aserciones; nuevo contrato en `tests/multiopposition-catalog.test.mjs` | Witnesses `tests/catalog.test.mjs`, `tests/artificial-exam.test.mjs` (ejecutan las aserciones originales adaptadas); `tests/history.test.mjs` y `tests/multiopposition-catalog.test.mjs` se ejecutan en `npm test` (requieren PGlite, fuera del entorno de witnesses) |

```metis-unit
{
  "schema": "metis.unit/v1",
  "unit": "m01-oposicion-oficial",
  "riskClass": "complex",
  "uiImpact": "quality",
  "sizeClass": "M",
  "maxCorrections": 1,
  "allowedPaths": [
    "app/src/catalog.js",
    "app/src/app.js",
    "app/index.html",
    "supabase/migrations/20261113090000_opposition_registry.sql",
    "tests/catalog.test.mjs",
    "tests/artificial-exam.test.mjs",
    "tests/history.test.mjs",
    "tests/multiopposition-catalog.test.mjs",
    "tests/e2e/"
  ],
  "doNotTouch": [
    "metis/",
    "docs/metis/"
  ],
  "ports": [4310],
  "witness": [
    {
      "id": "oracle-oposicion-oficial",
      "cmd": ["node", "--test", "metis/oracles/oposicion-oficial.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": true
    },
    {
      "id": "witness-catalog",
      "cmd": ["node", "--test", "tests/catalog.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": false
    },
    {
      "id": "witness-artificial-exam",
      "cmd": ["node", "--test", "tests/artificial-exam.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": false
    },
    {
      "id": "witness-exam-clock",
      "cmd": ["node", "--test", "tests/exam-clock.test.mjs"],
      "timeoutSec": 60,
      "mustFailAtBase": false
    },
    {
      "id": "witness-active-attempt-persistence",
      "cmd": ["node", "--test", "tests/active-attempt-persistence.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": false
    }
  ],
  "visualRecipe": "metis/visual-recipe-m01-oposicion-oficial.mjs",
  "visual": {
    "cmd": ["node", "metis/visual-recipe-m01-oposicion-oficial.mjs"],
    "timeoutSec": 480,
    "shots": [
      "catalogo-administrativo",
      "catalogo-radiodiagnostico",
      "examen-seleccionado-radiodiagnostico"
    ],
    "criteria": [
      "C1: En catalogo-administrativo se ve la vista privada de catálogo tras login con el control etiquetado «Oposición» mostrando «Administrativo» y, en la cuadrícula, solo tarjetas de exámenes de Administrativo con su botón «Elegir examen»; ninguna tarjeta de otra oposición.",
      "C2: En catalogo-radiodiagnostico, tras cambiar la oposición desde el catálogo, el control muestra «Radiodiagnóstico» y la cuadrícula contiene únicamente los exámenes publicados de esa oposición; ninguna tarjeta de Administrativo.",
      "C3: En examen-seleccionado-radiodiagnostico se ve la vista del examen elegido de la oposición seleccionada con sus datos oficiales y sus acciones existentes (estudio normal, estudio aleatorio, Modo examen), con toda la interfaz en español."
    ]
  }
}
```
