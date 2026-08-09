# Arquitectura v2 — Enriquecimiento y tutor con IA

Fecha: 2026-08-05
Estado: decisión arquitectónica vigente para la capa de IA
Complementa: `architecture-v1-simplified.md`

## 1. Decisión principal

Separar la inteligencia artificial en dos capas:

1. **IA de importación, obligatoria y asíncrona**: se ejecuta una sola vez cuando entra un PDF y genera el contenido enriquecido que consumirá la aplicación.
2. **Tutor IA bajo demanda, opcional**: se invoca solo cuando una persona pide una explicación adicional o formula una duda libre.

La aplicación no dependerá de una llamada al modelo para corregir cada respuesta. Las explicaciones básicas estarán pregeneradas en el JSON y se mostrarán instantáneamente.

## 2. Flujo de importación enriquecido

```text
PDF preguntas + plantilla oficial
        ↓
extracción determinista de texto
        ↓
normalización estructurada con LLM
        ↓
respuesta correcta tomada de la plantilla oficial
        ↓
enriquecimiento IA por pregunta
        ↓
validación automática
        ↓
JSON versionado + informe de revisión
        ↓
GitHub Pages
```

La IA puede ayudar a extraer y normalizar, pero **nunca decide cuál es la respuesta correcta**. La respuesta oficial es la única fuente de verdad para `correctOption`.

## 3. Enriquecimiento pregenerado por pregunta

Cada pregunta podrá incluir un bloque opcional `learning`:

```json
{
  "topicId": "legislacion-sanitaria",
  "topicLabel": "Legislación sanitaria",
  "subtopic": null,
  "explanation": "Explicación breve de por qué la opción oficial es correcta.",
  "optionFeedback": {
    "A": "Comentario breve sobre esta opción.",
    "B": "Comentario breve sobre esta opción.",
    "C": "Comentario breve sobre esta opción.",
    "D": "Comentario breve sobre esta opción."
  },
  "confidence": 0.86,
  "status": "ai_generated",
  "model": "provider/model-id",
  "promptVersion": "question-enrichment-v1",
  "reviewedAt": null
}
```

Esto permite que, cuando una persona falle, la aplicación muestre inmediatamente:

- cuál era la opción oficial;
- por qué es correcta;
- por qué la opción elegida no encaja;
- la temática asignada;
- un botón para señalar una explicación dudosa.

## 4. GitHub Actions y secretos

La Action de importación podrá usar una clave de proveedor guardada como GitHub Actions Secret. La clave solo estará disponible durante el workflow y nunca se incorporará al frontend ni a los JSON.

Responsabilidades del workflow:

1. detectar PDF nuevos o modificados;
2. extraer texto y estructura;
3. llamar al modelo con salida JSON estructurada;
4. fusionar la plantilla oficial de respuestas;
5. generar temas, explicación y feedback por opción;
6. validar el resultado contra `schemas/exam.schema.json`;
7. marcar preguntas de baja confianza como `needs_review`;
8. generar un informe de importación;
9. guardar los JSON definitivos en el repositorio;
10. desplegar GitHub Pages.

La Action no sirve para responder consultas interactivas de usuarios. Solo ejecuta trabajos ligados al repositorio.

## 5. Tutor IA bajo demanda

El tutor interactivo será una función serverless, no una llamada directa desde el navegador:

```text
Aplicación web
    ↓ petición autenticada
Supabase Edge Function `ask-tutor`
    ↓ clave privada del proveedor
Gemini / DeepSeek / OpenAI / otro
    ↓
respuesta breve al usuario
```

La Edge Function:

- valida la identidad del usuario;
- aplica límites de uso;
- elimina alias, correo y otros identificadores antes de llamar al modelo;
- envía solo pregunta, opciones, respuesta oficial, opción elegida y duda;
- registra consumo y errores, no el contenido completo salvo decisión expresa;
- permite cambiar de proveedor sin modificar el frontend.

El tutor es una mejora, no una dependencia. Si el proveedor falla o se agota el cupo, la explicación pregenerada continúa disponible.

## 6. Selección de modelo

La arquitectura será agnóstica al proveedor mediante una interfaz común:

```ts
interface TutorProvider {
  enrichQuestion(input: QuestionInput): Promise<QuestionLearning>;
  answerFollowUp(input: TutorInput): Promise<TutorResponse>;
}
```

