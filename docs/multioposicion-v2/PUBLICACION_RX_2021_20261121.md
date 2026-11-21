# Radiodiagnóstico 2021 — lote final de tres exámenes

**Fuente:** PDF privado combinado aportado por usuaria, segmentos 2021 Libre, Libre Aplazada, Promoción Interna; PDFs individuales segregados con hashes en exam-inputs. No se incluyen los PDF en GitHub.

## Correspondencia contra fuente oficial
- Tres ejercicios de 153 preguntas: 150 ordinarias y tres de reserva por ejercicio.
- Las 153 claves de cada plantilla definitiva se validan contra el último folio de cada PDF, sin deducir ninguna respuesta de la imagen.
- Libre y PI: Q122 ANULADA, sustituida por reserva 151 (R1). Aplazada: sin anuladas; reservas 151–153 inactivas. En todos los casos 150 preguntas puntuables.
- La portada declara 180 min para cada uno.
- Se utiliza lectura de columna con numeración al principio de la línea, no el detector automático que confundía texto de opciones adyacentes. Se eliminaron únicamente los encabezados parásitos de q1 y las opciones D de q100/q150.
- Se conservan íntegros los cinco contextos prácticos de cada ejercicio, repetidos en las preguntas del mismo caso para estudio o examen aleatorio.
- Las imágenes del cuadernillo oficial están numeradas con leyendas. El procesador une página y número de imagen: Libre y PI tienen figuras 1–15 y 17–24 (23 cada uno; no tienen la figura 16 en PDF); Aplazada tiene 1–24 (24). Total 70 PNG recortados de su imagen original con numeración comprobada.
- Cada pregunta que cita una figura lleva su referencia explícita. Se verifica que no exista ninguna figura sin vincular ni referencia a imagen ausente. Los PNG llevan SHA-256, dimensiones reales y página fuente y se sirven sin respuesta en texto alternativo.
- QA y datos de procedencia en reporte privado staging-remaining/QA_2021_private_20261121.json.
- Los tests rx-2021-publication y exam-media examinan las 70 imágenes, las 153 preguntas de cada turno, las anulaciones/reservas y el contexto de casos.

## Publicación
- PR con tres paquetes canónicos, 70 PNG, mapeo nuevo 20261121210000 y 3 registros SQL inmutables.
- Gate CI, Page 22 exámenes (12 Administrativo, 10 RX) y todas las imágenes HTTP 200 + SHA, aplicar registros Supabase, smoke de RPC metadata con 12+10, datos históricos intactos.
- Ningún PDF privado, credencial ni tabla clínica se publica. La publicación no modifica historiales.
