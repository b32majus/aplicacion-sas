# Arquitectura v0 — Aplicación SAS

Fecha: 2026-08-05
Estado: sustituida por `architecture-v1-simplified.md` el 2026-08-05

## 1. Objetivo

Construir una herramienta web sencilla de mantener y barata de operar para preparar oposiciones del SAS, con práctica individual, seguimiento longitudinal y competición online entre tres participantes.

La arquitectura debe minimizar infraestructura sin sacrificar trazabilidad de resultados ni bloquear futuras ampliaciones.

## 2. Decisión principal

Usar una arquitectura híbrida:

1. Aplicación estática en GitHub Pages.
2. Banco de preguntas servido como JSON estático y versionado.
3. Supabase como backend gestionado para usuarios, intentos, respuestas, estadísticas y competición en tiempo real.

No se necesita un servidor tradicional propio.

## 3. Frontend

Tecnología:

- HTML semántico.
- CSS nativo.
- JavaScript modular.
- Vite como herramienta mínima de desarrollo y compilación.

Vite no introduce un framework: la aplicación sigue siendo HTML, CSS y JavaScript. Facilita módulos, variables de entorno, pruebas locales y despliegue reproducible en GitHub Pages.

Estructura prevista:

```text
app/
  index.html
  src/
    app.js
    router.js
    services/
    modules/
      exams/
      attempts/
      statistics/
      competition/
    styles/
  public/
    data/
      exams/
      exams-manifest.json
```

## 4. Formato de los exámenes

### Formato canónico de ejecución: JSON

JSON es el formato adecuado para que la aplicación cargue y valide preguntas de forma directa. Permite representar de manera inequívoca:

- identificador estable de examen y pregunta;
- texto de la pregunta;
- número original;
- opciones de respuesta;
- respuesta oficial;
- pregunta anulada o de reserva;
- tema o categoría futura;
- página y documento de origen;
- versión y correcciones posteriores.

Markdown es útil para documentación, pero es peor como fuente estructurada. PDF debe conservarse como fuente original, no utilizarse directamente en tiempo de ejecución.

### Formato humano de importación: XLSX o CSV

Para añadir o revisar exámenes, el formato más práctico será una plantilla tabular con una fila por pregunta. Un script validará la plantilla y generará el JSON canónico.

Columnas iniciales:

```text
exam_id
exam_title
exam_date
question_number
question_text
option_a
option_b
option_c
option_d
official_answer
status
topic
source_page
notes
```

Flujo:

```text
PDF original -> extracción/revisión -> XLSX validado -> JSON canónico -> aplicación
```

Esto separa el formato cómodo para personas del formato fiable para la aplicación.

## 5. Datos estáticos y datos dinámicos

### En GitHub Pages / repositorio

- metadatos de los exámenes;
- preguntas y opciones;
- respuestas oficiales en la versión inicial basada en confianza;
- recursos visuales;
- historial de cambios del banco de preguntas.

### En Supabase

- identidad o sesión de usuario;
- perfil y alias;
- intentos de examen;
- respuesta seleccionada por pregunta;
- acierto o error;
- tiempo por pregunta, por intento y acumulado;
- puntuación;
- salas y participantes de competición;
- estado de la partida y clasificación.

No se duplicará inicialmente todo el banco de preguntas en la base de datos. La base almacenará `exam_id` y `question_id`, que apuntan al contenido estático versionado.

## 6. Modelo de datos inicial

### profiles

- id
- nickname
- created_at
- updated_at

### attempts

- id
- user_id
- exam_id
- mode: practice | exam | competition
- status: in_progress | completed | abandoned
- started_at
- finished_at
- duration_ms
- total_questions
- correct_count
- incorrect_count
- unanswered_count
- score
- competition_id, opcional

### attempt_answers

- id
- attempt_id
- exam_id
- question_id
- selected_option
- is_correct
- response_time_ms
- answered_at

### competitions

- id
- room_code
- host_user_id
- exam_id
- status: lobby | ready | running | finished | cancelled
- created_at
- started_at
- finished_at
- configuration, JSON

### competition_members

- competition_id
- user_id
- nickname_snapshot
- ready
- attempt_id
- joined_at
- finished_at

Las estadísticas agregadas se calcularán inicialmente mediante consultas o vistas. No conviene almacenar tablas de estadísticas derivadas hasta que haya un problema real de rendimiento.

