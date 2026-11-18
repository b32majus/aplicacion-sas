# Metis unit · sas-v2b-prep1 · m05-casos-multimedia

## Problema

Tras M04, el banco solo consume texto: el paquete canónico (`schemas/exam.schema.json`,
`additionalProperties: false`) no tiene sitio para imágenes, así que los bloques RX
2021/2023/2025 (con imágenes clínicas) no pueden publicarse y las preguntas de caso
no pueden compartir imágenes. Esta unidad (2/2 del tren B) añade, en un **esquema
de extensión separado**, la declaración opcional de `caseId` y referencias exactas a
imágenes compartidas y ordenadas; incorpora la **validación e integridad** de esos
assets en la carga (existencia, SHA-256, MIME y dimensiones reales, rutas seguras,
referencias exactas), y **presenta** las imágenes en todos los recorridos (estudio
normal/aleatorio, examen cronometrado, falladas, artificial, arranque y reanudación,
y revisión histórica) resolviéndolas SIEMPRE contra el paquete/versión de origen
fijado, nunca contra otro examen ni el catálogo actual. La incorporación es
adiacentemente segura: sin imágenes el comportamiento es idéntico, y ningún fallo de
asset puede dejar una pregunta «aparentemente completa» sin su imagen.

## Comportamiento solicitado (hechos numerados)

1. **Extensión declarativa en esquema separado.** Los paquetes NUEVOS pueden
   declarar opcionalmente, junto al formato canónico histórico SIN tocarlo
   (`schemas/exam.schema.json` se queda exactamente igual): un bloque `media` con
   `assets` (cada uno con `id`, `path` interno relativo e inmutable, `mime`,
   `width`, `height`, `sha256`, `source` (origen trazable) y `version`) y `cases`
   (agrupación de caso); y por pregunta `caseId` + referencias exactas y ORDENADAS
   (`media: [{asset, alt}]`). El contrato vive en `schemas/exam-media.schema.json`
   (documento de la extensión; no modifica el canónico) y en el módulo
   `app/src/exam-media.js`, que exporta `validatePackageMedia(pkg)`
   (estructura: rutas seguras, MIME permitido image/png|jpeg|gif, dimensiones
   enteras positivas, SHA-256 de 64 hex, origen y versión presentes, referencias de
   asset/caso existentes, `alt` presente y sin spoilers), `verifyPackageMedia(pkg,
   fetchImpl, bankBaseUrl)` (integridad real: cada asset se descarga, existe,
   su SHA-256 coincide, sus magic bytes corresponden al MIME declarado y sus
   dimensiones reales coinciden) y `resolveQuestionMedia(question, pkg,
   bankBaseUrl)` (lista ordenada `[{assetId,url,alt,width,height}]` o `null`).
   Todo es no-op para paquetes sin media.
2. **La carga valida e integra con error explícito.** `loadPublishedCatalog`
   (app/src/catalog.js) valida y verifica la media de cada paquete que la declara:
   rutas con `..`, absolutas, protocolo-relativas o URL remotas se rechazan; un
   asset ausente, corrupto (hash distinto), con MIME o dimensiones que no
   coinciden, o una referencia de asset/caso inexistente produce un ERROR EXPLÍCITO
   que rechaza la carga del catálogo (visible en el estado del catálogo), nunca un
   examen aparentemente completo sin su imagen. Un paquete válido entrega sus
   preguntas activas con `question.media` resuelta en orden contra SU versión. Los
   paquetes sin imágenes cargan exactamente igual que hoy (los doce Admin intactos).
3. **Presentación en todos los recorridos y reanudación.** Las imágenes aparecen
   legibles, en orden y con su `alt`, en estudio normal y aleatorio, examen
   cronometrado, falladas y artificial, tanto al iniciar como al reanudar: todas
   esas vistas comparten el render de pregunta (`renderStudy`), que muestra
   `question.media`. Las preguntas compuestas (falladas/artificial) conservan el
   contexto de assets del paquete/versión de ORIGEN de cada pregunta: la resolución
   es por paquete consumido, nunca contra otro examen ni el catálogo actual.
