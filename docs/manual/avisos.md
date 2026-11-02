# Avisos del panel

Ingresá con una cuenta de administrador o supervisor y abrí **Avisos** en el menú. El número entre paréntesis indica los avisos abiertos que todavía no abriste; cada supervisor tiene su propio estado de lectura.

## Consultar y abrir

El listado empieza en **Abiertos**. Usá **Tipo**, **Estado** y **Predio** para encontrar lo que necesitás. Los filtros funcionan con teclado: Tab para cambiar de campo y flechas para elegir una opción.

- **Ronda incumplida:** revisá los puntos faltantes y la gravedad. Abrí el aviso y elegí **Ver turno** para investigar los registros.
- **Turno sin sincronizar:** el plazo venció y faltan datos del celular. Consultá al vigilador antes de decidir un cierre sin datos.
- **Turno no iniciado**, **Turno cerrado antes de hora** y **Turno sin vigilador:** informan falta de cobertura. Ofrecen acciones para recuperar la cobertura.

**No visto** se muestra con texto y borde. **Abrir aviso** registra tu lectura y actualiza el contador; no lo resuelve ni afecta a otro supervisor. Los enlaces de las notificaciones abren el aviso directamente. Se muestran predio, fecha y horario del turno, hora del evento y, cuando es distinta y está disponible, hora de recepción.

Los avisos nuevos llegan con el panel abierto y se anuncian al lector de pantalla. Si aparece **Reconectando…**, esperá la reconexión; el panel vuelve a consultar los avisos al recuperar la conexión.

## Cerrar sin datos

Usá esta acción cuando el turno sigue sin sincronizar y sus datos no van a llegar, por ejemplo por un celular roto o perdido.

1. Abrí el aviso de **Turno sin sincronizar** y elegí **Cerrar sin datos**. También está en **En vivo → Ver detalle** del turno, cuando tiene ese aviso abierto.
2. Escribí un motivo de entre 5 y 500 caracteres.
3. Marcá **Confirmo el cierre sin datos de este turno** y confirmá con **Cerrar sin datos**.

Las ventanas pendientes pasan a no realizadas. El sistema registra tu usuario, la hora y el motivo. Si los datos llegan después, se vuelven a evaluar los registros reales y la decisión queda guardada. Si la API informa que el estado cambió (409), leé el mensaje y revisá el turno antes de intentar otra vez. Podés cancelar el diálogo con **Cancelar** o Escape.

## Historial

Elegí **Resueltos** en Estado. Cada aviso conserva su resolución y fecha, por ejemplo **Llegaron los datos** o **Cerrado sin datos**. Ver un aviso y resolverlo son decisiones distintas.

## Avisos de cobertura y preferencias

- **Turno no iniciado:** desde 15 minutos después del inicio de la asignación vigente. Abrí **Reasignar turno**, elegí un vigilador activo y confirmá el inicio del reemplazo. Si el vigilador inicia después del aviso, se resuelve como **Inicio tardío**.
- **Turno cerrado antes de hora:** muestra el motivo y quién cerró. Si llegó tarde, muestra “Cerrado a las HH:mm, recibido a las HH:mm”. Elegí **Cubrir el resto**, seleccioná el reemplazo y confirmá. No se genera por la baja del predio.
- **Turno sin vigilador:** aparece dos horas antes de que se pueda iniciar, considerando el viaje de los predios sin señal. También avisa si la cuenta del vigilador sigue con invitación pendiente. Elegí **Asignar vigilador**, seleccioná uno activo y confirmá.

Las acciones están disponibles solo para avisos abiertos; el servidor comprueba que todavía se pueda cubrir el turno. Los avisos se actualizan al resolverlos y quedan en el historial. El diálogo conserva la advertencia de traslado cuando el reemplazo podría llegar después del fin.

Desde el encabezado de **Avisos**, entrá a **Preferencias de notificación**. El interruptor **Notificarme los turnos no iniciados** guarda tu elección y anuncia **Preferencia guardada**. Viene activado por defecto. Desactivarlo solo silencia tu push: seguís viendo el aviso y los demás supervisores conservan su preferencia. Los demás avisos no se pueden silenciar porque el predio queda sin vigilancia.
