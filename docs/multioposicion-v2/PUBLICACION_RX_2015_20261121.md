# Radiodiagnóstico 2015 · segundo lote

Dos exámenes de Técnico/a Especialista en Radiodiagnóstico OEP 2013–2015, Libre y Promoción Interna. Proceden de las páginas 1–33 y 34–66 del PDF privado EXAMENES_RX.pdf (353 páginas), que no se publica.

Comprobación con PyMuPDF sobre ambos PDF individuales: 153/153 enunciados, 612/612 opciones y 153/153 claves extraídas de las plantillas definitivas (incluido ANULADA), confrontadas con su página fuente; duración original tres horas según portada. Se eliminó el encabezado de categoría que el extractor había unido a las preguntas 1, 101 y 151. No se alteraron preguntas por criterios clínicos.

Las plantillas tienen seis anuladas por ejercicio y tres reservas. Aplicación del criterio de sustitución en orden que ya utiliza la aplicación en Administrativo 2018:
- Libre: anuladas 20,35,107,130,136,142; reservas 151,152,153 sustituyen 20,35,107, y las restantes tres no se sustituyen.
- PI: anuladas 5,20,107,130,136,142; reservas 151,152,153 sustituyen 5,20,107; las restantes tres no se sustituyen.
- Total 147 preguntas puntuables por ejercicio (144 ordinarias válidas + 3 reservas); nota normalizada sobre 150 nominales, igual que los casos admin con más anulaciones que reservas.

El paquete preserva las 153 entradas y respuestas definitivas para revisión histórica, aunque las anuladas quedan inactivas. Cada examen tiene hash del PDF segregado, versión de contenido fijada y URL pública del cuadro de evolución OEP SAS en su sidecar. Pipeline oficial parse_sas_exam.validate_exam_package y publish_exam.py prepare/verify. Reporte de QA privado en staging-2015/QA_PREPUBLICACION_2015_20261121.json.

Publicación fail-closed: PR+CI, Pages con JSON versionados, registrar versiones oficiales con los dos SQL deterministas y migración 20261121170000 de mapeos; smoke de RPC metadata de 12 Administrativo+4 RX y cero cambios en usuarios/intent os.
