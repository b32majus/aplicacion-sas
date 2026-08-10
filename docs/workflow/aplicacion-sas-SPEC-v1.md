# Aplicación SAS — SPEC v1

Estado: diseño funcional cerrado tras grill-with-docs  
Objetivo: implementar una primera versión pequeña, mantenible y fiel a los exámenes oficiales.

## 1. Objetivo del producto

Aplicación web/PWA privada para tres hermanos que preparan oposiciones de Administrativo/a del SAS.

Debe permitir:
- estudiar exámenes oficiales;
- simularlos con tiempo y puntuación real;
- repetir preguntas falladas hasta dominarlas;
- mantener progreso e historial entre dispositivos;
- comparar estadísticas entre los tres;
- generar exámenes artificiales de 75 preguntas de todo el banco;
- incorporar nuevos PDF mediante GitHub sin crear un panel administrativo.

## 2. Fuera de alcance de la v1

No se implementan:
- explicaciones mediante IA;
- temáticas o clasificación por materia;
- RAG o uso del temario;
- tiempo por pregunta;
- deduplicación semántica de preguntas similares;
- registro público de usuarios;
- panel de administración dentro de la app;
- modo offline completo;
- antitrampas;
- Realtime;
- framework de frontend;
- salas o competición sincronizada.

## 3. Arquitectura

### Frontend
- HTML + CSS + JavaScript nativo.
- Vite como herramienta de desarrollo/build.
- PWA responsive e instalable.
- GitHub Pages como hosting.

### Backend
Supabase como único backend dinámico:
- Supabase Auth para 3 cuentas privadas con email + contraseña.
- PostgreSQL para progreso, intentos, respuestas y estado por pregunta.
- Row Level Security para escritura/lectura privada de datos propios.
- Vista o función agregada de solo lectura para el dashboard compartido.

### Contenido
- PDF originales versionados en GitHub.
- Preguntas de ejecución en JSON estático.
- Las respuestas oficiales permanecen en el JSON público.
- No se duplica el banco de preguntas en Supabase.

## 4. Exámenes oficiales

Cada PDF se presenta al usuario como un único cuestionario.

La app no expone bloques `teoría/práctica`, aunque el parser pueda conservarlos como metadatos.

### Anuladas y reservas
- Las preguntas anuladas no se muestran ni se puntúan.
- Se conserva la numeración original de las ordinarias; por tanto puede haber saltos.
- Se añaden al final únicamente las reservas justificadas que sean necesarias.
- En UI se muestran como `R1`, `R2`, `R3`…
- Internamente mantienen su número original, por ejemplo 151, 152, 153.
- Si la documentación no permite reconstruir con certeza el conjunto puntuable, el examen queda bloqueado para publicación hasta revisión humana.
- Nunca se inventan reservas ni reglas de sustitución.

### Versionado
Cada publicación de un examen tiene `examVersion` o hash.
Los intentos guardan la versión usada.
Una corrección futura genera una nueva versión del JSON; no sobrescribe la versión necesaria para revisar intentos históricos.

## 5. Modo estudio

### Estrategias
Al pulsar `Estudiar` en un examen oficial:
1. `Orden normal`
2. `Orden aleatorio`
3. `Solo falladas`

`Solo falladas` permite:
- falladas de este examen;
- todas mis falladas.

### Respuesta
- Tocar una opción solo la selecciona.
- `Comprobar respuesta` confirma.
- Tras confirmar, la respuesta se corrige y queda bloqueada.
- Correcta: se resalta la opción oficial.
- Incorrecta: selección en rojo y oficial en verde.
- No hay explicación IA.
- `Saltar` deja la pregunta pendiente sin acierto ni error.

### Reanudación
- Un único recorrido principal activo por usuario y examen: normal o aleatorio.
- Cambiar de normal a aleatorio, o viceversa, deja el anterior como incompleto tras advertencia.
- Las preguntas saltadas siguen pendientes.
- En aleatorio, una saltada vuelve al final de la cola.
- El progreso se conserva entre dispositivos.

