# Aplicación SAS — Spec canónica v1

**Estado:** READY FOR INDEPENDENT REVIEW  
**Origen:** `grill-with-docs` cerrado + seams de testing confirmados  
**Siguiente paso del workflow:** revisión independiente; si queda `READY`, pasar a `to-tickets`

## Problem Statement

Tres usuarios necesitan una aplicación privada y muy sencilla para preparar las oposiciones de Administrativo/a del SAS utilizando exámenes oficiales. Hoy los PDF permiten practicar, pero no ofrecen un flujo continuo de estudio, corrección inmediata, simulación cronometrada, persistencia entre dispositivos, recuperación sistemática de preguntas falladas, historial ni comparación entre los tres usuarios.

El problema no es crear un LMS ni una plataforma educativa generalista. El producto debe mantenerse pequeño y fiel al material oficial: convertir los PDF en un **Banco de exámenes** fiable, ofrecer **Modo estudio** y **Modo examen**, conservar el progreso individual y permitir repetir las **Falladas pendientes** hasta convertirlas en **Preguntas dominadas**.

La fidelidad al examen oficial es crítica. Las preguntas anuladas, las reservas, la numeración, la duración y la plantilla definitiva no pueden inferirse de forma creativa. Si el importador no puede justificar con la documentación oficial el **Conjunto puntuable definitivo**, el examen no debe publicarse automáticamente.

Además, los usuarios quieren poder crear un **Examen artificial** de 75 preguntas aleatorias procedentes de todo el banco y realizarlo tanto en Modo estudio como en Modo examen.

## Solution

Construir una PWA privada para tres cuentas precreadas, servida como frontend estático y respaldada por Supabase para autenticación y estado dinámico.

El contenido oficial vive en un **Banco de exámenes** de JSON estáticos versionados. Un flujo de importación transforma cada PDF en un paquete de examen canónico, ejecuta **QA de importación** y exige aprobación humana antes de publicar contenido nuevo. Las preguntas oficiales y sus respuestas no se duplican en la base de datos dinámica.

La aplicación ofrece cuatro recorridos principales para el usuario:

- estudiar un examen oficial en orden normal;
- estudiar un examen oficial en orden aleatorio;
- trabajar una sesión de Falladas pendientes;
- realizar un examen cronometrado.

A estos se suma el Examen artificial de 75 preguntas, reutilizando las mismas reglas de estudio o examen.

El sistema conserva historial, progreso, dominio de preguntas, tiempos y estadísticas por usuario. Los tres usuarios pueden compararse mediante un **Dashboard compartido** que expone únicamente agregados, no respuestas detalladas de los demás.

El diseño evita complejidad no necesaria: no hay IA explicativa, clasificación temática, panel de administración, registro público, tiempo por pregunta, Realtime ni offline completo.

## User Stories

