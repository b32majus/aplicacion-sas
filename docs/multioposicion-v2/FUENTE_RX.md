# Fuente Radiodiagnóstico — inventario preliminar del PDF aportado

**Origen:** archivo de usuario `EXAMENES RX(1).pdf`, enlace Adobe compartido en conversación (no introducir URL con permisos privados en publicación).
**Observado sobre el archivo adjunto en ChatGPT:** 353 páginas A4, aprox. 23,9 MB, SHA-256 `5e5c65f056386f37fa6fb7903d89c866a72c4547f28434eb3caa6db5c0a5118e`.
**IMPORTANTE:** este hash corresponde al adjunto inspeccionado localmente; NO se ha verificado todavía una copia idéntica dentro del VPS. El documento original no se commitea al repositorio público.

## Segmentación preliminar (páginas físicas del PDF combinado)

| Págs. | Identidad provisional según portada | Contenido y observaciones |
| --- | --- | --- |
| **1–33** | 2015 · Turno libre | Cuestionario teórico 100 + práctico 50, reservas 151–153 y plantilla pág. 33. |
| **34–66** | 2015 · Promoción interna | Estructura 100+50, respuestas pág. 66. |
| **67–99** | OEP 2016/2017, estabilización · Libre | 100+50 y plantilla definitiva pág. 99; comprobar convocatoria/año exacto en fuente. |
| **100–132** | OEP 2016/2017, estabilización · Promoción interna | Plantilla definitiva pág. 132. |
| **133–185** | 2021 · Libre | Preguntas 133–168, **cuadernillo visual 169–184** (casos prácticos 1/2/4, imágenes 1–24), plantilla pág. 185. |
| **186–239** | 2021 · Libre **aplazado** | Preguntas 186–221, **cuadernillo visual 222–238**, plantilla pág. 239. |
| **240–288** | 2021 · Promoción interna | Preguntas 240–271, **cuadernillo visual 272–287**, plantilla pág. 288. |
| **289–309** | 2023 · Libre | Prueba única 75 y reservas, plantilla definitiva pág. 309. |
| **310–331** | 2025 · Libre | Prueba única 75 y reservas, plantilla definitiva pág. 331. |
| **332–353** | 2025 · Promoción interna | Prueba única 75 y reservas, plantilla definitiva pág. 353. |

El inventario identifica **10 bloques de examen** en el PDF, pero **NO significa 10 paquetes publicables** hasta revisar manualmente integridad de texto/opciones, plantilla, anulaciones y páginas visuales.

## Evidencia visual y criterio de extracción

- Las páginas **169–184**, **222–238** y **272–287** son cuadernillos separados de imágenes (no mero texto). Por ejemplo, pág. 174 identifica caso práctico 2 con las imágenes 6 y 7; pág. 229 incluye las imágenes 8 y 9 del caso práctico 2. Son referencias de casos, no se debe asignar imágenes a preguntas basándose sólo en proximidad de página.
- Extraer los recortes visuales con fidelidad de escala y contraste; conservar correspondencia con el caso y los números `IMAGEN` impresos. No diagnosticar ni generar imágenes nuevas; usar las originales del material de examen.
- Cada imagen lleva hash SHA, procedencia (página física del combinado + número impreso) y declaración de derechos/fuente.
- Las relaciones caso->preguntas->imágenes se confirman **manualmente** leyendo el enunciado completo, no con una regla automática de agrupación.
- Un caso con múltiples imágenes debe mantener el orden oficial y permitir inspección ampliada. La vista previa nunca sustituye la imagen original para decidir respuestas.
- Plantilla definitiva es la fuente de respuesta. Anuladas/reservas: sustitución en orden; exceso de anuladas reduce el conjunto efectivo, normalizado al nominal, con revisión manual de la plantilla. Advertencias no críticas no bloquean si no afectan identidad/respuesta.
- Para 2023 y 2025 se debe contrastar la duración y puntuación nominal de su propia portada, no copiar siempre los 180 minutos de 2015/2021.

## Carpeta privada de fuente esperada en VPS (pendiente de entrega)

Propuesta: `/srv/kairos-lab/projects/aplicacion-sas/private-sources/rx/EXAMENES_RX.pdf` fuera del repo Git, con permisos limitados; verificar SHA-256 y 353 páginas tras su copia. **No afirmar que el adjunto del chat está allí**: requiere transferencia explícita. Nunca añadir el PDF a `app/public`, `dist` ni al historial Git.

## Protocolo de autoría de cada examen

1. Separar lógicamente cuadernillo, imágenes y plantilla según tabla anterior.
2. Preparar JSON canónico y sidecar de fuente manualmente/asistido; conservar IDs estables por examen+número fuente.
3. Anotar para cada pregunta si depende de caso/imágenes y sus refs exactos.
4. Verificar todas las opciones, solución definitiva, anuladas, reservas y puntuables.
5. Ejecutar validadores, hashes y QA sin dar por publicable un texto/imagen faltante.
6. Un PR de publicación muestra inventario, muestras visuales, conteos y artefactos inmutables. Revisión humana y SQL de registro administrado por separado.

**Para la unidad M03:** escoger un examen de 2021 con casos radiológicos y al menos una pregunta visual como tracer bullet; NO publicar los diez de golpe antes de confirmar el visor e historial.
