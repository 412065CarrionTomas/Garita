# Supervisión en vivo

La API ofrece `GET /api/v1/supervision/turnos` para los turnos de la fecha local de la empresa y `GET /api/v1/turnos/:id/detalle` para investigar un turno. Ambos requieren Firebase Authentication y los roles `admin` o `supervisor`; la consulta tenant limita al supervisor a sus predios y devuelve 404 para un turno ajeno. Los parámetros del listado son `estado`, `predio` y `fecha` (`YYYY-MM-DD`); el detalle acepta `marcados` y `gravedad` (`grave`, `media`, `leve`).

## Estado del turno

| Estado de supervisión                   | Transición                                           | Productor                                                                                             |
| --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `scheduled` (no iniciado)               | Creación hasta el inicio                             | Turnos                                                                                                |
| `in_progress` (en curso)                | Inicio autenticado                                   | Vigilador                                                                                             |
| `uncovered` (sin cobertura)             | Cierre temprano, hasta el fin programado             | Cierre del vigilador o administrador; el cierre queda guardado como `closed` con sus datos originales |
| `closed` (cerrado)                      | Cierre confirmado                                    | Vigilador o administrador                                                                             |
| `auto_closed` (cerrado automáticamente) | Vence el cierre y el plazo de sincronización         | Job BullMQ                                                                                            |
| `no_show` (no presentado)               | Finaliza un turno `scheduled` sin inicio             | Barrido BullMQ idempotente                                                                            |
| `unassigned` (sin vigilador)            | Turno sin asignación vigente o vigilador desactivado | Administración de turnos                                                                              |
| `cancelled` (cancelado)                 | Cancelación antes del inicio o baja del predio       | Supervisor o administrador                                                                            |
| `cancelled_by_suspension`               | Reservado para HU-43                                 | No implementado                                                                                       |

## Sincronización

La función compartida `computeSyncStatus` usa `ShiftSyncState`, el snapshot `syncDeadlineAt` y el cierre del turno. Un contacto es un aviso o lote recibido hace menos de cinco minutos. Los resultados son `al_dia`, `sincronizando` (incluye `pendingCount`), `sin_contacto` (hora y cantidad pendiente), `esperando_hasta` (plazo del predio sin señal), `sin_sincronizar`, `completo` y `cerrado_sin_datos` (reservado a la decisión HU-17). “Sin contacto” no afirma que el teléfono esté desconectado: iOS puede suspender el envío con la pantalla bloqueada.

## Ventanas

`RoundWindowState` se crea al iniciar el turno con la configuración de rondas fijada en su snapshot. La clave única es turno, ronda e índice de ventana. Los registros vuelven a calcular el estado con `windowCompletion`; el barrido del job actualiza ventanas vencidas. Estados: `pending`, `in_progress`, `late`, `complete`, `complete_late`, `incomplete`, `not_done`, `pending_sync` e `in_review`. `unassigned`, `no_show` y `uncovered` sin registros terminan en `not_done`; HU-39 incorpora después gravedad y decisiones de revisión. `severityLevel` queda nullable y no se calcula en HU-16.

## Socket.IO

Namespace: `/tiempo-real` (`SOCKET_NAMESPACE`). El cliente envía el ID token Firebase en `auth.token`. Sin token, con token inválido, cuenta inactiva o rol distinto de admin/supervisor, el servidor desconecta el socket. Cada conexión entra a las rooms `site:<id>` que puede ver; las asignaciones se vuelven a comprobar cada 60 segundos.

| Evento              | Room            | Payload                                       |
| ------------------- | --------------- | --------------------------------------------- |
| `turno.actualizado` | `site:<siteId>` | `{ shiftId, siteId }`                         |
| `registro.nuevo`    | `site:<siteId>` | `{ shiftId, siteId, checkpointId, recordId }` |
| `incidente.nuevo`   | `site:<siteId>` | `{ incidentId, siteId }`                      |
| `aviso.nuevo`       | `site:<siteId>` | `{ kind, siteId, shiftId? }`                  |

Los eventos solo llevan identificadores; la interfaz consulta el endpoint de detalle para los datos. `SOCKET_REDIS_ADAPTER_ENABLED=true` activa el adaptador Redis para distribuir eventos entre instancias; permanece apagado por defecto en local y pruebas.

## Límites de esta entrega

`canCover` permanece en `false` hasta HU-44. La reasignación dinámica de rooms se actualiza en un ciclo de hasta 60 segundos. El cierre sin datos y cancelación por suspensión quedan reservados a HU-17 y HU-43 respectivamente.
