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

Un cierre de una asignación anterior no marca completa la sincronización de su reemplazo. Solo se considera el cierre de la asignación vigente o un turno efectivamente cerrado.

La función compartida `computeSyncStatus` usa `ShiftSyncState`, el snapshot `syncDeadlineAt` y el cierre del turno. Un contacto es un aviso o lote recibido hace menos de cinco minutos. Los resultados son `al_dia`, `sincronizando` (incluye `pendingCount`), `sin_contacto` (hora y cantidad pendiente), `esperando_hasta` (plazo del predio sin señal), `sin_sincronizar`, `completo` y `cerrado_sin_datos`. “Sin contacto” no afirma que el teléfono esté desconectado: iOS puede suspender el envío con la pantalla bloqueada. La evaluación de rondas no usa la edad del contacto: espera a que `syncedUntil` cubra el fin de la gracia de cada ventana.

## Ventanas

Antes del inicio, el detalle lista los puntos de la versión vigente de cada ronda si todavía no se fijó una versión para el turno. Un punto figura registrado únicamente con un registro válido, computable y atribuido a una ventana del turno; las invalidaciones y lecturas fuera de ventana no lo marcan.

`RoundWindowState` se crea al iniciar el turno o en el barrido para turnos sin inicio. La clave única es turno, ronda e índice de ventana. Los registros vuelven a calcular el estado con `windowCompletion`; el job por minuto actualiza ventanas evaluables. Estados: `pending`, `in_progress`, `late`, `complete`, `complete_late`, `incomplete`, `not_done`, `pending_sync` e `in_review`. La regla completa está en [evaluacion-de-rondas.md](evaluacion-de-rondas.md).

## Socket.IO

Namespace: `/tiempo-real` (`SOCKET_NAMESPACE`). El cliente envía el ID token Firebase en `auth.token`. Sin token, con token inválido, cuenta inactiva o rol distinto de admin/supervisor, el servidor desconecta el socket. Cada conexión entra a las rooms `site:<id>` que puede ver; las asignaciones se vuelven a comprobar cada 60 segundos.

| Evento              | Room            | Payload                                       |
| ------------------- | --------------- | --------------------------------------------- |
| `turno.actualizado` | `site:<siteId>` | `{ shiftId, siteId }`                         |
| `registro.nuevo`    | `site:<siteId>` | `{ shiftId, siteId, checkpointId, recordId }` |
| `incidente.nuevo`   | `site:<siteId>` | `{ incidentId, siteId }`                      |
| `aviso.nuevo`       | `site:<siteId>` | `{ kind, siteId, shiftId? }`                  |
| `aviso.actualizado` | `site:<siteId>` | `{ noticeId, siteId }`                        |

Los eventos solo llevan identificadores; la interfaz consulta el endpoint de detalle para los datos. `SOCKET_REDIS_ADAPTER_ENABLED=true` activa el adaptador Redis para distribuir eventos entre instancias; permanece apagado por defecto en local y pruebas.

## Límites de esta entrega

`canCover` permanece en `false` hasta HU-44. La reasignación dinámica de rooms se actualiza en un ciclo de hasta 60 segundos. El cierre sin datos y cancelación por suspensión quedan reservados a HU-17 y HU-43 respectivamente.

## Panel

La ruta `/supervision` muestra los turnos del día para administradores y supervisores. Consulta `GET /supervision/turnos` con TanStack Query y aplica los filtros de estado y predio sobre los datos recibidos. El detalle está en `/supervision/turnos/:id` y consulta `GET /turnos/:id/detalle`. Sus secciones de ventanas, recorrido y registros son independientes para que HU-39 incorpore acciones de revisión sin rehacer la ficha. El filtro de marcas actúa sobre la lista de registros en el cliente para que el recorrido completo siga visible.

`apps/web/src/lib/realtime.ts` conecta con el token Firebase al namespace `/tiempo-real`. Los eventos `turno.actualizado`, `registro.nuevo` y `aviso.nuevo` invalidan las consultas de supervisión; el panel vuelve a pedir el estado completo al reconectar. `incidente.nuevo` muestra un aviso dentro del panel. El estado de conexión se ve en el layout y los cambios se anuncian con `aria-live`. El mapa usa MapLibre con tiles de OpenFreeMap (sin clave); si el proveedor no responde muestra un aviso y la lista ordenada del recorrido, con hora y distancia al punto configurado, queda siempre disponible.
