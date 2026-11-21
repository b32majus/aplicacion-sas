# Radiodiagnóstico 2018, primer lote verificado

Dos ejercicios de Técnico/a Especialista en Radiodiagnóstico, acceso libre y promoción interna, de 2018 (OEP 2016-2017 y Estabilización), sin confundir con FEA Radiodiagnóstico.

La fuente privada de la usuaria es un PDF de 353 páginas, SHA256 5e5c65f056386f37fa6fb7903d89c866a72c4547f28434eb3caa6db5c0a5118e. Los ejercicios están en las páginas físicas 67-99 y 100-132; la plantilla definitiva es la última página de cada bloque. Las URLs públicas oficiales de procedencia constan en los sidecars de exam-inputs, sin copiar el PDF privado.

Verificación exhaustiva 21/11: por cada examen, 153 de 153 enunciados cotejados con la página fuente, 612 de 612 opciones cotejadas, 153 de 153 letras cotejadas con la plantilla definitiva, cinco casos prácticos íntegros cotejados y asociados a las 50 preguntas 101-150. Se corrigió la contaminación del campo D de Q100, Q110, Q120, Q130 y Q140, que contenía encabezados del caso siguiente. Las preguntas 19, 27 y 135 tienen opciones numéricas de un carácter en el ORIGINAL. En Q66, A y B son idénticas en ambos PDF oficiales; clave definitiva D, preservada y señalizada en QA. No se inventan distractores ni claves.

Cada paquete tiene 153 entradas, 150 ordinarias activas, reservas 151-153 inactivas, cero anuladas y 180 minutos; metadatos y hashes de versiones inmutables. Se utiliza el pipeline existente de publicación; validadores obligatorios: verify-bank, verify-inputs, verify-immutable, verify-registry y el test rx-2018-publication. El reporte detallado de comparación queda privado en staging-2018/QA_PREPUBLICACION_2018_20261121.json.

Publicación segura: CI y merge, Pages JSON HTTP 200, aplicar registros SQL de los dos exam IDs/versiones con Supabase, verificar oposición y mapeo, catálogo autenticado y selector, sin alterar los doce Administrativo. No publicar examen RX incompleto ni el PDF privado.

Los demás ocho bloques del PDF (2015, 2021, 2023, 2025) siguen pendientes de QA específica, en especial los cuadernillos de imágenes de 2021.
