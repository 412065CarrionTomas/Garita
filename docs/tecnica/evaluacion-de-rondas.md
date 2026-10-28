# Evaluación de rondas y avisos (HU-17)

La tarea BullMQ `round-window-evaluation` corre cada minuto mientras la API está activa. El cierre automático sigue en su propia cola. Cada aviso usa una clave única: tipo y ventana para `round_missed`, tipo y turno para `shift_unsynced`; repetir el barrido no duplica el aviso ni el push. Una sincronización vuelve a evaluar inmediatamente las ventanas del turno.

## Regla de sincronizado hasta

`ShiftSyncState.syncedUntil` avanza de forma monótona con avisos de conexión y lotes. Una ventana iniciada se evalúa al vencer su gracia solo si `syncedUntil >= graceEndsAt`. Si falta esa certeza, queda `pending_sync`, con o sin señal en el predio. Un lote parcial evalúa únicamente las ventanas cubiertas. Los registros posteriores corrigen el estado: una ventana que resulta completa resuelve su aviso `round_missed` con `data_arrived`; el aviso `shift_unsynced` permanece en el historial. Los registros cuentan solo para la asignación que era dueña de la ventana cuando terminó.

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
