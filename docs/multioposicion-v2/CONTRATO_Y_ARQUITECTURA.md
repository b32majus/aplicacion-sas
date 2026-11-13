# Aplicación SAS v2 — contrato funcional y arquitectura multioposición

**Fecha:** 2026-11-13 · **Estado:** DISEÑO PROPUESTO; pendiente de aprobación humana antes de Metis `plan-units`.
**Base verificada:** `origin/main = 39b1252e043df7ae1b820cc0d653e50258e686a9`, merge PR #31; corpus Administrativo de 12 exámenes.
**Fuente de implementación:** código, migraciones y tests actuales del repositorio; este documento SUPLEMENTA la SPEC v1 sólo para la evolución v2. No reescribir la historia T01–T12.

## 1. Decisiones funcionales confirmadas por Sil

- Una única aplicación, base Supabase, código y URL GitHub Pages. **No clonar** Administrativo.
- Un único login; **cualquier usuario autenticado puede entrar en cualquier oposición publicada**. No autorización ni invitación específicas por oposición.
- Después del login se ofrece un selector de oposición (Administrativo/a, Radiodiagnóstico). Se recuerda la última selección; acceso visible para cambiarla desde cualquier catálogo.
- La oposición seleccionada delimita banco, estudios, sesiones de falladas, exámenes artificiales, historia filtrada y Dashboard; nunca mezclar preguntas de distintos bancos por accidente.
- El progreso/historial no se reinicia al cambiar. Los 12 exámenes de Administrativo, sus versiones y las respuestas históricas conservan identidad inmutable.
- Los roles existentes `participant|test|admin` son **independientes** de las oposiciones. `test/admin` no contaminan métricas compartidas. Cada oposición tiene sus propias comparaciones; no prolongar la restricción global de tres aliases.
- Acceso principal por enlace GitHub Pages, sin requerir instalación PWA; no registro público ni panel de administración en esta fase.
- El alta de nuevo contenido se basa en **JSON canónico revisado manualmente/asistido**; no crear parser universal automático de PDF. PR y aplicación administrativa del SQL de publicación continúan siendo pasos humanos.

## 2. Experiencia de usuario

1. Login actual sin cambios.
2. Selector de oposición: tarjetas de las oposiciones **publicadas**; opción persistida localmente como preferencia (no como frontera de seguridad).
3. Catálogo filtrado por oposición: títulos, año, modalidad, estado del estudio y mejor nota tal como funcionan ahora.
4. Dentro de una oposición: estudio normal/aleatorio, falladas de la oposición o de un examen, oficial cronometrado, artificial sólo con preguntas de esa oposición, histórico y Dashboard.
5. Un intento oficial activo conserva el **bloqueo global de estudio mientras no venza el plazo en servidor**; cambiar de oposición no puede eludirlo. El selector debe ofrecer reanudar/cerrar el examen en curso, no iniciar trabajo incompatible.
6. Las preguntas pueden incluir cero, una o varias imágenes; los casos prácticos permiten imágenes compartidas por varias preguntas. La interfaz muestra miniatura/galería y una vista ampliada, usable mediante toque y teclado. Los textos alternativos describen el tipo de imagen sin revelar la respuesta.
7. Histórico: filtro de oposición; cada intento se reconstruye con su paquete, registro de origen e imágenes **fijados a su versión**, incluso tras publicarse una edición nueva.
8. Dashboard: indicadores personales de la oposición seleccionada y comparación **exclusivamente agregada** de participantes de esa oposición. Estado vacío legítimo si aún no existe actividad; admin/test ven su información personal sin añadir sus datos a comparativas.

## 3. Contratos de dominio que deben conservarse

