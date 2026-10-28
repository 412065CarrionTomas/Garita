# Reasignación de turnos — HU-44

Un supervisor asignado al predio o un administrador puede usar `POST /api/v1/turnos/:id/reasignar` con `{ "guardId": "...", "startsAt": "..." }`. `startsAt` es opcional y por defecto es la hora del servidor. Debe estar entre ahora y el fin del turno. `GET /api/v1/turnos/:id/asignaciones` devuelve el historial con vigilador, resultado, actor y hora de reasignación.

| Momento                                                        | Acción                  | Resultado anterior       |
| -------------------------------------------------------------- | ----------------------- | ------------------------ |
| Antes o justo a la hora de inicio de la asignación vigente     | Cambio de planificación | `replaced`               |
| Después de esa hora sin inicio                                 | Reasignación            | `absent`                 |
| Turno sin vigilador                                            | Asignación              | `replaced`, sin ausencia |
| Cierre anticipado del vigilador o administrador, antes del fin | Cubrir el resto         | `closed_early`           |
| En curso, cerrado normalmente, cancelado o no presentado       | Rechazo 409             | Sin cambio               |

La nueva asignación conserva el fin del turno y guarda `startsAt`, `assignedById` y `reassignedAt`. El turno queda `individuallyModified`; la programación semanal de HU-32 debe respetar ese campo. La restricción GiST de asignaciones activas evita que el reemplazo tenga otro turno superpuesto. En un predio sin señal, la respuesta incluye `warning: replacement_late` cuando la hora elegida más `minutesToSignal` supera el fin; la operación sigue permitida.

Una ventana pertenece a la asignación vigente al terminar mediante `windowOwner` de `@garita/shared`. La que termina exactamente al inicio del reemplazo permanece en la anterior. Una asignación `replaced` nunca rigió. La evaluación de ventanas y registros corresponde a HU-17; no se guarda `assignmentId` en `RoundWindowState`.

El inicio y la reasignación reclaman la asignación vigente con una actualización condicional (`isCurrent` y `result`) dentro de su transacción. El primero en reclamarla gana; el segundo recibe 409. El inicio tardío se calcula contra `startsAt` de la asignación reclamada. Los avisos abiertos se resuelven por `NOTICES_PORT`, y los dos vigiladores reciben una notificación del cambio.

En el panel, abrí el detalle del turno y elegí **Reasignar** o **Cubrir el resto**. Elegí un vigilador activo y, si corresponde, la hora de inicio. El historial muestra quién asignó y el resultado de cada intento; una sustitución posterior también puede devolver el turno a un vigilador anterior.