### Finalización
Un recorrido principal solo se completa cuando todas las preguntas incluidas han sido finalmente respondidas.

Resumen:
- aciertos;
- errores;
- tasa de acierto;
- tiempo activo;
- nuevas falladas;
- preguntas dominadas.

Acciones:
- Revisar;
- Estudiar falladas;
- Volver al inicio.

## 6. Falladas y dominio

Una pregunta entra en `Falladas pendientes` cuando:
- se responde incorrectamente en estudio;
- se responde incorrectamente en examen;
- queda en blanco en examen.

Una pregunta previamente fallada queda `Dominada` tras 2 aciertos consecutivos, independientemente de si se logran en estudio, examen o combinación de ambos.

Cualquier nuevo fallo reinicia la racha a 0.

### Sesiones de falladas
- Una pregunta aparece como máximo una vez en cada sesión.
- Se pueden pausar y reanudar.
- Máximo una sesión de falladas activa por usuario.
- `Todas mis falladas` mezcla aleatoriamente preguntas de todos los exámenes.

## 7. Modo examen

### Configuración
- Usa el conjunto puntuable definitivo del examen.
- Respeta el orden oficial.
- Usa la duración oficial extraída del PDF.
- No existe modo aleatorio para el examen oficial.

### Durante la prueba
- Cuenta atrás.
- El reloj no se pausa al cerrar, bloquear el dispositivo o dejar la pestaña.
- Puede navegar libremente.
- Puede dejar preguntas en blanco.
- Puede cambiar respuestas mientras el intento esté abierto.
- No se muestra corrección.
- Cada cambio se autoguarda.

### Finalización
- `Finalizar examen` antes de tiempo pide confirmación y muestra respondidas/blancas.
- Al llegar a 00:00 se entrega automáticamente.
- Las respuestas quedan bloqueadas.
- Se ejecuta corrección completa.

### Puntuación
Sea N el número de preguntas del conjunto puntuable definitivo:

- valor de acierto = `100 / N`
- penalización de error = `(100 / N) / 4`
- blanca = 0
- nota = `aciertos * valor_acierto - errores * penalización_error`

### Resultado
- nota / 100;
- aciertos;
- errores;
- blancas;
- tiempo empleado;
- nuevo récord personal, si corresponde;
- posición en el ranking de ese examen.

Acciones:
- Revisar examen;
- Repetir examen;
- Volver al inicio.

## 8. Exámenes artificiales

La app puede generar un test de 75 preguntas aleatorias procedentes de todo el banco de preguntas activas publicadas.

Pool elegible:
- preguntas ordinarias válidas;
- reservas que hayan sido incorporadas como activas en su examen;
- excluye anuladas;
- excluye reservas no utilizadas.

No se repite el mismo registro de pregunta dentro del mismo test.
No hay deduplicación semántica entre preguntas iguales de distintos exámenes.

### Artificial en modo estudio
Reutiliza todas las reglas de modo estudio.
No marca como finalizado ningún examen oficial.

### Artificial en modo examen
- 75 preguntas;
- 120 minutos;
- puntuación /100;
- penalización 1/4 por fallo;
- blancas no penalizan;
- se guarda en historial como `Examen artificial`;
- no participa en la clasificación específica de un examen oficial.

Sus aciertos/fallos/blancas actualizan `question_progress` de las preguntas de origen.

## 9. Navegación

Ambos modos:
- botones `Anterior` y `Siguiente`;
- navegador numerado;
- acceso directo a cualquier pregunta.

Estudio:
- pendiente;
- correcta;
- incorrecta.

Examen:
- pendiente;
- contestada;
- nunca revela acierto/error antes de entregar.

En móvil, el navegador numerado se presenta plegado/desplegable.

## 10. Tiempo

Se mantienen separadas tres métricas:

1. `activeStudyMs`: tiempo activo del modo estudio.
2. `examElapsedMs`: tiempo de cada simulación.
3. `totalActiveStudyMs`: suma histórica de tiempo activo de estudio.

No se mide tiempo por pregunta en v1.

