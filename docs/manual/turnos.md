# Turnos

## Consultar turnos

Administradores y supervisores pueden filtrar los turnos por predio, vigilador y rango de fechas. Los horarios se muestran en la zona local de la empresa. El día del turno es el día local en que empieza; un turno nocturno que termina al día siguiente conserva la fecha de inicio.

Un turno sin vigilador se identifica con una advertencia en la planificación. Un vigilador con invitación pendiente aparece indicado junto a su nombre.

## Ventanas de ronda

Antes de guardar un turno, el sistema verifica que alguna ventana de las rondas elegidas termine dentro del turno. Si una ventana empieza durante el turno pero termina después y ningún otro turno cubre ese fin, la API devuelve una advertencia para que el responsable la revise; se puede guardar de todos modos.

## Editar, cancelar y desactivar

Antes de la hora de inicio se puede editar o cancelar un turno. Después de esa hora solo se puede reasignar mediante HU-44. Para dar de baja un predio o un cliente, el flujo debe mostrar los turnos y programaciones afectados y solicitar confirmación antes de cancelar.

Al desactivar un vigilador, el flujo debe ofrecer derivar sus turnos futuros a otro vigilador o dejarlos sin vigilador con una segunda confirmación. Los turnos que se superponen con el nuevo vigilador quedan listados como no derivados.

## App del vigilador

La pantalla **Mis turnos** consulta los turnos de los próximos 14 días y muestra predio, fecha de servicio, inicio y fin locales y rondas. Se actualiza al abrirse y al deslizar hacia abajo.