- `official_exam_versions` autoriza el tuplo exacto (exam_id, version_id, version_path) y la clave oficial de puntuación. Versiones históricas inmutables.
- Sólo versiones publicadas pueden **originar** intentos nuevos. Intentos ya fijados pueden reanudarse y reproducirse históricamente.
- Deadline/servidor autoritativo, `finalize=true` sin inyección de respuestas tardías, reloj ajustado y fallo cerrado si no se conoce el reloj fiable.
- Replays idempotentes y orden global de bloqueo: attempt-row `FOR UPDATE` antes del lock del UUID de respuesta; no alterar rutas de sincronización.
- Respuesta errónea = penalización `1/4` del acierto; normalización por nominal/efectivo cuando faltan reservas; fórmula vigente de servidor manda. Configuración por examen para duración/cantidad nominal.
- Anuladas fuera del conjunto puntuable; reservas activas en orden hasta cubrir anuladas; si faltan reservas, examen válido con menos efectivas y nota normalizada.
- Ningún cliente puede elegir, presentar como publicada o mezclar una fuente de otra oposición mediante parámetros manipulados.
- No conceder acceso a respuestas individuales o progresos crudos de otro usuario; no credenciales secretas en Pages.

## 4. Modelo técnico recomendado (diseño, NO migración todavía)

**Identidad de oposición:** `opposition_id` estable, p.ej. `sas-administrativo`, `sas-radiodiagnostico`. Registro público de oposiciones visibles, con estado de publicación.

**Relación examen-oposición del lado servidor:** tabla administrativa `official_exam_oppositions(exam_id PRIMARY KEY, opposition_id REFERENCES oppositions)`, sembrada con los 12 exam_id existentes para Administrativo; cada examen pertenece a una sola oposición. No deducir por prefijo/slug ni confiar en un filtro sólo de JavaScript. La identidad de oposición es inmutable para un exam_id publicado.

**Resolución de oposición sin alterar el catálogo canónico:** `catalog.json` conserva su esquema 1.0 cerrado (`scripts/parse_sas_exam.py` lo verifica por igualdad de campos); NO añadirle `oppositionId` ni tocar importador/parser. Una RPC v2 autenticada devuelve `exam_id, exam_version_id, exam_version_path, opposition_id` y, si procede, el nombre público de oposición. El cliente cruza el tuplo exacto estático `(exam_id, version_id, path)` con el registro autenticado y toma **opposition_id exclusivamente del servidor**; sin coincidencia exacta oculta la entrada (fail-closed). No existe atributo de oposición independiente en el catálogo estático que pudiera discrepar. Mantener RPC v1 hasta completar el despliegue compatible.

**Intentos y progreso:** conservar IDs y tablas actuales; resolver oposición desde `exam_id`/origen registrado, incluido `attempt_question_sources` para falladas/artificiales. Si se materializa `opposition_id` en intento por rendimiento, debe ser validado por servidor y retrocompletado sin sobrescribir historia. Historial no admite recalificar ni recolocar su fuente.

**Sesiones con múltiples fuentes:** todas las fuentes de una misma sesión de falladas global-de-oposición o examen artificial deben apuntar a la misma `opposition_id` autenticada; comprobación en RPC, no sólo filtro frontend. El tamaño del artificial sigue siendo 75 mientras no se apruebe otra regla; si una oposición no tiene 75 preguntas activas, mostrar bloqueo explícito.

**Comparativa:** no reutilizar `shared_profile_aliases` como pertenencia multioposición: tiene constraint de tres nombres globales y `get_dashboard()` exige exactamente tres. Proponer API `get_opposition_dashboard_v2(opposition_id)` que entrega resumen personal del solicitante y agregados compartidos de `participant` para esa oposición, sin tamaño fijo de grupo. Mantener tabla y RPC v1 para compatibilidad/transición. El conjunto para `failed_by_all` debe definirse respecto a participantes **activos de la oposición** (membresía explícita o alta automática al primer uso), con N documentado y umbral mínimo útil (p.ej. >=2) para evitar resultados engañosos. Esto se cierra como contrato antes de su ticket; no inferir pertenencia de todo `auth.users` ni incluir cuentas técnicas.

