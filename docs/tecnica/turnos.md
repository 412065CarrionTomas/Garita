# Turnos

## Tiempos y día de servicio

Los instantes de inicio y fin se guardan como `timestamptz` UTC. `serviceDate` guarda la fecha local del inicio en la zona IANA de la empresa. Por eso un turno de lunes 20:00 a martes 08:00 pertenece al lunes, aunque su fin ocurra al día siguiente. La API usa el proveedor `CLOCK` para comparar el inicio con el instante actual y permitir que los tests reemplacen el reloj.

La duración permitida es de 1 a 24 horas. Los turnos futuros se editan o cancelan antes de su inicio; una vez iniciados, la operación corresponde a la futura reasignación de HU-44.

## Ventanas esperadas

La API usa `computeRoundWindows` de `@garita/shared` con `serviceDate`, la configuración vigente de cada ronda y la zona de la empresa. También calcula la franja que comenzó el día local anterior para incluir las ventanas de madrugada cuando el turno comienza después de medianoche. `windowsForShift` selecciona las ventanas cuyo fin cae dentro del turno; debe existir al menos una.

`assignWindowsToShifts(windows, shifts)` atribuye cada ventana al turno activo cuando termina. El extremo final se incluye: si el fin de ventana coincide con el fin de un turno, corresponde a ese turno. Una ventana sin turno, o cuyo turno está cancelado, queda como `notEvaluable`. HU-44 puede reutilizar esta regla al distribuir ventanas entre asignaciones de un turno.

`findUncoveredWindows` advierte las ventanas que empiezan durante un turno y terminan después cuando no hay otro turno del mismo predio y ronda que cubra el final. La advertencia no impide guardar el turno.

## Asignaciones y solapamientos

`Shift` conserva predio, empresa, inicio, fin, fecha de servicio, estado y datos de cancelación. `ShiftRound` relaciona las rondas seleccionadas; `roundVersionId` queda vacío hasta que HU-10 fije la versión al iniciar. `ShiftAssignment` conserva el vigilador, el tramo asignado, el actor y el historial; la asignación vigente ocupa el turno completo.

PostgreSQL habilita `btree_gist` y aplica una exclusión GiST sobre `guardId` y `tstzrange(startsAt, endsAt, '[)')` para las filas `active` con vigilador. El intervalo cerrado al inicio y abierto al fin permite turnos consecutivos sin considerarlos superpuestos. Las asignaciones sin vigilador no participan. Cancelar o reemplazar una asignación apaga `active` en la misma transacción que cambia el turno y libera el rango.

## Extensiones

- HU-10 fija `roundVersionId` al iniciar y aporta el cierre de turnos en curso.
- HU-32 implementa la terminación y derivación de programaciones semanales.
- HU-44 reutiliza la atribución de ventanas para reasignaciones.
- HU-45 envía notificaciones de asignación, cambio y cancelación.
