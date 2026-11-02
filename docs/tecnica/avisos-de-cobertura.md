# Avisos de cobertura (HU-35)

El job BullMQ `coverage-notices` ejecuta un barrido cada 60 segundos con `CLOCK`. Consulta `systemPrisma` sin contexto de request y restringe cada consulta de turnos por empresa y predio activo; registra la operación sin ubicaciones ni datos personales.

| Aviso                 | Umbral y candidatos                                                                                                                 | Clave del sujeto         | Resolución                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| `shift_not_started`   | Turno scheduled, asignación vigente activa scheduled y vigilador activo; desde su inicio + 15 minutos hasta antes del fin del turno | ID de asignación         | Inicio: late_start; reasignación: reassigned       |
| `shift_without_guard` | Turno unassigned o con invitación pendiente; desde computeStartWindow(inicio, conectividad) menos 120 minutos, hasta antes del fin  | ID del turno             | Asignar por edición o reasignación: guard_assigned |
| `shift_closed_early`  | Cierre real anterior al fin; cierre del vigilador, cierre tardío tras auto_close o cierre administrativo al desactivar              | ID de asignación cerrada | Cubrir el resto: covered                           |

La unique `Notice.key = noticeKey(kind, subjectId)` evita duplicar aviso y push ante barridos y cierres repetidos. Cada reemplazo tiene su propio aviso de no iniciado. Un turno sin vigilador nunca produce no iniciado. El barrido detecta cambios con menos anticipación en su siguiente ejecución (intervalo de un minuto). El cierre temprano se genera después del commit, sin esperar el barrido. La baja del predio se excluye explícitamente.

`CoverageNoticesService.isCompanySuspended` es el punto de extensión `TODO(HU-43)` y hoy devuelve false. Una empresa suspendida no produce avisos del barrido, pero conserva los cierres tempranos. El test usa un doble suspendido; no implementa suspensión real.

El cierre guarda reason, closedBy, closedByUserId, closedByName, closedAt, receivedAt y late en details. Late significa recepción más de un minuto después del cierre. La push tardía dice “Cerrado a las HH:mm, recibido a las HH:mm” en la zona de la empresa, sin motivo libre ni nombre del actor. El panel muestra ambos instantes, motivo y autor para los roles autorizados. El inicio tardío conserva el lateStartMinutes calculado por ejecución de turno.

## Preferencias personales

NotificationPreference tiene unique (userId, kind), companyId y push=true por defecto. Sin fila, la push está activada. GET y PUT `/api/v1/mis-preferencias/notificaciones` usan el contrato estricto `{ shift_not_started: boolean }`, solo para admin y supervisor; el usuario y empresa provienen de la autenticación. No reciben IDs externos. Los endpoints están documentados en Swagger.

Al crear un aviso mutable se consultan preferencias push=false de su empresa y se pasan como excludeUserIds a notifySiteStaff. Se conserva la selección existente de administradores y supervisores activos asignados. Los demás tipos ignoran preferencias. El aviso y sus eventos realtime se crean igualmente y el panel lo lista aun para quien silenció la push.

## Panel y comprobación manual

`/avisos/preferencias` se enlaza desde Avisos. El Switch tiene etiqueta visible, estado accesible y confirmación role=status. Los tres avisos abiertos reutilizan ReassignDialog para reasignar, cubrir o asignar. `aviso.actualizado` ya invalida lista y detalle mediante la clave avisos.

Pendiente en un panel con push real y lector de pantalla: BDD 1 (no iniciado y reasignación), BDD 3 (silenciar solo un supervisor), BDD 4 (motivo, autor y cubrir), BDD 6 (sin vigilador y asignación); verificar claro/oscuro, 360 px, Tab y Escape. Los tests automatizados no reemplazan estas verificaciones.
