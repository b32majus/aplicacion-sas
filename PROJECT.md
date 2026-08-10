# PROJECT — Aplicación SAS

## Purpose / problem
Tres usuarios necesitan preparar Administrativo/a del SAS con exámenes oficiales en una aplicación pequeña, privada y fiel a la fuente, con continuidad de estudio, simulación cronometrada, recuperación de falladas, historial y comparación agregada.

## Users / stakeholders
- Tres usuarios precreados de la aplicación.
- Propietaria del producto: Sil.

## Outcomes
- Los 12 PDF iniciales producen un Banco de exámenes canónico válido o un bloqueo QA explícito.
- Cada usuario puede estudiar, examinarse, recuperar falladas y conservar historial/progreso entre dispositivos de forma secuencial.
- Los tres pueden comparar métricas agregadas sin acceso a respuestas privadas ajenas.
- Nuevos exámenes se incorporan mediante importación automática + PR + aprobación humana.

## Scope now
- Exámenes oficiales SAS Administrativo/a.
- Modo estudio: Orden normal, Orden aleatorio y Solo falladas.
- Modo examen oficial con deadline absoluto y scoring /100.
- Examen artificial de 75 preguntas.
- Historial/versionado, `question_progress`, Dashboard/Ranking.
- PWA responsive en GitHub Pages.
- Supabase Auth/PostgreSQL/RLS como backend dinámico.

## Out of scope now
- IA explicativa, generación didáctica por IA, RAG/embeddings.
- Temáticas/dificultad y filtros temáticos.
- Tiempo por pregunta.
- Registro público y panel admin.
- Realtime/competición en vivo.
- Offline-first o edición simultánea soportada del mismo Intento.
- Frameworks frontend como React/Vue/Next.
- Backend propio distinto de Supabase.

## System boundary
- Owns: frontend PWA, Banco de exámenes estático/versionado, importador+QA, modelo dinámico de progreso/Intentos, workflows GitHub y tests.
- External: GitHub/Pages/Actions, Supabase, navegador/PWA y PDFs oficiales SAS.

## Constraints
- Fuente oficial y plantilla definitiva mandan; nunca inventar correcciones o sustituciones.
- Historial debe preservar la versión exacta del examen usado.
- Datos privados separados por RLS; comparativa solo mediante agregados explícitos.
- Sin secretos privilegiados en frontend.
- Código brownfield se salva selectivamente, no por coste hundido.
- Testing concentrado en dos seams altos aprobados.

## Current phase
Implementación incremental de tickets auditados T01–T12.

## Success definition
SPEC-to-spec-v2 queda satisfecha mediante los 12 tracer bullets auditados, los 12 PDF pasan Seam 1 como válidos o bloqueados justificadamente, Seam 2 demuestra los recorridos funcionales/seguridad principales y cada cambio llega como PR revisable sin merge automático.

## Open product decisions
- NONE para el alcance v1 auditado. Inputs operativos como proyecto Supabase definitivo o secretos de despliegue no reabren decisiones de producto.