1. Como usuario autorizado, quiero iniciar sesión con mi email y contraseña, para acceder únicamente a mi progreso personal.
2. Como usuario autorizado, quiero mantener mi sesión en mis dispositivos habituales, para no tener que autenticarme continuamente.
3. Como propietario de la aplicación, quiero que no exista registro público, para que solo las tres cuentas precreadas puedan entrar.
4. Como usuario, quiero ver en el inicio todos los exámenes oficiales publicados, para elegir rápidamente qué practicar.
5. Como usuario, quiero ver en cada examen su nombre, número de Preguntas activas y duración oficial, para saber qué voy a realizar.
6. Como usuario, quiero ver si un examen está Sin empezar, En curso o Finalizado para mí, para entender mi estado de un vistazo.
7. Como usuario, quiero ver mi progreso activo en un examen, para poder continuarlo sin buscar dónde me quedé.
8. Como usuario, quiero ver mi mejor nota de Modo examen en la tarjeta del examen, para conocer mi referencia personal.
9. Como usuario, quiero ver cuántas Falladas pendientes tengo en cada examen, para decidir qué repasar.
10. Como usuario, quiero iniciar Modo estudio en Orden normal, para recorrer el examen respetando el orden oficial.
11. Como usuario, quiero iniciar Modo estudio en Orden aleatorio, para practicar el mismo examen sin memorizar la secuencia.
12. Como usuario, quiero que el orden aleatorio se genere una sola vez por recorrido, para no repetir preguntas antes de completar el conjunto.
13. Como usuario, quiero que el orden aleatorio persista al cerrar y volver a entrar, para continuar exactamente la misma sesión.
14. Como usuario, quiero que solo exista un Recorrido principal de estudio activo por examen, para que mi progreso no se fragmente entre varias sesiones paralelas.
15. Como usuario, quiero recibir una advertencia si cambio de Orden normal a Orden aleatorio o al contrario, para saber que el recorrido anterior quedará incompleto.
16. Como usuario, quiero seleccionar una respuesta provisional antes de confirmarla en Modo estudio, para poder cambiar de opinión sin penalización.
17. Como usuario, quiero confirmar mi respuesta con `Comprobar respuesta`, para decidir conscientemente cuándo quiero corregirla.
18. Como usuario, quiero ver inmediatamente la respuesta oficial después de confirmar, para aprender mientras practico.
19. Como usuario, quiero que una respuesta confirmada quede bloqueada, para que el historial del intento no pueda reescribirse después de conocer la solución.
20. Como usuario, quiero ver claramente mi opción incorrecta y la opción oficial correcta, para entender el error de inmediato.
21. Como usuario, quiero saltar una pregunta en Modo estudio sin que cuente como error, para volver a ella más tarde.
22. Como usuario, quiero que una pregunta saltada siga pendiente hasta que la responda, para que completar un estudio implique haber trabajado todo el conjunto.
23. Como usuario en Orden aleatorio, quiero que una pregunta saltada vuelva al final de la cola pendiente, para no bloquear mi avance.
24. Como usuario, quiero pausar y reanudar el estudio, para repartir una sesión larga en varios momentos.
25. Como usuario, quiero que se contabilice únicamente mi Tiempo activo de estudio, para que el dato represente tiempo real de práctica y no tiempo con la aplicación abandonada.
26. Como usuario, quiero continuar mi Recorrido principal de estudio desde otro dispositivo, para poder alternar entre móvil y PC.
27. Como usuario, quiero ver al terminar un recorrido de estudio mis aciertos, errores, tasa de acierto y Tiempo activo de estudio, para evaluar la sesión.
28. Como usuario, quiero ver cuántas preguntas han entrado nuevas en Falladas pendientes al terminar, para saber qué debo repasar.
29. Como usuario, quiero ver cuántas preguntas he convertido en Preguntas dominadas, para apreciar mi progreso de recuperación.
30. Como usuario, quiero revisar un intento de estudio finalizado en solo lectura, para consultar qué contesté y cuál era la respuesta oficial.
31. Como usuario, quiero que una respuesta incorrecta en estudio entre en Falladas pendientes, para que el sistema me la vuelva a enseñar posteriormente.
32. Como usuario, quiero que una respuesta incorrecta en examen entre en Falladas pendientes al finalizar, para que un fallo bajo condiciones reales también genere repaso.
33. Como usuario, quiero que una pregunta en blanco en examen entre en Falladas pendientes, para no esconder lagunas simplemente por no contestar.
34. Como usuario, quiero dominar una pregunta fallada únicamente después de dos aciertos consecutivos, para exigir una mínima evidencia de aprendizaje.
35. Como usuario, quiero que un nuevo fallo reinicie a cero mi racha de dominio, para que el estado Dominada no sea permanente si vuelvo a equivocarme.
36. Como usuario, quiero que los aciertos consecutivos puedan acumularse entre estudio y examen, para que el dominio represente mi comportamiento global sobre la pregunta.
37. Como usuario, quiero estudiar solo las Falladas pendientes de un examen concreto, para concentrarme en ese examen.
38. Como usuario, quiero estudiar Todas mis falladas mezcladas entre todos los exámenes, para trabajar mis debilidades globales.
39. Como usuario, quiero que una misma pregunta aparezca como máximo una vez en cada Sesión de falladas, para evitar repeticiones dentro de la misma sesión.
40. Como usuario, quiero pausar y reanudar una Sesión de falladas, para no tener que completarla de una vez.
41. Como usuario, quiero tener como máximo una Sesión de falladas activa, para evitar múltiples progresos paralelos difíciles de entender.
42. Como usuario, quiero realizar un examen oficial en Modo examen, para simular las condiciones de la prueba.
43. Como usuario, quiero que el Modo examen respete el orden oficial, para que la simulación reproduzca el cuadernillo publicado.
44. Como usuario, quiero que el Modo examen use la duración oficial del PDF, para reproducir el tiempo real de la convocatoria.
45. Como usuario, quiero ver una cuenta atrás durante el examen, para gestionar el tiempo restante.
46. Como usuario, quiero que el reloj de examen no se pause al cerrar la pestaña, bloquear el dispositivo o salir temporalmente, para que no pueda alargar artificialmente la prueba.
47. Como usuario, quiero poder navegar libremente entre preguntas durante el examen, para revisar y cambiar respuestas antes de entregar.
48. Como usuario, quiero poder dejar preguntas en blanco durante el examen, para decidir si prefiero no asumir la penalización de un error.
49. Como usuario, quiero poder cambiar mis respuestas de examen mientras el intento siga abierto, para revisar decisiones antes de entregar.
50. Como usuario, quiero que el examen no revele aciertos ni errores mientras está activo, para conservar una simulación realista.
51. Como usuario, quiero que mis cambios de respuesta se autoguarden, para minimizar el riesgo de pérdida de progreso.
52. Como usuario, quiero que al finalizar antes de tiempo se me muestre cuántas preguntas están contestadas y cuántas en blanco, para evitar una entrega accidental.
53. Como usuario, quiero confirmar expresamente una entrega anticipada, para saber que después las respuestas quedarán bloqueadas.
54. Como usuario, quiero que el examen se entregue automáticamente cuando el contador llegue a cero, para respetar la duración oficial.
55. Como usuario, quiero que al reabrir un examen después de su deadline se cierre automáticamente con las últimas respuestas guardadas, para que cerrar la app no pause el tiempo.
56. Como usuario, quiero recibir al terminar la nota sobre 100, aciertos, errores, blancas y tiempo empleado, para evaluar la simulación.
57. Como usuario, quiero que todos los aciertos del Conjunto puntuable definitivo tengan el mismo valor, para reproducir el sistema de corrección acordado.
58. Como usuario, quiero que cada error descuente una cuarta parte del valor de un acierto, para reproducir la penalización oficial utilizada por estos exámenes.
59. Como usuario, quiero que una respuesta en blanco valga cero y no penalice, para que el cálculo respete las reglas acordadas.
60. Como usuario, quiero saber si un resultado de examen es un nuevo récord personal, para identificar mejoras.
61. Como usuario, quiero ver mi posición frente a los otros dos usuarios para ese examen, para tener una comparación sencilla.
62. Como usuario, quiero que el ranking de un examen use la mejor nota histórica de cada persona, para comparar el mejor rendimiento alcanzado.
63. Como usuario, quiero que un empate de nota se resuelva por menor tiempo empleado en ese mismo intento, para tener un criterio de desempate único.
64. Como usuario, quiero repetir un examen oficial tantas veces como quiera, para seguir entrenando aunque ya figure como Finalizado.
65. Como usuario, quiero que completar al menos una vez un examen oficial en un recorrido completo de estudio o en Modo examen deje el hito Finalizado, para saber qué exámenes ya he completado íntegramente.
66. Como usuario, quiero que repetir posteriormente el examen no borre el hito Finalizado, para conservar mi progreso histórico.
67. Como usuario, quiero mantener mi Recorrido principal de estudio aunque decida hacer un Modo examen del mismo examen, para que ambas actividades sean independientes.
68. Como usuario, quiero consultar un Historial con todos mis intentos, incluidos los incompletos o abandonados, para conocer mi actividad real.
69. Como usuario, quiero diferenciar en el Historial si un intento fue estudio, examen, Sesión de falladas o Examen artificial, para interpretar correctamente sus métricas.
70. Como usuario, quiero abrir cualquier intento histórico en solo lectura, para revisar las preguntas, mis respuestas y las respuestas oficiales correspondientes a aquella versión.
71. Como usuario, quiero que un intento histórico nunca cambie porque después se corrija el Banco de exámenes, para conservar la fidelidad de lo que realmente hice.
72. Como usuario, quiero generar un Examen artificial de 75 preguntas de todo el banco, para practicar una mezcla nueva cada vez.
73. Como usuario, quiero que un Examen artificial no repita el mismo registro de pregunta dentro del mismo intento, para recibir 75 preguntas distintas del pool seleccionado.
74. Como usuario, quiero que un Examen artificial pueda realizarse en Modo estudio, para practicar una mezcla transversal con corrección inmediata.
75. Como usuario, quiero que un Examen artificial pueda realizarse en Modo examen, para simular una prueba nueva construida con preguntas oficiales.
76. Como usuario, quiero que el Examen artificial en Modo examen dure 120 minutos, para disponer de una condición estable equivalente a los exámenes actuales de 75 preguntas.
77. Como usuario, quiero que el Examen artificial en Modo examen utilice la misma fórmula de nota y penalización, para que sus resultados sean comparables como práctica.
78. Como usuario, quiero que los aciertos, fallos y blancas de un Examen artificial actualicen el progreso de sus preguntas de origen, para que el sistema de dominio sea coherente en todos los modos.
79. Como usuario, quiero que completar un Examen artificial no marque como Finalizado ningún examen oficial, para no confundir una mezcla parcial con haber completado su examen de origen.
80. Como usuario, quiero que los Exámenes artificiales no participen en el ranking de ningún examen oficial, para mantener rankings comparables.
81. Como usuario, quiero un navegador numerado en estudio y examen, para saltar rápidamente a una pregunta concreta.
82. Como usuario en estudio, quiero distinguir visualmente preguntas pendientes, correctas e incorrectas, para entender mi estado dentro del recorrido.
83. Como usuario en examen, quiero distinguir únicamente preguntas contestadas y pendientes, para no recibir pistas de corrección.
84. Como usuario móvil, quiero que el navegador numerado sea plegable, para que no ocupe la mayor parte de la pantalla.
85. Como usuario, quiero que la aplicación me indique cuando está Sin conexión, para saber que mis cambios están pendientes de sincronizar.
86. Como usuario, quiero poder seguir contestando durante un corte breve de red, para que una interrupción momentánea no arruine una sesión.
87. Como usuario, quiero que los cambios no sincronizados se conserven temporalmente en mi dispositivo y se reintenten al reconectar, para reducir pérdidas de información.
88. Como usuario, quiero que cerrar accidentalmente durante un corte breve permita recuperar en el mismo dispositivo los últimos cambios confirmados, para tolerar fallos comunes sin convertir la app en offline-first.
89. Como usuario, quiero que el reloj de examen siga corriendo aunque esté Sin conexión, para mantener la integridad temporal de la simulación.
90. Como usuario, quiero ver mi número total de respuestas, tasa de acierto y Tiempo total de estudio, para seguir mi actividad global.
91. Como usuario, quiero ver mi nota media y mi mejor nota en Modo examen, para seguir mi rendimiento real en simulaciones.
92. Como usuario, quiero ver cuántas preguntas previamente falladas he dominado, para medir recuperación de errores.
93. Como usuario, quiero comparar estas métricas agregadas con las de los otros dos usuarios, para tener una referencia compartida sin ver sus respuestas individuales.
94. Como usuario, quiero ver estadísticas de una pregunta sobre intentos, aciertos, errores, tasa de acierto y estado de dominio, para conocer mi comportamiento histórico sobre ella.
95. Como usuario, quiero detectar preguntas que han sido falladas por los tres usuarios mediante estadísticas agregadas, para identificar ítems especialmente difíciles.
96. Como usuario, quiero ver por examen intentos, mejor nota, nota media, mejor tiempo, tasa de acierto, falladas, dominadas y último intento, para entender mi rendimiento por convocatoria.
97. Como usuario, quiero instalar la aplicación como PWA en móvil y PC, para usarla como una aplicación habitual.
98. Como usuario, quiero acceder también mediante una URL normal, para no depender de la instalación de la PWA.
99. Como propietario, quiero poder añadir un PDF oficial al repositorio y ejecutar automáticamente su importación, para ampliar el banco sin construir un panel administrativo.
100. Como propietario, quiero que el importador extraiga metadatos, preguntas, opciones, plantilla definitiva, anuladas, reservas y duración, para producir un paquete canónico de examen.
101. Como propietario, quiero que una Pregunta anulada no aparezca en el cuestionario activo, para que no se estudie ni se puntúe.
102. Como usuario, quiero conservar la numeración original de las preguntas ordinarias aunque haya saltos por anulaciones, para reconocer la correspondencia con el PDF.
103. Como usuario, quiero que las reservas realmente utilizadas aparezcan al final como R1, R2, R3…, para entender que son sustituciones sin ver numeraciones extrañas como 151 o 152.
104. Como propietario, quiero conservar internamente el número original de cada reserva, para mantener trazabilidad con el documento fuente.
105. Como propietario, quiero que el importador utilice únicamente reservas justificadas por la documentación oficial, para no inventar sustituciones.
106. Como propietario, quiero que un examen quede bloqueado si las anulaciones y reservas no pueden resolverse con certeza, para exigir revisión humana.
107. Como propietario, quiero que el importador detecte errores estructurales como respuestas ausentes, opciones incompletas o recuentos incompatibles, para impedir publicaciones incorrectas.
108. Como propietario, quiero que las incidencias menores de texto o maquetación aparezcan en un informe de QA, para poder revisarlas antes de publicar.
109. Como propietario, quiero que ninguna importación nueva se publique sin aprobación humana, para evitar que una extracción técnicamente válida pero errónea llegue a los usuarios.
110. Como propietario, quiero que una nueva versión corregida de un examen no destruya la versión anterior necesaria por el Historial, para preservar intentos pasados.
111. Como propietario, quiero que el frontend utilice el Banco de exámenes estático como fuente de verdad del contenido oficial, para no mantener copias divergentes en Supabase.
112. Como propietario, quiero que cada usuario solo pueda modificar mediante la API sus propios progresos e intentos, para proteger la separación de datos.
113. Como propietario, quiero que el Dashboard compartido exponga solo agregados de los otros usuarios, para permitir comparación sin acceso a sus respuestas crudas.
114. Como propietario, quiero que ninguna credencial privilegiada de Supabase se incluya en el frontend, para no comprometer la base de datos.
115. Como propietario, quiero que los 12 PDF iniciales pasen por el importador y QA antes de considerar lista la v1, para validar el Banco de exámenes con todos los formatos reales disponibles.

