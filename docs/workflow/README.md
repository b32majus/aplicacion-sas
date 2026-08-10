# Workflow de ingeniería — Aplicación SAS

Este directorio conserva los artefactos formales del workflow de definición, planificación y auditoría del producto.

## Fuentes autoritativas actuales

1. `aplicacion-sas-SPEC-to-spec-v2.md`
   - Contrato funcional/técnico vigente.
   - Estado previo a ticketing: READY FOR TICKETING.
   - Prevalece sobre versiones anteriores cuando exista cualquier contradicción.

2. `aplicacion-sas-CONTEXT-final.md`
   - Glosario canónico del producto.
   - Define el vocabulario que deben usar implementación, tickets y revisiones.

## Trazabilidad

3. `aplicacion-sas-GRILL-AUDIT-final.md`
   - Auditoría final del grill y resolución de contradicciones históricas.

4. `aplicacion-sas-SPEC-to-spec-v1.md`
   - Versión histórica superseded por SPEC-to-spec-v2.
   - No usar como contrato actual.

5. `aplicacion-sas-SPEC-v1.md`
   - Especificación histórica previa a `to-spec`.
   - Contiene decisiones superseded y se conserva solo para trazabilidad.

## Auditoría externa de tickets

- `AUDIT-TICKETS-PROMPT.md` contiene las instrucciones usadas para el auditor independiente.
- `AUDIT-TICKETS-RESULT.md` conserva el veredicto final `READY` y sus observaciones no bloqueantes.
- El auditor usó SPEC-to-spec-v2 + CONTEXT-final como fuentes primarias y GRILL-AUDIT-final como trazabilidad secundaria.

## Tickets actuales

El resultado de `/to-tickets` vive en GitHub Issues:

- T01–T12: issues #5–#16.

La auditoría externa del conjunto ha devuelto `READY`. Los tickets pueden pasar a implementación únicamente cuando sus `Blocked by` estén satisfechos.

## Código brownfield

Existe un prototipo anterior a la SPEC actual. Puede reutilizarse cuando cumpla el contrato vigente, pero no constituye una restricción arquitectónica. SPEC-to-spec-v2 y CONTEXT-final prevalecen sobre comportamiento, schema o documentación heredados.

## Gate actual

```text
grill-with-docs
      ✓
to-spec
      ✓
auditoría independiente de SPEC
      ✓ READY
to-tickets
      ✓ issues #5–#16
auditoría externa de tickets
      ✓ READY
      ↓
IMPLEMENTACIÓN POR FRONTIER
      ↓
T01 (#5) primero; después avanzar solo tras PASS
```

## Política de ejecución

Cada ticket debe ejecutarse con contexto fresco. El avance puede ser secuencial y desatendido siempre que el runner respete las dependencias, ejecute verificación/code-review por ticket y aplique `PASS → siguiente` / `BLOCKED → STOP`. No se autoriza merge automático.
