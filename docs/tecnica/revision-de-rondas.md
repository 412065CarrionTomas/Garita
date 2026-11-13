# Revisión de rondas (HU-39)

Cada ventana calcula su gravedad con `windowSeverity` de `@garita/shared`. Solo cuentan los registros válidos. Una marca grave alcanza para nivel **grave**; también es grave si más de la mitad de los puntos de la ventana tienen marcas medias o leves. Con la mitad exacta, una marca media da nivel **medio** y solo marcas leves dan nivel **leve**. Una ventana incompleta conserva su nivel sin entrar en revisión.

Una ventana completa grave pasa a `in_review`, no cuenta como completa ni incompleta y genera `round_in_review` para administradores y supervisores del predio. `turno.actualizado` refresca el panel. `in_review` no genera aviso de ronda incumplida (`TODO(HU-17)`). El cliente verá «en verificación» cuando exista su portal (`TODO(HU-28)`).

## Uso del panel

Entrá a **Rondas en revisión** desde el menú. El contador muestra cuántas requieren atención y la lista destaca las que llevan más de 24 horas en revisión, medidas desde `inReviewSince`. Abrí una ventana para ver sus registros, marcas e historial. **Validar ventana** la deja completa. **Invalidar** quita un registro del cumplimiento sin borrarlo; **Restituir** revierte una invalidación. Cada acción pide un comentario o motivo de 5 a 500 caracteres, guarda quién y cuándo decidió, y actualiza el estado y la gravedad. Una ventana sin registros válidos queda «No realizada»; si conserva algunos, «Incompleta». El historial permite reconstruir todas las decisiones.

## API y persistencia

Las rutas versionadas `GET /ventanas-ronda/en-revision?predio=`, `GET /ventanas-ronda/:id`, `POST /ventanas-ronda/:id/validar`, `POST /registros-puntos/:id/invalidar` y `POST /registros-puntos/:id/restituir` están en Swagger. Requieren `admin` o supervisor asignado; los recursos ajenos responden 404. El guard y cliente reciben 403.

`RoundReviewDecision` guarda las decisiones en orden temporal. La última decisión determina si la ventana está validada, aun después de recalcularla. Validar conserva `complete_late` si los registros válidos de su asignación dueña completaron la ventana durante la gracia. Invalidar o restituir cuenta solo esos registros y mantiene la ventana en curso o atrasada mientras no venza su gracia. `CheckpointRecord.invalidatedAt` es una caché de la última decisión sobre el registro, actualizada en la misma transacción. Cada decisión llama a `ReportRecalculationPort`; su implementación es noop hasta E6. La invalidación no dispara un nuevo aviso de ronda incumplida.
