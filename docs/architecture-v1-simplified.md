# Arquitectura v1 simplificada — Aplicación SAS

Fecha: 2026-08-05
Estado: decisión de arquitectura vigente
Sustituye: `architecture-v0.md`

## 1. Principio de diseño

Resolver el problema con el menor número posible de piezas:

1. GitHub conserva el código, los PDF fuente y los JSON generados.
2. GitHub Actions automatiza importación, validación y despliegue.
3. GitHub Pages publica la aplicación estática.
4. Supabase almacena únicamente identidad, sesiones y respuestas.
5. La "competición" es una comparativa acumulada, no una partida sincronizada.

No se utilizarán XLSX/CSV como paso intermedio obligatorio, ni salas, lobby, códigos de invitación o Supabase Realtime en la primera versión.

## 2. Flujo directo PDF -> JSON

### Entrada administrativa

El alta inicial de un examen se hace subiendo uno o varios PDF a:

```text
data/source-pdfs/inbox/
```

La interfaz de administración inicial será la propia pantalla de GitHub:

```text
Add file -> Upload files -> Commit changes
```

No se construye todavía un botón de subida dentro de la aplicación pública. Hacerlo obligaría a añadir autenticación administrativa, almacenamiento temporal y una función segura con permisos de escritura sobre GitHub o Supabase.

### Automatización

Un workflow de GitHub Actions, activado al cambiar `data/source-pdfs/**`, ejecutará:

1. detección de PDF nuevos o modificados;
2. extracción de texto y estructura;
3. lectura de la plantilla de respuestas oficial;
4. normalización de preguntas y opciones;
5. generación del JSON canónico;
6. validación automática;
7. actualización de `exams-manifest.json`;
8. commit de los JSON generados;
9. activación del despliegue de GitHub Pages.

Flujo final:

```text
PDF subido a GitHub
        ↓
GitHub Action
        ↓
parser Python
        ↓
validación
        ↓
JSON + catálogo
        ↓
GitHub Pages
```

### Qué significa "automático"

La conversión puede automatizarse por completo si los PDF tienen texto seleccionable y una maquetación suficientemente estable.

El parser no debe asumir silenciosamente que todo está bien. Debe detener la publicación o marcar revisión cuando detecte, por ejemplo:

- número inesperado de preguntas;
- pregunta sin opciones;
- respuesta oficial inexistente;
- dos respuestas oficiales para una misma pregunta;
- numeración duplicada o incompleta;
- texto extraído con baja confianza;
- tablas o imágenes no capturadas.

El resultado válido se publica. El resultado dudoso genera un informe de validación y no entra silenciosamente en producción.

### PDF escaneados

Si algún PDF no contiene capa de texto, el flujo necesitará OCR o un adaptador específico. Esta decisión se toma después de inspeccionar el primer lote real; no se añade OCR preventivamente.

## 3. Formato canónico del examen

Cada examen genera un archivo:

```text
app/public/data/exams/<exam-id>.json
```

Estructura conceptual:

```json
{
  "schemaVersion": "1.0",
  "id": "sas-enfermeria-2024",
  "title": "SAS Enfermería 2024",
  "category": "Enfermería",
  "year": 2024,
  "source": {
    "questionPdf": "sas-enfermeria-2024.pdf",
    "answersPdf": "sas-enfermeria-2024-respuestas.pdf",
    "sha256": "..."
  },
  "questions": [
    {
      "id": "sas-enfermeria-2024-q001",
      "number": 1,
      "text": "Texto de la pregunta",
      "options": [
        { "id": "A", "text": "Opción A" },
        { "id": "B", "text": "Opción B" },
        { "id": "C", "text": "Opción C" },
        { "id": "D", "text": "Opción D" }
      ],
      "correctOption": "B",
      "status": "valid",
      "topic": null,
      "sourcePage": 3
    }
  ]
}
```

El esquema formal estará en `schemas/exam.schema.json`.

## 4. Papel real de GitHub

### Repositorio

GitHub es el almacenamiento persistente y versionado de:

- código de la aplicación;
- PDF fuente;
- parser;
- JSON generados;
- catálogo de exámenes;
- historial de correcciones.

### GitHub Actions

GitHub Actions se utiliza como motor de automatización, no como base de datos:

- convertir PDF a JSON;
- validar estructura y respuestas;
- ejecutar pruebas;
- regenerar catálogo;
- desplegar GitHub Pages;
- producir informes temporales de validación.

Los artifacts de Actions pueden contener informes y archivos de diagnóstico, pero no serán la fuente canónica porque caducan. Los datos permanentes se guardan mediante commit en el repositorio o en Supabase.

### GitHub Pages

Publica únicamente los archivos estáticos de la aplicación. No guarda respuestas de usuarios.

### Visibilidad del repositorio

Si los PDF pueden distribuirse públicamente, todo puede vivir en un repositorio público.

Si los PDF no deben quedar accesibles, el repositorio debe ser privado y solo se publicará el resultado necesario en Pages. La visibilidad y los derechos de redistribución deben decidirse antes de subir los PDF, porque un archivo subido a un repositorio público queda expuesto y también permanece en el historial de Git.

## 5. Aplicación web

Tecnología:

- HTML;
- CSS;
- JavaScript modular;
- Vite solo como empaquetador y servidor local de desarrollo.

No se necesita React, Next.js ni backend propio.