## Implementation Decisions

- La aplicación será una web responsive e instalable como PWA.
- El frontend utilizará HTML, CSS y JavaScript nativo; Vite se utilizará únicamente como herramienta de desarrollo y build.
- GitHub Pages alojará el frontend compilado y el Banco de exámenes estático.
- Supabase será el único backend dinámico de la v1 y proporcionará autenticación, PostgreSQL y Row Level Security.
- Solo existirán tres cuentas de usuario precreadas con email y contraseña; no habrá registro público ni sistema de PIN personalizado.
- El Banco de exámenes será la fuente de verdad del texto de preguntas, opciones, respuestas oficiales y metadatos del examen.
- El contenido oficial no se copiará a tablas de Supabase.
- Cada examen publicado tendrá una identidad y versión estable; los intentos históricos conservarán la referencia exacta a la versión utilizada.
- El importador se tratará como un módulo profundo con una interfaz conceptual pequeña: un PDF oficial entra y sale un paquete canónico de examen más un informe de QA y un estado publicable/no publicable.
- El importador nunca corregirá silenciosamente el contenido fuente ni inventará reservas, respuestas o reglas de sustitución.
- Las Preguntas anuladas quedan fuera del conjunto activo. La numeración original de las preguntas ordinarias se conserva y por ello puede contener saltos.
- Las Preguntas de reserva solo entran en el Conjunto puntuable definitivo cuando la documentación oficial justifica su uso. En interfaz se etiquetan R1, R2, R3…; internamente conservan su numeración fuente.
- Una importación estructuralmente ambigua queda bloqueada hasta revisión humana.
- El flujo de publicación de un examen nuevo separará generación automática y aprobación humana. La aprobación humana será una condición previa a la incorporación al catálogo publicado.
- El Modo estudio tendrá tres estrategias visibles: Orden normal, Orden aleatorio y Solo falladas.
- Orden normal y Orden aleatorio comparten un único Recorrido principal de estudio activo por usuario y examen.
- El Orden aleatorio materializa y persiste la secuencia generada para garantizar reanudación y ausencia de repeticiones dentro del recorrido.
- Confirmar una respuesta en Modo estudio produce corrección inmediata y bloqueo de esa respuesta dentro del intento.
- Saltar no registra acierto ni error y mantiene la pregunta pendiente.
- El sistema de dominio se modela por usuario y pregunta de origen, no por intento. Dos aciertos consecutivos después de haber fallado convierten la pregunta en Dominada; un nuevo fallo reinicia la racha.
- Las sesiones Solo falladas son intentos independientes del Recorrido principal. Puede existir como máximo una Sesión de falladas activa por usuario.
- Todas mis falladas puede mezclar preguntas procedentes de varios exámenes, conservando siempre la referencia de origen.
- El Modo examen usa un `started_at` y un deadline absolutos. El tiempo restante se deriva del reloj y no de un contador pausado localmente.
- Las respuestas de examen pueden cambiar hasta la entrega o expiración. La corrección se ejecuta únicamente al cerrar el intento.
- La puntuación de un examen usa N igual al número de preguntas del Conjunto puntuable definitivo; cada acierto vale `100/N`, cada error penaliza una cuarta parte de ese valor y una blanca vale cero.
- El Examen artificial genera 75 referencias aleatorias desde el pool de Preguntas activas publicadas y no repite el mismo registro de pregunta en el mismo intento.
- No se implementará deduplicación semántica; preguntas iguales o casi iguales de distintos exámenes siguen siendo registros distintos por origen.
- El Examen artificial puede ejecutarse como estudio o examen. En Modo examen dura 120 minutos y aplica las reglas generales de puntuación.
- Completar un Examen artificial no modifica el hito Finalizado de sus exámenes de origen y no participa en rankings específicos de exámenes oficiales.
- Los aciertos, errores y blancas de cualquier modo que trabaje una pregunta real actualizan el `question_progress` de esa pregunta de origen conforme a las reglas de dominio.
- La aplicación separará Tiempo activo de estudio, tiempo empleado por examen y Tiempo total de estudio. No habrá medición por pregunta.
- El autoguardado será no bloqueante. La UI podrá avanzar sin esperar a la confirmación remota de cada cambio.
- La tolerancia a cortes breves de red utilizará una cola local de cambios pendientes y reintento al recuperar conectividad. Esta capacidad no se presentará como soporte offline completo.
- La aplicación tendrá un módulo de persistencia que abstraiga sincronización remota y outbox local de la lógica de estudio/examen.
- El Historial es inmutable desde la perspectiva del usuario y conserva tanto intentos completados como incompletos/abandonados.
- El hito Finalizado de un examen oficial es histórico: una vez conseguido, no se revierte por repetir o abandonar intentos posteriores.
- Las estadísticas derivadas no requieren tablas adicionales cuando puedan calcularse desde intentos, respuestas y progreso de pregunta.
- El Dashboard compartido se apoyará en una interfaz agregada de lectura que no permita consultar las respuestas crudas de otro usuario.
- El modelo dinámico mínimo se estructura alrededor de cinco conceptos persistentes: perfil, progreso principal de estudio, intento, respuesta de intento y progreso por pregunta.
- El progreso principal de estudio guarda como mínimo usuario, examen/version, estrategia, cola/orden, posición y Tiempo activo de estudio.
- Un intento guarda como mínimo usuario, tipo de origen, examen/version cuando aplique, modo, estrategia, estado, tiempos, agregados de resultado, score cuando aplique y cola de preguntas.
- Una respuesta de intento guarda la referencia a pregunta, selección, estado de corrección y marcas temporales necesarias para persistencia/revisión.
- El progreso por pregunta guarda contadores de respuesta, aciertos, errores, racha consecutiva y estado never_failed/pending/mastered o equivalente.
- Row Level Security debe impedir que un usuario lea o modifique filas privadas de otro usuario salvo los agregados explícitamente expuestos para comparación.
- La clave privilegiada de Supabase nunca formará parte del frontend; el cliente utilizará únicamente credenciales públicas compatibles con RLS.
- No se introducirá Realtime salvo que aparezca posteriormente una necesidad funcional que lo justifique.
- La PWA cacheará el shell necesario para una experiencia robusta, pero no intentará implementar sincronización offline general del producto.

