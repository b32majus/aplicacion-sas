# Auditoría externa de tickets — Aplicación SAS

Actúa exclusivamente como **AUDITOR INDEPENDIENTE** del plan de implementación de Aplicación SAS.

NO implementes.  
NO escribas código.  
NO rediseñes el producto por preferencia personal.  
NO añadas scope.  
NO reabras decisiones funcionales ya cerradas.

## Fuentes de verdad

### Primarias

1. `docs/workflow/aplicacion-sas-SPEC-to-spec-v2.md`
2. `docs/workflow/aplicacion-sas-CONTEXT-final.md`

### Trazabilidad secundaria

3. `docs/workflow/aplicacion-sas-GRILL-AUDIT-final.md`

`aplicacion-sas-SPEC-to-spec-v1.md`, `aplicacion-sas-SPEC-v1.md` y las arquitecturas históricas están superseded cuando contradigan SPEC-to-spec-v2.

## Repositorio

`b32majus/aplicacion-sas`

## Plan a auditar

GitHub Issues #5 a #16 inclusive.

Son 12 tracer-bullet tickets generados mediante el workflow `to-tickets` de Matt Pocock.

## Contexto brownfield

Existe código/prototipo anterior a la SPEC actual. No debe preservarse por coste hundido. Sí pueden reutilizarse las piezas que sigan siendo compatibles. Los tickets incluyen instrucciones brownfield para distinguir ambas cosas.

## Objetivo de la auditoría

Determina si los tickets #5–#16 constituyen un plan completo, coherente, implementable y suficientemente testable para satisfacer SPEC-to-spec-v2 sin introducir sobreingeniería.

Comprueba especialmente:

- que todos los requisitos materiales de SPEC-to-spec-v2 estén cubiertos;
- que ningún ticket contradiga SPEC-to-spec-v2 o CONTEXT-final;
- que no se haya reintroducido scope descartado;
- que cada ticket sea realmente una vertical slice/tracer bullet;
- que cada ticket pueda ser ejecutado por un agente con contexto fresco;
- que los criterios de aceptación pertenezcan al propio ticket;
- que los criterios puedan fallar en el commit base y no sean afirmaciones ya verdaderas antes de implementar;
- que ningún criterio dependa silenciosamente de un ticket futuro no declarado;
- que las dependencias `Blocked by` sean necesarias y suficientes;
- que la frontier permita paralelizar únicamente trabajo realmente independiente;
- que no existan dependencias circulares o dependencias artificiales;
- que el modelo dinámico siga girando alrededor de perfil, Intento, respuesta de Intento y `question_progress`, sin reintroducir `study_progress`;
- que `question_progress` mantenga identidad estable entre versiones;
- que actualizaciones de racha/dominio sean idempotentes y seguras;
- que el deadline de Modo examen esté protegido tanto en cliente como server-side;
- que la tolerancia de red no derive accidentalmente en offline-first;
- que el modelo multi-dispositivo sea secuencial, no concurrente;
- que Historial preserve la versión exacta usada;
- que Dashboard/RPC no exponga datos privados de otros usuarios;
- que Examen artificial no contamine Finalizados ni ranking oficial;
- que el importador preserve anuladas/reservas correctamente y bloquee ambigüedades;
- que el workflow de importación necesite aprobación humana mediante PR;
- que Seam 1 y Seam 2 permanezcan conectados mediante al menos un fixture producido por el importador real;
- que no se haya convertido el código experimental existente en una restricción arquitectónica innecesaria;
- que tampoco se esté proponiendo un rewrite injustificado de piezas útiles.

Revisa también el **grafo como conjunto**, no solamente cada ticket aislado.

No marques `NEEDS_CHANGES` por:

- preferencias de naming;
- diferencias estilísticas;
- abstracciones que tú diseñarías de otra manera;
- features adicionales que podrían ser interesantes;
- optimizaciones prematuras.

## Salida obligatoria

Primera línea, exactamente una de estas:

`READY`

o

`NEEDS_CHANGES`

Si es `READY`:
- explica brevemente por qué el plan puede pasar a implementación;
- señala como máximo observaciones no bloqueantes realmente útiles.

Si es `NEEDS_CHANGES`:
- enumera únicamente problemas materiales;
- para cada uno indica ticket(s) afectado(s), requisito/decisión de SPEC incumplido o sin cubrir, por qué es bloqueante y corrección mínima recomendada.

No reescribas tú los tickets.  
No implementes las correcciones.  
El modelo que creó los tickets será quien los modifique y después volverán a someterse a tu revisión.