4. **Revisión histórica fijada también para imágenes.** `loadHistoryReplay`
   (app/src/history.js) valida, verifica y resuelve la media de cada paquete fijado
   (`loadPinnedExam`), de modo que la revisión presenta las MISMAS imágenes, en el
   MISMO orden y el MISMO caso de la versión fijada aunque cambie el catálogo o la
   oposición seleccionada; una referencia que no se resuelve en la versión fijada
   es error explícito. Las respuestas históricas y la corrección persistida quedan
   intactas y la revisión sigue sin escribir nada (solo lee `attempt_answers`,
   como en M04; los paquetes sin media no añaden ninguna petición).
5. **Ampliación accesible y presentación sin desbordes.** Cada imagen es ampliable
   por toque Y teclado (la miniatura es un botón que abre un diálogo modal con
   `showModal`), con cierre accesible (botón de cierre y Esc nativo) y recuperación
   del foco en el botón que abrió al cerrar; a 390 y 1280 px no hay desbordamiento
   horizontal de página (las imágenes nunca superan el ancho de su contenedor). El
   `alt` es descriptivo, no diagnóstico y NO revela la solución: la validación
   rechaza `alt` vacío o con marcas de solución («respuesta», «correcta»,
   «solución»).
6. **Cero efectos colaterales.** La multimedia no modifica score, respuestas,
   temporización, progreso, cierre ni bloqueo global (`isActiveExam` intacto);
   exámenes sin imágenes y los doce Admin conservan su comportamiento; no se añaden
   registros RX, paquetes reales, SQL de publicación ni automatización de
   extracción/publicación; `scripts/parse_sas_exam.py`, el workflow de publicación
   y `app/public/data/exams/catalog.json` siguen usando el esquema histórico sin
   cambios.
7. **Pruebas de contrato aisladas y receta visual.** `tests/exam-media.test.mjs`
   (HTML/JS, sin red: `fetchImpl` de fixture con PNG sintéticos) y
   `tests/e2e/exam-media.spec.js` (Playwright, interceptación de red con PNG
   sintéticos servidos en entorno aislado, sin credenciales ni Supabase alojado,
   registrando `tests/playwright-tren-b.config.js`) usan exclusivamente contenido
   sintético: ninguna fuente RX privada se lee ni se publica. La receta visual
   recorre imagen compartida del caso, varias imágenes ordenadas, ampliación y
   error explícito, en escritorio y móvil.
8. **Oráculo discriminante único M05.** `metis/oracles/exam-media.test.mjs`: una
   fixture sintética con dos preguntas del MISMO caso y varias imágenes versionadas
   (v1 fijada históricamente, v2 actual en el catálogo) recorre la validación, la
   verificación de integridad (ausente/corrupto/MIME/dimensiones), las referencias
   erróneas, las rutas inseguras, la carga del catálogo, los recorridos
   (render compartido de los cinco modos, reanudación por `restore`), la revisión
   histórica con la versión ACTUAL cambiada (fijación) y el estado persistido
   inalterado; comprueba ampliación accesible y `alt` sin pistas. Falla en BASE y
   pasa 3/3 sobre el resultado aceptado de M04.

## Fuera de alcance

- Autoría/publicación real RX: sin registros RX, sin paquetes reales, sin SQL de
  publicación, sin extracción de PDF ni automatización; el esquema histórico y los
  12 Admin no se editan (`app/public/data/exams/catalog.json` DoNotTouch).
- `schemas/exam.schema.json`: NO se modifica (la extensión vive en su esquema
  aparte); DIA de autoría decidirá cómo compone ambos documentos.
- Módulos fuera de allowedPaths: `app/src/study-session.js`,
  `app/src/quiz-core.js`, `app/src/active-attempt-persistence.js`,
  `app/src/artificial-exam.js`, `app/src/exam-clock.js`, `app/index.html`,
  `app/src/dashboard.js` — contratos intactos (el contenedor de media se crea
  desde `app.js`, sin tocar el HTML).
- Zoom por gesto pinch, galerías entre preguntas, pre-carga de imágenes: no
  requeridos.
- Publicar imágenes reales de la fuente RX: solo contenido sintético o
  expresamente autorizado.

## Open questions