## Testing Decisions

### Principio general

Los tests comprobarán **comportamiento observable en seams estables**, no funciones privadas, estructura interna del DOM, helpers, nombres de módulos o detalles accidentales de implementación. El objetivo es permitir que el código interno cambie sin reescribir la suite mientras el contrato de producto siga cumpliéndose.

Se han confirmado **dos seams principales**, deliberadamente pocos y altos.

### Seam 1 — Importador: PDF oficial → paquete canónico de examen + QA

El importador se prueba como caja negra.

Entrada observable:
- un PDF oficial real.

Salida observable:
- metadatos canónicos del examen;
- preguntas y opciones;
- plantilla definitiva;
- Conjunto puntuable definitivo;
- anuladas;
- reservas utilizadas/no utilizadas;
- duración;
- numeración/identidad de origen;
- versión/hash;
- informe de QA;
- estado publicable o bloqueado.

Buenas pruebas en este seam verifican invariantes del dominio, por ejemplo:
- que el recuento final sea justificable por el PDF y su plantilla;
- que ninguna anulada llegue al conjunto activo;
- que las reservas activadas sean exactamente las justificadas;
- que una pregunta activa tenga opciones y respuesta oficial válidas;
- que los casos ambiguos queden bloqueados en lugar de ser adivinados;
- que una incidencia de texto quede registrada en QA;
- que la misma entrada produzca una representación estable y versionable.

