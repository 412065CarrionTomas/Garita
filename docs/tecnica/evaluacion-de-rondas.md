# Evaluación de rondas y avisos (HU-17)

La tarea BullMQ `round-window-evaluation` corre cada minuto mientras la API está activa. El cierre automático sigue en su propia cola. Cada aviso usa una clave única: tipo y ventana para `round_missed`, tipo y turno para `shift_unsynced`; repetir el barrido no duplica el aviso ni el push. Una sincronización vuelve a evaluar inmediatamente las ventanas del turno.

## Regla de sincronizado hasta

`ShiftSyncState.syncedUntil` avanza de forma monótona con avisos de conexión y lotes. Una ventana iniciada se evalúa al vencer su gracia solo si `syncedUntil >= graceEndsAt`. Si falta esa certeza, queda `pending_sync`, con o sin señal en el predio. Un lote parcial evalúa únicamente las ventanas cubiertas. Los registros posteriores corrigen el estado: una ventana que resulta completa resuelve su aviso `round_missed` con `data_arrived`; el aviso `shift_unsynced` permanece en el historial. Los registros cuentan solo para la asignación que era dueña de la ventana cuando terminó.

Los lotes publican su marca después de persistir los eventos. Si algún evento se rechaza, conservan la marca anterior: un lote con errores no certifica datos completos. Cerrar sin datos tampoco adelanta `syncedUntil` ni genera un aviso de ronda por la falta de datos; la decisión sigue registrada cuando llegan los datos reales.

| Situación                               | Cuándo se evalúa                                                  | Aviso de ronda                        |
| --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| Asignación iniciada o cierre automático | Gracia vencida y `syncedUntil` cubre la gracia                    | Sí, si faltan puntos                  |
| Asignación nunca iniciada               | Al vencer la gracia, `not_done`; al fin del turno, `no_show`      | No; HU-35 avisa la ausencia           |
| Cierre del vigilador                    | Ventana en curso al vencer la gracia; posteriores al terminar     | Solo la ventana en curso              |
| Cierre del administrador                | Anteriores al cierre según `syncedUntil`; posteriores al terminar | Solo las anteriores evaluables        |
| Baja del predio                         | Anteriores según `syncedUntil`; posteriores sin evaluación        | Solo las anteriores evaluables        |
| Sin vigilador                           | `not_done` al vencer la gracia                                    | No; HU-35 avisa la falta de cobertura |
| Cancelado                               | Sin evaluación                                                    | No                                    |

Una ventana completada durante la gracia queda `complete_late`. Una ventana `in_review` no genera aviso de ronda incumplida. El aviso incluye predio, turno y puntos faltantes en los datos del panel; el push lleva tipo, predio y enlace.

## Plazo de sincronización y cierre sin datos

Al iniciar el turno, `syncDeadlineAt` queda fijado con la conectividad del predio: fin programado más traslado hasta zona con señal y margen. Si llega el plazo sin `syncedUntil` hasta el fin y sin cierre del vigilador, se abre un único `shift_unsynced`. El supervisor asignado o administrador puede llamar `POST /api/v1/turnos/:id/cerrar-sin-datos` con un motivo de 5 a 500 caracteres. La operación guarda actor y fecha, resuelve el aviso y marca ventanas pendientes `not_done`. Los datos que lleguen después se procesan y corrigen las ventanas.

`GET /api/v1/avisos?estado=&tipo=&predio=` devuelve los avisos más recientes y `openCount`; `GET /api/v1/avisos/:id` devuelve el detalle. Ambos aplican aislamiento por empresa y predio. Los tres endpoints figuran en Swagger (`/api/docs`).

## Panel

Administradores y supervisores acceden a `/avisos` desde el menú, con el contador de avisos abiertos **no vistos por ese usuario**. El listado inicia en abiertos y permite filtrar tipo, estado y predio; resueltos muestra motivo y fecha de resolución. Cada aviso muestra predio, horario completo del turno, puntos faltantes y gravedad cuando los incluye `details`. La recepción es `createdAt`; si `details.occurredAt` o `details.closedAt` trae una hora distinta, se muestran ambas. El contrato de HU-17 no incluye una hora de evento separada: en ese caso se muestra `createdAt`.

Abrir un aviso (o entrar por `/avisos/:id`, enlace del push) llama `POST /api/v1/avisos/:id/marcar-visto`, que devuelve 200 y el aviso con `seenAt`. La clave compuesta `NoticeView(noticeId, userId)` conserva la primera lectura ante reintentos, sin cambiar lecturas de otros usuarios. `GET /avisos` agrega `unseenOpenCount` global para los predios permitidos, independiente de los filtros del listado; ambos GET agregan `seenAt`. El marcado usa los mismos roles y permisos por empresa y predio que el detalle.

Los eventos `aviso.nuevo` y `aviso.actualizado` invalidan inmediatamente las consultas `avisos` y `supervision`; al reconectar también se refrescan los avisos. El nuevo aviso se anuncia mediante la región `aria-live` del layout, usando el nombre del predio disponible en caché. No depende del sondeo de respaldo de 30 segundos del contador. La latencia real menor a 5 segundos requiere comprobación manual con un panel conectado.

`CloseWithoutDataDialog` se reutiliza desde el aviso `shift_unsynced` abierto y el detalle del turno. El detalle consulta avisos abiertos y solo ofrece el botón si el aviso corresponde a ese turno, sin agregar campos a supervisión. Exige motivo de 5 a 500 caracteres y confirmación explícita; muestra el mensaje de la API ante 409 y conserva el formulario. Tras el cierre refresca avisos y supervisión. `NoticeActions` concentra las acciones por tipo para que HU-35 agregue cobertura. Ver [manual de avisos](../manual/avisos.md).