## 11. Autoguardado y red

- Guardado continuo no bloqueante.
- Supabase recibe cada respuesta/cambio.
- En cortes breves, los cambios pendientes se guardan localmente y se reintentan.
- La app muestra `Sin conexión`.
- No es un modo offline completo.
- En examen el reloj sigue corriendo.
- La cola local debe poder sobrevivir a cierre accidental en el mismo dispositivo.

## 12. Usuarios

- Exactamente 3 cuentas.
- Email + contraseña.
- Creadas previamente.
- Sin registro público.
- Sesión persistente en dispositivos habituales.
- Progreso compartido entre PC y móvil mediante Supabase.

## 13. Historial

Se conserva todo:
- finalizados;
- incompletos/abandonados;
- estudio;
- examen;
- artificiales;
- sesiones de falladas.

Cada intento histórico es inmutable y revisable en solo lectura.

Campos visibles mínimos:
- fecha;
- origen/examen;
- modo;
- estado;
- aciertos;
- errores;
- blancas cuando aplique;
- tiempo;
- nota cuando aplique.

## 14. Estado de examen oficial

Por usuario:
- `Sin empezar`
- `En curso`
- `Finalizado`

`Finalizado` significa haber completado al menos una vez el examen oficial en estudio o examen.
Es un hito histórico permanente.
Se puede repetir infinitamente.

Un usuario puede mantener un recorrido de estudio activo y realizar simulaciones de examen independientes.

## 15. Dashboard compartido

No hay una puntuación global sintética.

Comparativas mínimas:
- respuestas realizadas;
- tasa de acierto;
- tiempo total activo de estudio;
- nota media de modo examen;
- mejor nota máxima;
- preguntas previamente falladas que han sido dominadas.

Los datos de otros usuarios se exponen solo de forma agregada.

### Ranking por examen
Para cada examen oficial:
1. mayor mejor nota histórica;
2. empate → menor tiempo de ese intento.

Puede mostrar además número de intentos.

## 16. Estadísticas por pregunta

Sin tiempo por pregunta.

Por usuario:
- veces respondida;
- aciertos;
- errores;
- tasa de acierto;
- racha de aciertos consecutivos;
- pendiente/dominada.

Compartido:
- número de fallos acumulados entre los tres;
- posibilidad de detectar preguntas falladas por los tres.

## 17. Estadísticas por examen

Por usuario:
- intentos totales;
- intentos completados;
- mejor nota;
- nota media;
- mejor tiempo;
- tasa global de acierto;
- falladas pendientes;
- dominadas;
- tiempo total activo dedicado;
- último intento.

## 18. Home

Cada examen muestra:
- nombre;
- número de preguntas del conjunto activo;
- duración oficial;
- estado personal;
- progreso activo si existe;
- mejor nota;
- falladas pendientes.

Acciones:
- Estudiar;
- Hacer examen;
- Continuar;
- Ver resultados.

Accesos independientes:
- Examen artificial;
- Todas mis falladas;
- Dashboard/Clasificación;
- Historial.

## 19. Modelo de datos Supabase

### profiles
- id
- display_name
- display_order
- created_at

### study_progress
Un único recorrido principal activo por usuario/examen.
- id
- user_id
- exam_id
- exam_version
- strategy: normal | random
- queue
- cursor
- active_study_ms
- updated_at

### attempts
- id
- user_id
- source_type: official | artificial | failed_session
- exam_id nullable
- exam_version nullable
- mode: study | exam
- strategy nullable
- status: active | completed | abandoned | expired
- started_at
- deadline_at nullable
- finished_at nullable
- active_study_ms nullable
- exam_elapsed_ms nullable
- correct_count
- incorrect_count
- blank_count
- score nullable
- question_queue
- created_at

### attempt_answers
- id
- attempt_id
- question_ref
- selected_option nullable
- result: correct | incorrect | blank | pending
- confirmed_at nullable
- updated_at

### question_progress
- user_id
- question_ref
- total_answers
- correct_count
- incorrect_count
- consecutive_correct
- mastery_state: never_failed | pending | mastered
- updated_at