Funciones iniciales:

- elegir examen;
- responder preguntas;
- navegar entre preguntas;
- ver preguntas pendientes;
- medir tiempo de sesión;
- medir tiempo de respuesta;
- corregir;
- guardar respuestas;
- consultar evolución y comparativa.

## 6. Competición simplificada

No existe una "partida" ni una sala.

Hay tres participantes identificados y una pantalla comparativa que muestra:

- tiempo activo acumulado;
- sesiones realizadas;
- preguntas respondidas;
- preguntas únicas trabajadas;
- aciertos;
- errores;
- tasa de acierto;
- tiempo medio por pregunta;
- evolución por semana;
- preguntas con más fallos;
- temas con más fallos;
- comparativa entre los tres.

La pantalla puede refrescar al abrirse o cada cierto intervalo. No necesita tiempo real estricto.

## 7. Backend mínimo en Supabase

### Autenticación

Como son tres participantes estables y el progreso debe sobrevivir a cambios de navegador o dispositivo, se usarán tres cuentas persistentes de Supabase Auth.

Opciones válidas:

- correo + contraseña;
- enlace mágico por correo.

No se recomienda autenticación anónima para este caso porque la identidad puede perderse al borrar datos del navegador o cambiar de dispositivo.

### Tablas mínimas

#### `profiles`

```text
id              uuid, referencia a auth.users
alias           text
display_order   integer
created_at      timestamptz
```

#### `study_sessions`

```text
id              uuid
user_id         uuid
exam_id         text
mode            text
started_at      timestamptz
ended_at        timestamptz
active_ms       bigint
completed       boolean
```

#### `question_responses`

```text
id              uuid
session_id      uuid
user_id         uuid
exam_id         text
question_id     text
topic_snapshot  text
selected_option text
is_correct      boolean
response_ms     integer
answered_at     timestamptz
```

No se necesitan tablas de competición.

### Vistas estadísticas

Las estadísticas se calculan mediante vistas SQL:

- `participant_summary`;
- `question_statistics`;
- `topic_statistics`;
- `weekly_progress`.

Esto evita almacenar resultados agregados redundantes.

### Seguridad

- Row Level Security en todas las tablas expuestas.
- Cada usuario solo inserta o modifica sus sesiones y respuestas.
- Los tres usuarios pueden consultar las vistas agregadas necesarias para la comparativa.
- La clave `service_role` nunca entra en el navegador.

## 8. Cronometraje

Se almacenan dos tiempos distintos:

1. `active_ms` de la sesión: tiempo real de estudio, pausando cuando la sesión queda inactiva según la regla definida.
2. `response_ms`: tiempo dedicado a cada respuesta.

Así se evita confundir "tener la pestaña abierta" con tiempo efectivo de preparación.

La regla concreta de pausa automática debe definirse durante la implementación, por ejemplo al ocultarse la pestaña o tras un periodo sin interacción.

## 9. Temáticas

El PDF probablemente no contiene una categoría temática fiable para cada pregunta.

Primera versión:

- `topic` puede quedar en `null`;
- se generan estadísticas por examen y pregunta desde el primer día.

Fase posterior:

- clasificación manual;
- reglas por bloques;
- clasificación asistida por IA;
- revisión humana antes de publicar la etiqueta.

No se bloquea el MVP por no disponer todavía de temáticas.

## 10. Workflows previstos

### `import-exams.yml`

Trigger:

```text
push sobre data/source-pdfs/**
workflow_dispatch para reejecución manual
```

Responsabilidades:

- instalar Python;
- ejecutar parser;
- validar contra JSON Schema;
- generar informe;
- actualizar JSON y manifest;
- hacer commit si hay cambios.

El workflow solo escucha cambios en PDF, por lo que el commit del JSON generado no crea un bucle.

### `deploy-pages.yml`

Trigger:

```text
push sobre app/** o JSON generados
```

Responsabilidades:

- instalar dependencias;
- ejecutar tests;
- construir aplicación;
- desplegar Pages.

## 11. Estructura del proyecto

```text
aplicacion-sas/
├── .github/
│   └── workflows/
│       ├── import-exams.yml
│       └── deploy-pages.yml
├── app/
│   ├── index.html
│   ├── src/
│   └── public/
│       └── data/
│           ├── exams/
│           └── exams-manifest.json
├── data/
│   └── source-pdfs/
│       └── inbox/
├── schemas/
│   └── exam.schema.json
├── scripts/
│   ├── import_exam.py
│   ├── validate_exams.py
│   └── build_manifest.py
├── supabase/
│   └── migrations/
└── docs/
```

## 12. Orden de construcción

1. Inspeccionar uno de los PDF reales y confirmar si tiene capa de texto.
2. Cerrar el esquema JSON.
3. Construir el parser para ese patrón documental.
4. Validar un examen completo de 150 preguntas.
5. Generalizar el parser a los otros 11 PDF.
6. Construir el modo individual sin Supabase.
7. Crear las tres tablas y vistas en Supabase.
8. Añadir cuentas y comparativa acumulada.
9. Automatizar importación y despliegue con Actions.

## 13. Decisión final

```text
PDF -> GitHub -> Action -> JSON -> GitHub Pages
                                  |
                                  └-> Supabase solo para progreso
```

Esta es la arquitectura de referencia mientras los PDF reales no revelen una limitación material de extracción.