Prior art disponible: existe un parser piloto y un caso de 2023 que ya consigue producir JSON/QA. La batería real de regresión serán los 12 PDF iniciales, precisamente porque representan formatos heterogéneos del SAS y han revelado que el parser piloto todavía no generaliza todos los encabezados/maquetaciones.

Criterio de salida de este seam: los 12 PDF iniciales deben poder clasificarse correctamente como importados válidos o bloqueados con un motivo explícito; ninguno puede depender de una corrección silenciosa.

### Seam 2 — Aplicación: usuario en navegador/PWA → estado persistido y comportamiento visible

La aplicación se prueba desde la experiencia de usuario contra un entorno Supabase de prueba/local o equivalente aislado. Este seam cubre frontend, motores de estado, persistencia y políticas de acceso como una unidad observable.

Buenas pruebas en este seam cubren recorridos completos, no piezas internas aisladas. Deben incluir al menos:
- autenticación de una de las tres cuentas;
- listado del Banco de exámenes;
- estudio normal de un examen;
- corrección inmediata y bloqueo tras confirmar;
- salto y retorno a pendientes;
- Orden aleatorio sin repeticiones y reanudable;
- sustitución advertida del Recorrido principal normal/aleatorio;
- entrada a Falladas pendientes;
- dominio solo tras dos aciertos consecutivos;
- reinicio de racha tras un fallo;
- Sesión de falladas por examen;
- Todas mis falladas entre exámenes;
- examen oficial con navegación y cambios de respuesta;
- deadline absoluto que continúa al cerrar/reabrir;
- autoentrega por expiración;
- cálculo de score y blancas;
- Historial inmutable y revisión contra la versión correcta del examen;
- Examen artificial de 75 preguntas sin repetir registros;
- Examen artificial en estudio y examen;
- Dashboard compartido y ranking por examen;
- bloqueo de acceso a datos privados de otro usuario mediante la API;
- corte breve de red, outbox local y posterior sincronización;
- recuperación local tras cierre accidental durante un corte breve;
- instalación/carga PWA en los dispositivos objetivo.

