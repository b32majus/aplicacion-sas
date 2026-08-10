# Workflow de ingeniería — Aplicación SAS

Este directorio conserva los artefactos formales del workflow de definición y planificación del producto.

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

## Tickets actuales

El resultado de `/to-tickets` vive en GitHub Issues:

- T01–T12: issues #5–#16.

Los tickets todavía están pendientes de auditoría externa independiente. No deben implementarse hasta que esa auditoría devuelva `READY`.

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
      ↓
AUDITORÍA EXTERNA DE TICKETS
      ↓
READY / NEEDS_CHANGES
```
