# Piloto de importación - Examen SAS Administrativo/a 2023

Fecha de análisis: 2026-08-05
Fuente: `Examen_ADM_L_2023.pdf`
SHA-256: `837277c67df08acf1df1f708d29d781585551b063e65c3987a0bc002e98a72a5`

## Resultado

- PDF de 21 páginas con capa de texto utilizable; no requiere OCR.
- La plantilla definitiva de respuestas está incluida en la página 21.
- Se han extraído 78 preguntas: 75 ordinarias y 3 de reserva (151-153).
- La pregunta 59 figura como anulada en la plantilla oficial.
- Todas las preguntas extraídas tienen cuatro opciones A-D.
- Todas las preguntas no anuladas tienen respuesta oficial asociada.
- Duración indicada en el cuadernillo: 2 horas.
- Penalización indicada: cada error resta 1/4 del valor de un acierto.

## Incidencia detectada

La pregunta 35 contiene en el PDF un fragmento aparentemente desplazado: `sancionadoras.` después de la opción C. El parser conserva el texto original y genera una incidencia para revisión humana; no corrige silenciosamente el documento fuente.

## Decisión derivada

El importador no debe asumir 150 preguntas por examen. Debe:

1. detectar la plantilla oficial;
2. usar sus números como conjunto esperado;
3. extraer las preguntas correspondientes;
4. validar opciones y cobertura de respuestas;
5. distinguir preguntas ordinarias, de reserva y anuladas;
6. emitir un informe de incidencias antes del despliegue.

## Implementación

Se ha creado `scripts/parse_sas_exam.py`, que genera:

- JSON canónico del examen;
- informe QA en Markdown;
- hash SHA-256 de trazabilidad;
- fallo explícito si preguntas y plantilla oficial no coinciden.

La Action de GitHub deberá ejecutar este parser al detectar un PDF nuevo y bloquear el despliegue cuando fallen las validaciones estructurales.