Prior art: el frontend de producto todavía no constituye una implementación estable sobre la que conservar tests anteriores. Esta suite será el primer contrato de comportamiento de alto nivel para la app. Los detalles del runner concreto se pueden decidir al convertir la spec en tickets sin cambiar este seam.

Criterio de salida de este seam: los criterios funcionales de la spec deben poder demostrarse mediante recorridos automatizados o, donde la plataforma no permita una automatización fiable, mediante una lista explícita y mínima de validación manual.

### Qué no se testea directamente

- funciones privadas;
- getters/setters triviales;
- helpers de formato aislados;
- estructura exacta de carpetas;
- nombres concretos de archivos;
- implementación interna del algoritmo de shuffle mientras cumpla ausencia de repetición y persistencia;
- implementación interna del cálculo de estadísticas mientras el resultado observable sea correcto;
- detalles internos de la cola local mientras preserve el contrato de tolerancia a cortes breves.

## Out of Scope

- Explicaciones de respuestas mediante IA.
- Generación de contenido didáctico por IA.
- RAG, embeddings o conexión con temarios.
- Clasificación por temas, materias o dificultad.
- Filtros temáticos.
- Tiempo de respuesta por pregunta y estadísticas de preguntas lentas.
- Deduplicación semántica de preguntas similares entre convocatorias.
- Registro público o autoservicio de cuentas.
- Administración de usuarios dentro de la app.
- Panel administrativo para importar exámenes.
- Backend de aplicación propio distinto de Supabase.
- Realtime y experiencias competitivas sincronizadas en directo.
- Modo examen oficial aleatorio.
- Antitrampas o corrección secreta en servidor; las respuestas oficiales son contenido público.
- Offline-first, resolución compleja de conflictos o uso indefinido sin conexión.
- Sustituir JIT/QA humano por decisiones inferidas automáticamente cuando la fuente sea ambigua.
- Frameworks de frontend como React, Vue, Next u otros mientras Vanilla JS satisfaga la v1.
- Puntuación global sintética que mezcle métricas distintas en un único índice.
- Gráficos avanzados o analítica de producto compleja.
- Salas, retos en vivo, mensajería o funciones sociales adicionales.

