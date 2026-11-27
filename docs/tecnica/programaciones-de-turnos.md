# Programaciones semanales de turnos (HU-32)

Un administrador o supervisor puede crear una programación desde **Turnos → Programaciones**. El supervisor solo puede operar en sus predios asignados. La empresa se obtiene de la sesión y las consultas usan `tenantPrisma`; vigiladores y clientes no acceden a estos endpoints.

## Período y horario

`weekdays` usa la numeración de JavaScript: 0 domingo, 1 lunes, hasta 6 sábado. Cada día identifica el inicio del turno. Un lunes de 22:00 a 06:00 termina el martes, conservando el lunes como `serviceDate`.

Las fechas inicial y final se incluyen. El límite es de tres meses de calendario: se aplica `isReportExportPeriodAllowed(startDate, endDate + 1 día)`, con la misma regla de fin excluido de HU-40. Así, del 1 de enero al 31 de marzo es válido; hasta el 1 de abril no. El límite se ajusta al último día del mes cuando el día original no existe. Cada extensión tiene su propio límite de tres meses y empieza al día siguiente del fin anterior.

Modificar únicamente días, horas, rondas, predio o vigilador conserva el período ya aprobado, incluso si fue extendido más allá de tres meses acumulados. Cambiar las fechas define un período nuevo y vuelve a exigir el tope. La regeneración de una programación iniciada se recorta a hoy para conservar su historial.

Las horas se interpretan en `Company.timezone`, mediante `localDateTimeToUtc`; no se suma una duración UTC fija entre días. Fin menor o igual al inicio significa el día siguiente. Cada turno debe cumplir también el límite real de 1 a 24 horas de HU-09. Una hora inexistente durante el salto de horario de verano se rechaza explícitamente; para una hora ambigua se usa la resolución determinista del conversor compartido. No se permite iniciar antes de hoy en la empresa ni generar un turno cuya hora de inicio ya pasó.

## API

Todos los paths llevan el prefijo `/api/v1`. Swagger está en `/api/docs`.

