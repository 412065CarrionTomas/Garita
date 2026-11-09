# Reasignación de turnos — HU-44

Un supervisor asignado al predio o un administrador puede usar `POST /api/v1/turnos/:id/reasignar` con `{ "guardId": "...", "startsAt": "..." }`. `startsAt` es opcional y por defecto es la hora del servidor. Debe estar entre ahora y el fin del turno. `GET /api/v1/turnos/:id/asignaciones` devuelve el historial con vigilador, resultado, actor y hora de reasignación.

`GET /api/v1/turnos/:id/reemplazos?startsAt=...` devuelve únicamente `id`, `firstName` y `lastName` de vigiladores activos disponibles desde la hora elegida hasta el fin del turno, excluyendo al vigente. Omite `startsAt` para usar ahora. Comprueba superposiciones incluso en otros predios, sin revelar sus turnos. Tiene los mismos permisos que reasignar: 401 sin sesión, 403 para cliente/vigilador y 404 para otra empresa o supervisor no asignado. El POST vuelve a validar y PostgreSQL arbitra las superposiciones concurrentes.

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

Los cierres del vigilador, administrativos y reales recibidos después de un cierre automático guardan `closed_early` en la asignación dentro de la transacción cuando corresponde. `offerCoverage` actualiza el detalle por `turno.actualizado`, que habilita **Cubrir el resto** mientras quede tiempo y el cierre no sea por baja del predio. Los avisos los produce HU-35. Cada inicio y su reintento consultan el evento de la asignación vigente: la respuesta de un vigilador anterior no se reutiliza para el reemplazo.

En el panel, abrí el detalle del turno y elegí **Reasignar** o **Cubrir el resto**. Elegí un vigilador activo y, si corresponde, la hora de inicio. El historial muestra quién asignó y el resultado de cada intento; una sustitución posterior también puede devolver el turno a un vigilador anterior.

El diálogo exportado `ReassignDialog` en `apps/web/src/features/supervision/reassign-dialog.tsx` se puede abrir desde los avisos de HU-35. Recibe turno, fin, tiempo de traslado (nulo para predio con señal), modo cobertura y estado de apertura. Montalo al abrir para comenzar una selección nueva. Cambiar la hora vuelve a consultar disponibilidad y borra la selección anterior. La advertencia de traslado permite confirmar igual y también se muestra si llega en la respuesta del servidor.

Prueba manual pendiente en Android e iPhone: abrir un turno aún no iniciado, reasignarlo desde el panel, intentar iniciarlo en la pantalla que seguía abierta y comprobar “Tu turno fue reasignado. Consultá a tu supervisor”; con el reemplazo, iniciar diez minutos después de la hora elegida y comprobar su demora. Verificar BDD 1 a 5 desde el panel, navegación por Tab/Escape y los temas claro/oscuro; no se ejecutaron pruebas en dispositivos físicos.
