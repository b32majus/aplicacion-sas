# CONTEXT — Aplicación SAS

Glosario canónico de producto. Este documento define el lenguaje compartido de la aplicación; la especificación completa vive en `aplicacion-sas-SPEC-v1.md`.

## Examen oficial
Cuestionario procedente de un PDF oficial del SAS. La app lo presenta como un único examen, independientemente de que el documento original diferencie teoría y práctica.

## Pregunta ordinaria
Pregunta puntuable identificada por su numeración original en el PDF.

## Pregunta anulada
Pregunta que la plantilla definitiva marca como anulada. No se muestra ni se puntúa. Su ausencia deja visible el salto de numeración original.

## Pregunta de reserva
Pregunta oficial de reserva, normalmente numerada 151, 152, 153… Internamente conserva ese número original. Cuando se utiliza para completar el conjunto puntuable definitivo se muestra al usuario al final como `R1`, `R2`, `R3`…

## Conjunto puntuable definitivo
Conjunto de preguntas que la aplicación utiliza para estudiar y simular un examen tras aplicar únicamente anulaciones y reservas justificadas por la documentación oficial.

## Modo estudio
Uso flexible del banco de preguntas. Tiene cronómetro ascendente de tiempo activo, corrección inmediata tras confirmar la respuesta, pausa/reanudación y no calcula nota de oposición.

## Recorrido principal de estudio
Recorrido activo de un examen oficial en `Orden normal` o `Orden aleatorio`. Solo puede existir uno por usuario y examen.

## Orden normal
Recorrido de estudio que respeta el orden del cuestionario oficial.

## Orden aleatorio
Recorrido de estudio que baraja una sola vez todas las preguntas del examen, sin repetirlas antes de completar el recorrido. El orden queda persistido para poder reanudar.

## Falladas pendientes
Preguntas que el usuario debe volver a trabajar porque las ha fallado o las ha dejado en blanco en modo examen.

## Pregunta dominada
Pregunta que había entrado en `Falladas pendientes` y después ha alcanzado dos aciertos consecutivos. Cualquier nuevo fallo reinicia la racha a cero.

## Sesión de falladas
Sesión de estudio independiente del recorrido principal. Puede incluir las falladas de un examen o `Todas mis falladas`. Una pregunta aparece como máximo una vez por sesión.

## Todas mis falladas
Sesión que mezcla aleatoriamente las preguntas pendientes de dominar procedentes de todos los exámenes.

## Modo examen
Simulación cronometrada. Utiliza la duración oficial del examen, no muestra corrección durante la prueba, permite navegar y cambiar respuestas hasta la entrega y calcula nota sobre 100.

## Intento
Ejecución histórica de una sesión de estudio o de un examen. Puede estar activo, finalizado o incompleto/abandonado.

## Examen finalizado
Hito histórico del usuario: ha completado al menos una vez el examen oficial en modo estudio o modo examen. El examen puede repetirse indefinidamente.

## Examen artificial
Cuestionario de 75 preguntas seleccionadas aleatoriamente del conjunto de preguntas activas publicadas de todos los exámenes. Puede ejecutarse en modo estudio o modo examen. No marca como finalizado ningún examen oficial.

## Tiempo activo de estudio
Tiempo acumulado durante el uso activo del modo estudio. Se pausa cuando el estudio se pausa o la app deja de estar activa.

## Tiempo de examen
Tiempo transcurrido de una simulación. El reloj es absoluto y no se pausa al cerrar la app o dejarla en segundo plano.

## Tiempo total de estudio
Suma histórica del tiempo activo de estudio de un usuario. Se mantiene separado del tiempo empleado en simulaciones.

## Historial
Registro inmutable de todos los intentos, incluidos los incompletos, con posibilidad de revisión posterior en solo lectura.

## Dashboard compartido
Vista agregada que permite a los tres usuarios comparar rendimiento y actividad sin exponer el detalle completo de respuestas de los demás.

## Ranking por examen
Clasificación basada en la mejor nota histórica de cada usuario en un examen oficial; en empate, gana el menor tiempo empleado.

## Banco de exámenes
JSON estáticos versionados que contienen preguntas, opciones, respuestas oficiales y metadatos de origen. No se duplican en Supabase.

## QA de importación
Validaciones automáticas y revisión humana que deben superarse antes de publicar un examen nuevo.

## Pregunta activa
Pregunta válida que forma parte del conjunto utilizable de la app. Excluye anuladas y reservas no utilizadas.