No se necesitan tablas de estadísticas derivadas: se calculan mediante vistas/consultas.

## 20. Importación PDF → JSON

### Flujo de v1
1. PDF se sube al repositorio.
2. GitHub Action detecta el cambio.
3. Parser extrae metadatos, preguntas, opciones, plantilla definitiva, anuladas, reservas y duración.
4. Genera JSON canónico versionado.
5. Ejecuta validaciones.
6. Genera informe QA.
7. La automatización prepara una rama/PR de importación.
8. Una persona revisa JSON + QA.
9. Merge a `main` = aprobación.
10. Workflow de deploy publica GitHub Pages.

### Validaciones bloqueantes
- ausencia de plantilla oficial;
- pregunta sin las opciones esperadas;
- respuesta oficial inexistente;
- numeración o recuento incompatible;
- anuladas/reservas irresolubles;
- duplicados estructurales;
- JSON fuera de esquema.

### Incidencias no bloqueantes
Errores o fragmentos sospechosos de maquetación se señalan en QA y requieren revisión humana antes del merge.

El parser nunca modifica silenciosamente el contenido oficial.

## 21. PWA

- responsive;
- instalable en móvil y PC;
- URL única;
- manifest + service worker;
- cache del shell de la app;
- no se promete offline completo;
- actualización de versión visible/reload seguro cuando se despliega contenido nuevo.

## 22. Seguridad

- clave pública/anónima de Supabase permitida en frontend;
- nunca service-role key;
- RLS en todas las tablas expuestas;
- cada usuario modifica solo datos propios;
- el dashboard usa una vista/RPC agregada sin dar acceso a respuestas crudas de otros;
- sin registro público;
- JSON de preguntas/respuestas es deliberadamente público.

## 23. Criterios de aceptación v1

La v1 no se considera lista hasta que:

1. Los 12 PDF iniciales pasan por el importador y QA.
2. Todos los exámenes publicados tienen respuestas oficiales verificadas.
3. Se puede completar un examen oficial en estudio normal.
4. Se puede completar en aleatorio sin repeticiones.
5. Se puede pausar/reanudar el estudio desde otro dispositivo.
6. Corrección inmediata funciona y bloquea la respuesta.
7. Falladas requieren 2 aciertos consecutivos para dominarse.
8. `Todas mis falladas` funciona entre exámenes.
9. El modo examen mantiene reloj absoluto y autoentrega.
10. La nota respeta la penalización de 1/4.
11. El historial reproduce intentos anteriores.
12. El dashboard compara los tres usuarios.
13. El ranking por examen desempata por tiempo.
14. El examen artificial funciona en estudio y examen.
15. La PWA se instala en móvil y PC.
16. Un corte breve de red no pierde respuestas.
17. Un usuario no puede modificar datos de otro mediante la API.
18. Un examen nuevo no llega a producción sin QA y aprobación humana.

## 24. Orden recomendado de implementación

1. Generalizar y validar parser contra los 12 PDF.
2. Cerrar esquema JSON y versionado.
3. Crear Supabase: Auth + 5 tablas + RLS.
4. Construir shell PWA y login.
5. Home + catálogo.
6. Modo estudio normal.
7. Aleatorio + persistencia.
8. Falladas + dominio.
9. Modo examen + scoring + reloj absoluto.
10. Historial y revisión.
11. Dashboard y rankings.
12. Examen artificial.
13. GitHub Actions: import PR + deploy.
14. PWA/install + tolerancia de red.
15. QA integral en móvil y PC.

## 25. Inputs operativos necesarios al comenzar implementación

No son decisiones de producto pendientes:
- nombres/correos de las 3 cuentas;
- credenciales/configuración del proyecto Supabase;
- repositorio GitHub definitivo y permisos de push;
- restaurar acceso de escritura al workspace/VPS si se va a trabajar desde KairOS;
- elección visual mínima: nombre visible, icono y colores.

No quedan preguntas funcionales necesarias para comenzar la implementación.