- **Re-verificación de bytes en la revisión histórica.** Lectura estrecha elegida:
  `loadHistoryReplay` también verifica los assets de los paquetes con media (misma
  política de «nunca una pregunta aparentemente completa sin su imagen»), mientras
  que los paquetes sin media no realizan ninguna petición adicional (los
  consumidores M04 no cambian). Una lectura amplia podría limitar la re-verificación
  a la carga del catálogo.
- **Media de la sesión viva de falladas/artificial.** La cola y el pool se derivan
  de la proyección del catálogo (versiones actuales por examen), así que la sesión
  viva muestra la media de la versión con la que se creó el intento; la revisión
  histórica siempre re-resuelve contra los paquetes fijados de `attempt_question_sources`.
- **`alt` no diagnóstico.** Lo verificable automáticamente (no vacío, sin spoilers
  de solución) se valida; «descriptivo y no diagnóstico» es criterio de autoría que
  la revisión humana del paquete debe asegurar (se documenta en el esquema).
- La redacción exacta de mensajes de error y textos es libre mientras sea
  explícita, en español e identifique el examen/asset implicado.
- Las pruebas E2E históricas con credenciales no se ejecutan contra Supabase
  alojado; la verificación del tren usa solo fixtures y backend aislado.
- **Spec de navegador heredada de M04.** La verificación de Metis ejecuta el
  oráculo, las regresiones y la receta visual (nunca Playwright contra Supabase
  alojado). Se comprobó que `tests/e2e/opposition-history-dashboard.spec.js`
  falla YA en BASE por su propio interceptor (no gestiona el POST de
  `get_server_now` ni los arranques de intento y responde 500 a ellos): es una
  laguna preexistente de su fixture, fuera de allowedPaths de esta unidad; el
  witness de M04 (oráculo) sigue pasando 7/7 y esta unidad no la exige ni la
  repara. La nueva spec `tests/e2e/exam-media.spec.js` sí gestiona esos POST
  legítimos y pasa completa.

## Trazabilidad

| Requisito | Verificación |
|---|---|
| 1. Extensión declarativa en esquema separado (caseId, refs ordenadas, path/MIME/dims/sha/origen/versión) | Oráculo: «la extensión multimedia vive en un esquema separado…» (asset con path/mime/width/height/sha256/source/version, pattern que rechaza `..`/absolutas/remotas, alt exigida; `exam.schema.json` sin `media`/`caseId`) + conductual `validatePackageMedia` con variantes |
| 2. Carga valida e integra con error explícito (ausente/corrupto/MIME/dims/ruta insegura/referencia errónea) | Oráculo: `verifyPackageMedia` con variantes de bytes/404/hash/MIME/dimensiones; «el catálogo valida e integra…» (`loadPublishedCatalog` rechaza con error explícito y resuelve `question.media`; paquete sin media intacto) |
| 3. Presentación en los cinco modos, arranque y reanudación; contexto de origen en compuestas | Oráculo: «el render compartido de pregunta presenta media…» (`renderStudy` cubre normal/aleatorio/examen/falladas/artificial y reanudación por `restore`; `buildQuestionMediaList` por paquete de origen) + Witness `exam-media-contract` (tests/exam-media.test.mjs) |
| 4. Revisión histórica fijada (imágenes/orden/caso) sin escrituras y con corrección intacta | Oráculo: «la revisión histórica resuelve la media de la versión fijada…» (v1 fijada frente a v2 actual, compuesta fallada/artificial por paquete de origen, respuestas sin mutar, solo lectura `attempt_answers`) |
| 5. Ampliación por toque y teclado, cierre accesible, foco recuperado, sin desbordes a 390/1280, alt sin pistas | Oráculo: diálogo modal creado desde JS, cierre + recuperación de foco, alt validado sin spoilers (`validatePackageMedia`); Receta visual `estudio-caso-390`/`ampliacion-390` y medición del kit (sin scroll horizontal) |
| 6. Cero efectos colaterales; sin imágenes idéntico | Oráculo: «las sesiones conservan su comportamiento con preguntas con media» (QuizSession/NormalStudySession/ExamSession con `media` puntúan igual) + catálogo sin media sin peticiones extra (consumidores M04) |
| 7. Pruebas aisladas sintéticas + receta visual completa | Witness `exam-media-contract` + spec Playwright (`tests/e2e/exam-media.spec.js` vía `tests/playwright-tren-b.config.js`) + receta visual sin credenciales |
| 8. Oráculo discriminante M05 (falla en BASE, pasa 3/3) | Witness `oracle-m05-casos-multimedia` (`metis/oracles/exam-media.test.mjs`, `mustFailAtBase: true`) |

