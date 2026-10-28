# Turnos

## Persistencia y tiempo

`Shift` guarda empresa, predio, `startsAt` y `endsAt` como instantes UTC, `serviceDate` como fecha local del inicio en la zona IANA de la empresa, estado (`scheduled`, `unassigned` o `cancelled`), creador y datos de cancelación. Un turno de lunes 20:00 a martes 08:00 pertenece al lunes local. La duración admitida es de 1 a 24 horas. El `CLOCK` inyectable determina si el inicio quedó en el pasado y si un turno ya empezó.

`ShiftRound` guarda las rondas del turno. `roundVersionId` queda nulo hasta que HU-10 fije la versión al inicio. `ShiftAssignment` guarda vigilador opcional, intervalo asignado, actor y estado actual. Editar un turno futuro reemplaza la asignación dentro de una transacción, sin registrar una ausencia. Si el inicio ya pasó, editar o cancelar responde `409 SHIFT_STARTED`; la operación queda para la reasignación de HU-44.

## Ventanas esperadas y cobertura

`computeRoundWindows` recibe una fecha local explícita, la franja, la frecuencia y la zona IANA, y produce ventanas UTC con etiquetas locales. El cálculo incluye las ventanas de la fecha local anterior para turnos que empiezan después de medianoche. `windowsForShift` incluye ventanas que terminan dentro del turno, aun si empezaron antes. Debe terminar al menos una ventana para cada turno válido.

`assignWindowsToShifts(windows, shifts)` asigna cada ventana al turno que está activo cuando termina. El fin del turno se incluye: si la ventana termina exactamente con el turno, corresponde a ese turno. Por ejemplo, ante turnos 21:00–01:00 y 01:00–09:00, la ventana 00:00–02:00 corresponde al segundo turno. Una ventana sin turno responsable o de un turno cancelado queda como `notEvaluable`.

`findUncoveredWindows` detecta ventanas que empiezan durante un turno y terminan después cuando ningún turno no cancelado del mismo predio con esa ronda cubre el fin. Es una advertencia previa y no impide guardar. Al crear el turno siguiente (por ejemplo, 01:00–09:00) la ventana puede quedar cubierta y desaparecer del aviso.

## Restricción de solapamientos

La migración habilita `btree_gist` y crea una exclusión GiST sobre `guardId` y `tstzrange(startsAt, endsAt, '[)')` para asignaciones `active` con vigilador. Los intervalos incluyen su inicio y excluyen su fin, de modo que dos turnos consecutivos sí son válidos. Una asignación sin vigilador no activa la restricción. Cancelar o reemplazar una asignación apaga `active` en la misma transacción que actualiza el turno y libera el rango. El servicio detecta conflictos antes de escribir y transforma la carrera detectada por PostgreSQL en `409 SHIFT_OVERLAP` con el turno en conflicto.

## API

Las rutas tienen prefijo `/api/v1` y requieren autenticación y rol habilitado.

| Método y ruta                                                      | Uso                                                                                             | Respuestas relevantes                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /turnos`                                                      | Lista y filtra por `predio`, `vigilador`, `desde`, `hasta` y `sinVigilador`                     | `200`                                                                    |
| `POST /turnos`                                                     | Crea turno, asignación y rondas                                                                 | `201`, `400` si no hay ventanas que terminen dentro, `409 SHIFT_OVERLAP` |
| `GET /turnos/:id`                                                  | Consulta un turno visible                                                                       | `200`, `403` para un vigilador que pide un turno ajeno                   |
| `PATCH /turnos/:id`                                                | Edita un turno antes del inicio                                                                 | `200`, `409 SHIFT_OVERLAP` o `SHIFT_STARTED`                             |
| `POST /turnos/:id/cancelar`                                        | Cancela antes del inicio                                                                        | `201`, `409 SHIFT_STARTED`                                               |
| `GET /mis-turnos`                                                  | Próximos 14 días del vigilador autenticado                                                      | `200`                                                                    |
| `GET /usuarios/:id/turnos-futuros`                                 | Turnos que aún no empezaron, para preparar la desactivación                                     | `200`                                                                    |
| `POST /usuarios/:id/desactivar`                                    | Deriva a un vigilador activo o pendiente, o los deja sin vigilador con `confirmUnassignedCount` | `201`, `409` si falta la decisión o cambió el conteo                     |
| `GET /predios/:id/impacto-baja` y `GET /clientes/:id/impacto-baja` | Resumen de turnos, programaciones y turnos en curso afectados                                   | `200`                                                                    |
| `POST /predios/:id/baja` y `POST /clientes/:id/baja`               | Baja confirmada con `{ "confirm": true }`                                                       | `201`, `409` si falta confirmación                                       |

`admin` gestiona todos los predios de la empresa; `supervisor` solo los asignados; `guard` consulta exclusivamente `GET /mis-turnos`; `client` no gestiona turnos. El aislamiento por empresa se aplica con `tenantPrisma`.

## Bajas y derivación

Antes de la baja de un predio o cliente, la interfaz obtiene el impacto. El resumen separa turnos que se cancelan (no iniciados, aunque su inicio horario haya pasado), programaciones semanales que terminan y turnos en curso que se cierran. La confirmación cancela los turnos y realiza la baja en una transacción; las ventanas vencidas conservan su estado. Los puertos `WeeklyScheduleTerminationPort` e `InProgressShiftClosurePort` son puntos de extensión para HU-32 y HU-10.

Al desactivar a un vigilador, la API lista turnos futuros. Con `deriveToUserId`, deriva los que no se superponen y devuelve los restantes; el destino puede estar activo o tener la invitación pendiente. Con `leaveUnassigned: true`, la segunda confirmación incluye el número visible en `confirmUnassignedCount`; si el conteo cambió, debe actualizarse la decisión. Los turnos sin vigilador conservan ese estado al terminar y sus rondas no se atribuyen a un vigilador; se pueden asignar antes del inicio como una edición o, si ya empezó, mediante HU-44.

## Puntos de extensión

- HU-10 fija `roundVersionId` al iniciar el turno y cierra turnos en curso por baja.
- HU-32 reemplaza los puertos de terminación y derivación de programaciones semanales.
- HU-44 reutiliza la regla de atribución de ventanas para reasignaciones.
- HU-45 notifica asignación, cambio, reasignación y cancelación.
