# Auditoría final del grill — Aplicación SAS

## Resultado

Diseño funcional suficientemente cerrado para pasar a especificación/implementación.
No se requieren más preguntas de producto antes de comenzar.

## Contradicciones detectadas y corregidas

### 1. “Un intento activo por examen” era demasiado amplio
Las decisiones posteriores separaron correctamente:
- un recorrido principal de estudio activo por usuario/examen;
- una sesión de falladas activa por usuario;
- un examen cronometrado activo por usuario;
- historial ilimitado.

La SPEC usa esta definición final.

### 2. Tiempo por pregunta
Una decisión temprana lo incluía en las estadísticas, pero posteriormente se descartó para reducir complejidad.
La SPEC elimina completamente el tiempo por pregunta y cualquier ranking derivado de él.

### 3. Sesiones de falladas vs progreso principal
Una redacción anterior trataba las falladas como parte del progreso principal.
La versión final las trata como sesiones independientes, tal como se decidió después.

### 4. Anuladas y reservas
La decisión inicial de eliminar anuladas sin reservas fue corregida.
La versión final:
- oculta anuladas;
- conserva saltos de numeración;
- añade reservas necesarias como R1/R2/R3;
- conserva sus números originales internamente;
- bloquea publicación si la sustitución no puede justificarse.

### 5. Examen artificial en estudio
En modo estudio no existen “blancas” al finalizar: una pregunta saltada sigue pendiente hasta responderse.
La SPEC elimina esa ambigüedad.

### 6. Pool del examen artificial
Queda limitado a preguntas activas publicadas.
No incluye anuladas ni reservas no utilizadas.

## Riesgos técnicos detectados antes de implementar

### A. El parser piloto NO es todavía general
Se ejecutó el parser actual contra los 12 PDF disponibles:
- funciona de extremo a extremo con `Examen_ADM_L_2023.pdf`;
- falla inicialmente en los otros 11 al localizar la plantilla de respuestas.

La causa inmediata es que las plantillas antiguas y nuevas usan encabezados diferentes:
- algunas solo muestran tablas `Orden / Respuesta`;
- 2018 utiliza `ANEXO II`;
- 2025 usa `Planilla de Respuestas DEFINITIVA`;
- 2023 usa `Plantilla de Respuestas DEFINITIVA`.

Además, la maquetación de preguntas de 2018 difiere de otros años.

Conclusión: el primer trabajo de implementación debe ser generalizar el importador y hacerlo pasar por los 12 PDF antes de construir el frontend sobre datos incompletos.

### B. Hay casos reales complejos de anulaciones
El conjunto de PDF contiene exámenes con varias anuladas y solo tres reservas declaradas. Por tanto, la regla de “no inventar y forzar revisión humana” no es teórica: es necesaria.

### C. Historial y correcciones futuras
Si un JSON publicado se corrige en el futuro, un intento histórico no puede reinterpretarse con el contenido nuevo.
Por eso la SPEC añade `examVersion` y conserva versiones antiguas del JSON.

### D. PWA + datos en red
No se debe vender como offline.
La tolerancia a cortes breves requiere una cola local pequeña (por ejemplo IndexedDB/local storage), pero no sincronización offline completa.

## Decisiones técnicas que no requieren otra entrevista

- GitHub Action de importación debe preparar un PR; el merge humano constituye la aprobación.
- Merge a `main` puede activar el deploy de GitHub Pages.
- Estadísticas compartidas se exponen mediante vista/RPC agregada; no mediante acceso a filas crudas de otros usuarios.
- El historial referencia la versión exacta del examen.
- Las estadísticas derivadas se calculan, no se almacenan en tablas adicionales.

## Estado del grill

CERRADO.

Siguiente paso recomendado:
`SPEC v1 -> tareas de implementación -> implementación incremental`.