Candidatos iniciales:

- un modelo Flash/Lite de Gemini por su salida estructurada y coste bajo;
- `deepseek-v4-flash` como alternativa económica;
- OpenAI como proveedor intercambiable;
- un modelo de Cloudflare Workers AI si se quisiera concentrar hosting e inferencia en Cloudflare.

No se fija aún el proveedor definitivo. Primero se probará una muestra de preguntas y se compararán precisión, latencia, estabilidad del JSON y calidad pedagógica.

## 7. Temáticas: solución simple antes del RAG

No hace falta un RAG para clasificar preguntas por temática.

### Primera etapa

Crear `data/taxonomy/topics.json` con una lista cerrada de temas. Puede partir de:

- los encabezados del temario oficial;
- el índice de la convocatoria;
- una taxonomía provisional revisada por los usuarios.

El modelo debe elegir exclusivamente entre esos identificadores. Si no tiene confianza suficiente, devuelve `topicId: null` y la pregunta queda pendiente de revisión.

### Cuándo sí necesitamos el temario completo

El temario completo es necesario si queremos:

- asignar cada pregunta a un epígrafe oficial exacto;
- generar explicaciones apoyadas en una fuente concreta;
- citar capítulo, página o norma;
- detectar preguntas desactualizadas respecto a normativa vigente.

## 8. RAG posterior, no incluido en el MVP

Una fase posterior puede incorporar recuperación aumentada:

```text
Temario y fuentes oficiales
        ↓
extracción y fragmentación
        ↓
embeddings
        ↓
Supabase pgvector
        ↓
recuperación de fragmentos relevantes
        ↓
explicación con citas
```

El RAG debe introducirse solo cuando dispongamos de fuentes fiables y queramos explicaciones trazables. Sin buenas fuentes, un RAG añade infraestructura pero no añade verdad.

## 9. Custom GPT como complemento

Un GPT personalizado podría usar el temario como conocimiento y actuar como tutor conversacional. No será la interfaz principal porque:

- exige entrar en ChatGPT;
- no ofrece el mismo control sobre examen, cronómetro y panel comparativo;
- para leer o escribir estadísticas seguiría necesitando una API externa mediante Actions;
- duplicaría parte de la experiencia de la aplicación.

Puede añadirse después como acceso alternativo: “Tutor SAS conversacional”, enlazado desde la web.

## 10. Control de calidad

Las explicaciones generadas por IA no deben presentarse como equivalentes a una fuente oficial.

Estados previstos:

- `ai_generated`: generada y aún no revisada;
- `reviewed`: validada por una persona;
- `flagged`: señalada por posible error;
- `source_grounded`: generada con una fuente recuperada y citada.

Reglas mínimas:

- respuesta correcta siempre procedente de la plantilla oficial;
- temperatura baja y salida estructurada;
- explicación corta y concreta;
- prohibido inventar normativa, artículos o referencias;
- si no hay certeza, declarar incertidumbre;
- guardar modelo y versión de prompt para poder regenerar;
- botón de reporte en cada explicación.

## 11. Arquitectura resultante

```text
                         ┌────────────────────────────┐
PDF + respuestas ──────→ │ GitHub Action de importación│
                         └──────────────┬─────────────┘
                                        │
                     extracción + enriquecimiento IA
                                        │
                           JSON validado y versionado
                                        │
                                  GitHub Pages
                                        │
                                  aplicación web
                         ┌──────────────┴──────────────┐
                         │                             │
                  Supabase Postgres             explicación local
             progreso y estadísticas          pregenerada en JSON
                         │
                 Supabase Edge Function
                    tutor bajo demanda
                         │
                 proveedor LLM intercambiable
```

## 12. Orden de implementación

1. Probar extracción con un PDF y su plantilla oficial.
2. Cerrar el esquema JSON de pregunta.
3. Generar tema y explicación para 10–20 preguntas de muestra con dos modelos.
4. Revisar calidad pedagógica y tasa de errores.
5. Construir la Action completa de importación.
6. Mostrar explicaciones pregeneradas en la aplicación.
7. Construir estadísticas y comparativa.
8. Añadir el tutor bajo demanda solo si aporta valor real.
9. Incorporar taxonomía oficial.
10. Valorar RAG con fuentes oficiales.