**Contenido visual:** extender el esquema de paquetes únicamente para nuevos contenidos con campos opcionales como `cases[]`, `questions[].caseId`, `questions[].media[]`. Cada recurso usa `assetPath` relativo validado, SHA-256, tipo mime permitido, dimensiones y procedencia (página original); almacenar recursos visuales en ruta estática versionada/content-addressed. Prohibir rutas externas arbitrarias, `..` o HTML no saneado. El visor debe funcionar en estudio, examen oficial, artificial, falladas e historial, sin depender de red a terceros.

**Edición/publicación:** generar/validar JSON, assets de imagen, hashes/QA, entrada en catálogo y SQL exacto de registro en una misma propuesta de PR. Un recurso faltante o hash incorrecto impide publicar el paquete. No incluir PDF original ni artefactos de extracción sin revisar en el repo público.

## 5. Despliegue compatible y protección de datos

- Entorno de trabajo/branch independientes; no tocar el checkout `repo` usado por otras sesiones Herdr ni worktrees existentes.
- Migraciones **forward-only** y con preflight: comprobar cuántos perfiles, intentos, preguntas, versiones y aliases existen; documentar la foto sin PII.
- Sembrar 12 correspondencias de Administrativo **sin cambiar** las 12 versiones publicadas; rechazar exam_id desconocidos/conflictos. Verificar que la RPC de autorización no revela claves.
- Aplicar schema/backend compatible antes de activar frontend v2; si falta RPC o mapeo, ocultar el banco afectado y mostrar error útil (nunca dejar entrar por `catalog.json` exclusivamente).
- Mantener URLs/versión anterior del frontend hasta smoke; no cambiar settings de Pages.
- Test de conservación antes/después: Auth, perfiles, intentos, answers, question_progress, historial, rankings/admin/test, y los 12 exámenes.
- Backups y prueba de reversión operacional antes del despliegue; como las migraciones son forward-only, rollback seguro de frontend ≠ rollback destructivo de SQL.
- Producción sólo con GO específico de Sil; sin push/PR/merge/deploy automáticos fuera de autorización KairOS.

## 6. Invariantes de aceptación

1. Los 12 exámenes de Administrativo siguen visibles, mismos IDs, hashes, scoring, historia y progreso.
2. Usuario autenticado puede entrar libremente a las dos oposiciones; cambiar de una a otra no pierde historial ni mezcla preguntas.
3. Un examen o fuente de Radiodiagnóstico no puede convertirse en intento de Administrativo manipulando parámetros REST.
4. Artificial/falladas por oposición no pueden incorporar fuentes de otra oposición y respetan las reglas de 75 y del reloj global.
5. Dashboard nunca mezcla participantes/datos de oposiciones ni expone respuestas de terceros; test/admin quedan fuera de rankings.
6. Las imágenes clínicas/diagnósticas se visualizan nítidamente en ordenador y móvil; fallos de media bloquean publicación y no alteran respuestas.
7. Historial antiguo y nuevo reproduce la versión exacta (incluidas imágenes) sin mutar datos.
8. La importación de Radiodiagnóstico sigue siendo manual/asistida, con QA y publicación humana; ningún auto-parser general entra en producción.
9. Los tests de contratos críticos y la comprobación hosted representativa pasan; fallos mock/flaky se clasifican antes de intervenir sobre producto.
10. Un cambio de oposición no permite saltarse el bloqueo servidor de examen activo ni su deadline.

## 7. Pendientes concretos antes del código

- Elegir semántica del grupo visible del Dashboard multioposición (membresía automática al primer uso para participantes frente a grupos privados opt-in). Propuesta inicial: cohorte por oposición automática para `participant` al primer intento, y visibilidad agregada sólo para miembros del mismo grupo.
- Verificar en una preparación Metis si el modelo actual necesita una RPC v2 para cada interacción multi-fuente o si basta una comprobación reusable en los puntos de entrada. No insertar `opposition_id` inseguro aceptado desde cliente.
- Recibir la copia privada del PDF RX en el VPS para preparar/cortar imágenes; el fichero adjunto del chat **no está demostrado como presente en el VPS**.

Ver `PLAN_KAIROS_METIS.md` y `FUENTE_RX.md`.