| Método y recurso                            | Operación                                                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/programaciones-turnos/previsualizar` | Valida cada turno; devuelve fechas, conflictos identificados y ventanas sin cubrir, sin persistir. Para editar, el query opcional `programacion` excluye los turnos reemplazables de esa programación.                     |
| POST `/programaciones-turnos`               | Crea programación y turnos sin conflicto en una única transacción.                                                                                                                                                         |
| GET `/programaciones-turnos`                | Devuelve `{ items, expiring }`. Filtra por `predio`, `vigilador`, `q` y `estado` (`vigente` por defecto, `por_vencer`, `finalizada`, `cancelada`); cada ítem suma nombres, días hasta el fin y turnos próximos y editados. |
| PATCH `/programaciones-turnos/:id`          | Acepta campos parciales y regenera los turnos reemplazables; devuelve generados, reemplazados, conservados y conflictos.                                                                                                   |
| POST `/programaciones-turnos/:id/extender`  | Recibe `{ endDate }` y agrega solo la continuación.                                                                                                                                                                        |
| POST `/programaciones-turnos/:id/cancelar`  | Cancela los futuros sin iniciar y conserva los demás.                                                                                                                                                                      |

La entrada incluye `siteId`, `guardId`, `weekdays`, `startTime`, `endTime`, `roundIds`, `startDate` y `endDate`. Los contratos y el generador puro viven en `packages/shared/src/shifts/schedules.ts`.

Las escrituras se ejecutan con aislamiento serializable; se bloquea la fila de la programación antes de modificar, extender o cancelar. Ante una modificación concurrente o la exclusión de superposición de PostgreSQL se responde 409 `SCHEDULE_CHANGED`: hay que previsualizar nuevamente. La creación no tiene clave de idempotencia y no debe reintentarse automáticamente tras una respuesta de resultado desconocido; consultar primero el listado.

## Validación, conflictos y cobertura

`ShiftsService.loadValidation` obtiene por lote predio, vigilador y rondas; `validatePrepared` aplica las mismas reglas a cada turno sin repetir consultas: predio activo y asignado al supervisor, vigilador activo o con invitación pendiente, rondas activas del predio y al menos una ventana que termine dentro del turno. Los esquemas de HU-09 controlan duración y rondas duplicadas.

Los conflictos se leen de las asignaciones activas del vigilador de la empresa, incluyendo otros predios. Cada candidato informa el ID y el intervalo del turno con el que se superpone; los conflictivos se omiten al confirmar. Se calculan las ventanas de los días de inicio y del anterior con las funciones de HU-09; `findUncoveredWindows` considera también los otros turnos del predio. Las ventanas sin cubrir son advertencias y permiten confirmar.

## Regeneración y cancelación

Solo son reemplazables los turnos `scheduled` o `unassigned`, con inicio futuro, sin `startedAt` y sin `individuallyModified`. Cualquier otro estado se conserva, incluidos estados incorporados por otras historias. Los días ocupados por turnos conservados no vuelven a generarse. Editar un turno individual, cambiar su vigilador o reasignarlo activa la marca de modificación individual.

Los turnos reemplazados quedan cancelados con motivo **Regeneración de programación**, preservando historial. Esa cancelación técnica no ocupa el día en futuras regeneraciones; una cancelación individual sí se conserva. La nueva programación y sus turnos se guardan en la misma transacción: un error revierte también las cancelaciones. Los efectos externos se entregan después del commit.

La cancelación comparte la operación transaccional de HU-09 y sus notificaciones posteriores al commit. Una creación, modificación o extensión envía un único resumen al vigilador por los nuevos turnos; no un aviso de asignación por turno. Las cancelaciones conservan sus avisos de HU-09. Los logs incluyen usuario, cantidades generadas, conflictos y afectados, sin nombres ni ubicaciones.

## Desactivación y bajas

Los puertos ya existentes se implementan mediante `ScheduleLifecycleService`, sin dependencias hacia `UsersModule` ni ciclos. Al derivar un vigilador, HU-09 sigue moviendo sus turnos sin conflicto y devolviendo `notDerived`; la programación cambia de vigilador como unidad y los turnos derivados quedan marcados individualmente. Sin derivación, la programación pasa a `finished` y HU-09 deja sus turnos sin vigilador. Los superpuestos conservan el tratamiento existente y se informan en la respuesta de desactivación.

La baja de un predio o cliente ya cancela sus turnos; el adaptador únicamente termina las programaciones dentro de la misma transacción y aporta el conteo al diálogo de impacto. Una programación vencida deja de listarse como vigente por fecha, sin necesidad de un job.

## Uso del panel y prueba manual pendiente

1. Elegir **Nueva programación**, predio, vigilador, días, horario, rondas y período. **Previsualizar** muestra los turnos, conflictos y ventanas sin cubrir. **Confirmar programación** guarda solo los turnos sin conflicto.
2. En **Modificar**, cambiar el horario, previsualizar y confirmar. El resumen identifica los afectados y conservados. Los distintivos de la pantalla de turnos muestran la programación y las modificaciones individuales.
3. **Extender** solicita la nueva fecha final. **Cancelar programación** exige confirmación e informa el resultado.
4. Los feriados y esquemas 12x36, 4x4 u otros no semanales se cargan como turnos individuales; no hay excepciones automáticas de calendario.

Checklist manual (no sustituida por los tests de componentes):

- [ ] BDD 1: lunes a viernes 22–06 del 5 al 30 de octubre de un período futuro equivalente: 20 turnos, por día de inicio; próximos 14 días visibles en la app existente.
- [ ] BDD 2: agregar el turno del miércoles 14 de 20–08: conflicto identificado y 19 turnos creados.
- [ ] BDD 3: editar a mano el jueves 22 para empezar a las 23; modificar programación a las 21 y comprobar que ese turno se conserva.
- [ ] BDD 4: con 8 realizados y 12 futuros, cancelar: 12 cancelados y 8 conservados.
- [ ] Navegar con Tab, Shift+Tab, Espacio y Enter; verificar foco visible y anuncio de día/selección y resultados con lector de pantalla.
- [ ] Revisar claro/oscuro y ancho móvil, conflictos con texto y advertencias sin bloqueo.