## Consumidores que siguen funcionando (sin modificarlos)

`app/src/history.js` (contrato M04 conservado, media añadida), `app/src/study-session.js`,
`app/src/active-attempt-persistence.js`, `app/src/artificial-exam.js`,
`app/src/quiz-core.js`, `tests/catalog.test.mjs`, `tests/artificial-exam.test.mjs`,
`tests/multiopposition-catalog.test.mjs`, `tests/history.test.mjs`,
`scripts/parse_sas_exam.py`, `.github/workflows/exam-publication-check.yml`,
`metis/oracles/oposicion-oficial.test.mjs` y
`metis/oracles/artificial-oposicion.test.mjs`: los paquetes sin imágenes no
desencadenan ninguna petición ni comportamiento nuevo.

```metis-unit
{
  "schema": "metis.unit/v1",
  "unit": "m05-casos-multimedia",
  "riskClass": "complex",
  "uiImpact": "quality",
  "sizeClass": "M",
  "maxCorrections": 1,
  "allowedPaths": [
    "schemas/exam-media.schema.json",
    "app/src/exam-media.js",
    "app/src/catalog.js",
    "app/src/history.js",
    "app/src/app.js",
    "app/src/styles.css",
    "tests/exam-media.test.mjs",
    "tests/e2e/exam-media.spec.js",
    "tests/playwright-tren-b.config.js"
  ],
  "doNotTouch": [
    "metis/",
    "docs/metis/"
  ],
  "ports": [4316],
  "witness": [
    {
      "id": "oracle-m05-casos-multimedia",
      "cmd": ["node", "--test", "metis/oracles/exam-media.test.mjs"],
      "timeoutSec": 240,
      "mustFailAtBase": true
    },
    {
      "id": "exam-media-contract",
      "cmd": ["node", "--test", "tests/exam-media.test.mjs"],
      "timeoutSec": 120,
      "mustFailAtBase": true
    }
  ],
  "visualRecipe": "metis/visual-recipe-m05-casos-multimedia.mjs",
  "visual": {
    "cmd": ["node", "metis/visual-recipe-m05-casos-multimedia.mjs"],
    "timeoutSec": 480,
    "shots": [
      "estudio-caso-imagen-compartida-1280",
      "estudio-varias-imagenes-orden-1280",
      "ampliacion-1280",
      "revision-historica-imagenes-1280",
      "examen-imagen-1280",
      "estudio-caso-390",
      "ampliacion-390",
      "error-asset-ausente-390"
    ],
    "criteria": [
      "C1: En estudio-caso-imagen-compartida-1280 la pregunta 1 del caso muestra su imagen compartida legible (PNG sintético servido en aislado) con su texto alternativo descriptivo y sin ningún texto que revele la solución; toda la interfaz en español.",
      "C2: En estudio-varias-imagenes-orden-1280 la segunda pregunta del mismo caso muestra varias imágenes en el orden declarado (compartida primero) sin desbordar la página.",
      "C3: En ampliacion-1280 y ampliacion-390 la ampliación abre un diálogo modal con la imagen completa y un cierre accesible; la miniatura es un botón (toque y teclado).",
      "C4: En revision-historica-imagenes-1280 la revisión histórica de un intento fijado a la versión v1 muestra las imágenes de v1 (tono rojo sintético) aunque el catálogo actual publique la v2 (tono azul), con «Versión histórica fijada: …» visible y la corrección persistida intacta.",
      "C5: En examen-imagen-1280 el Modo examen cronometrado muestra la imagen de la pregunta con el bloqueo global intacto y sin cambios de score o temporización.",
      "C6: En estudio-caso-390 el estudio a 390 px mantiene la imagen legible sin scroll horizontal de página (medición del kit de capturas).",
      "C7: En error-asset-ausente-390 un asset ausente produce un error explícito del catálogo (identifica el examen/asset) y ninguna pregunta aparentemente completa sin su imagen; los exámenes sin imágenes de la otra oposición no cambian."
    ]
  }
}
```