## Further Notes

- El lenguaje canónico de la implementación debe conservar los términos del CONTEXT: Examen oficial, Pregunta anulada, Pregunta de reserva, Conjunto puntuable definitivo, Recorrido principal de estudio, Falladas pendientes, Pregunta dominada, Sesión de falladas, Examen artificial, Historial y Dashboard compartido.
- El parser piloto actual sirve como prueba de concepto, no como garantía de compatibilidad general. Antes de construir dependencias fuertes sobre el formato JSON definitivo, el importador debe validarse contra los 12 PDF iniciales.
- Los formatos reales de plantilla difieren entre convocatorias; la generalización del importador es por tanto el primer riesgo técnico que debe resolverse.
- Las reglas de anuladas/reservas deben poder justificarse por examen. Si la fuente no permite una conclusión segura, el resultado correcto del sistema es `bloqueado para revisión`, no una heurística silenciosa.
- La revisión humana del QA forma parte del diseño operativo, no es un parche temporal.
- Una corrección posterior de un examen publicado debe crear una nueva versión sin invalidar la revisión de intentos históricos.
- El orden recomendado después de aprobar esta spec es: `to-tickets` → implementación ticket a ticket → `code-review` y validación. Antes de `to-tickets`, este documento puede pasar por una revisión independiente con otro modelo, tal como ha decidido el usuario para reducir sesgo de planificación.
- La revisión independiente debe evaluar esta spec contra el CONTEXT y las decisiones ya cerradas, no ampliar el scope por preferencia arquitectónica del revisor.
- La v1 se considera suficientemente definida cuando el auditor independiente puede devolver `READY` sin requisitos funcionales abiertos. Las credenciales, correos concretos, proyecto Supabase definitivo, permisos GitHub y elecciones visuales mínimas son inputs operativos de implementación, no huecos de producto.