## 7. Modo competición v0

Flujo propuesto:

1. Una persona crea una sala y elige examen.
2. La aplicación genera un código corto.
3. Hasta dos personas adicionales se unen con el código.
4. Cada participante marca que está preparado.
5. La persona anfitriona inicia el examen.
6. Los tres reciben el mismo instante de inicio.
7. Cada respuesta y su tiempo se registra.
8. La clasificación se actualiza al terminar.
9. Orden: mayor puntuación y, en caso de empate, menor tiempo total.

Supabase Realtime se utilizará para lobby, presencia, cambios de estado y clasificación.

## 8. Autenticación

Para reducir fricción, la primera versión puede usar usuarios anónimos de Supabase más un alias. Esto proporciona un identificador real para aplicar políticas de seguridad sin obligar a crear contraseña.

Limitación: el historial queda ligado al dispositivo o sesión. Una fase posterior puede permitir convertir la cuenta anónima en una cuenta con correo o enlace mágico.

## 9. Seguridad y límites

### Respuestas oficiales visibles

Si las respuestas correctas se incluyen en el JSON público, una persona con conocimientos técnicos puede inspeccionarlas. Para una competición amistosa basada en confianza, esto simplifica mucho el MVP.

Si se necesita una competición resistente a trampas:

- el JSON público contendrá solo preguntas y opciones;
- las respuestas oficiales se cargarán en una tabla no consultable directamente;
- una función SQL o Edge Function realizará la corrección;
- el cliente recibirá el resultado permitido, no la clave completa.

Esta protección puede incorporarse sin sustituir el frontend ni el modelo general.

### Supabase

Todas las tablas expuestas deberán tener Row Level Security. Cada participante solo podrá modificar sus propios intentos y respuestas. El acceso compartido se limitará a miembros de la misma competición.

La clave de servicio nunca se incluirá en el frontend. Solo se utilizará la clave pública con políticas RLS.

## 10. Por qué Supabase y no las alternativas iniciales

### Supabase — recomendado

- PostgreSQL encaja naturalmente con intentos, preguntas, usuarios y estadísticas.
- Autenticación, políticas por fila y tiempo real están integrados.
- Es sencillo exportar y consultar los datos con SQL.
- Permite evolucionar hacia funciones de corrección protegida sin desplegar un servidor completo.

### Firebase — válido, pero segunda opción

Firebase también resuelve autenticación y sincronización en tiempo real. Sin embargo, para este caso el modelo relacional y las consultas estadísticas son más naturales en PostgreSQL que en una base documental.

### Google Drive / Sheets — no recomendado como backend

Puede servir como plantilla de carga o revisión, pero no como base operativa para respuestas concurrentes, permisos por usuario, consistencia de intentos y competición en tiempo real.

### GitHub — solo frontend y contenido

GitHub Pages aloja la aplicación estática. No debe utilizarse como mecanismo de escritura de puntuaciones o estado de usuarios desde el navegador.

## 11. Fases propuestas

### Fase 0 — definición e importación

- cerrar formato de examen;
- revisar los 12 PDF;
- crear plantilla XLSX;
- desarrollar validador y conversor a JSON;
- importar un examen piloto.

### Fase 1 — modo individual sin backend

- catálogo de exámenes;
- realización del examen;
- navegación entre preguntas;
- cronómetro;
- corrección y resumen;
- persistencia local provisional.

### Fase 2 — Supabase y progreso

- autenticación anónima;
- historial de intentos;
- respuestas y tiempos;
- estadísticas personales y globales.

### Fase 3 — competición

- crear y unirse a salas;
- lobby y estado preparado;
- inicio sincronizado;
- resultados y clasificación.

### Fase 4 — administración y robustez

- importación de nuevos exámenes;
- correcciones versionadas;
- clasificación por temas;
- modo de corrección protegida;
- cuenta persistente por correo.

## 12. Decisiones abiertas

- Si el modo individual permite corrección inmediata o solo al final.
- Fórmula exacta de puntuación y penalización por error.
- Si se muestran preguntas aleatorias o el orden oficial.
- Si el examen tiene límite oficial o solo cronómetro ascendente.
- Si las preguntas anuladas se excluyen o se muestran como histórico.
- Nivel de protección antitrampa necesario en competición.
- Necesidad de imágenes, tablas o casos clínicos dentro de preguntas.
