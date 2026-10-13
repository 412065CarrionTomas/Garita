# Manual del vigilador

## Configuración inicial de permisos

Al ingresar al área de vigilador, Garita verifica que estén habilitados la ubicación precisa, los servicios de ubicación y la cámara. Si falta alguno, abre **Permisos para trabajar**. La ubicación precisa se utiliza al iniciar y cerrar el turno y al registrar puntos; la cámara se utiliza para leer códigos QR. Tocá **Configurar permisos**, aceptá los permisos solicitados y luego **Continuar**. Si cambiaste los permisos desde Ajustes, volvé a Garita para verificarlos otra vez.

## Iniciar un turno

En **Mis turnos**, tocá el turno que vas a cubrir. El inicio se habilita desde 30 minutos antes del horario programado y hasta el fin del turno, según el reloj del celular; el servidor confirma la validez definitiva. Para iniciar necesitás conexión. Garita registra un identificador único, la hora del dispositivo y una ubicación puntual (con estado no verificable si no se obtiene dentro de cinco segundos), consulta al servidor y guarda en el celular los datos de rondas, ventanas y puntos.

Si el turno fue reasignado, consultá a tu supervisor. Si ya tenés otro turno en curso, el turno no se puede iniciar. Si se revocaron permisos o la ubicación precisa está apagada, Garita vuelve a la configuración de permisos.

## Ver la ventana actual y los pendientes

Durante el turno, la pantalla presenta por cada ronda la ventana vigente y los puntos pendientes en el orden de esa ronda. Se calcula con los datos guardados en el teléfono y se actualiza cada minuto y al regresar a la app, por lo que podés consultarla sin señal. La función de registrar puntos se incorpora en HU-11.

## Cerrar el turno

Tocá **Cerrar turno**. Si todavía no llegó el fin programado, escribí un motivo de al menos tres caracteres para habilitar el cierre. Garita registra un identificador único, la hora y una lectura puntual de ubicación. Con conexión, envía el cierre al servidor y elimina los datos activos del turno local cuando recibe confirmación.

## Qué pasa sin señal

El inicio requiere conexión y no se guarda como iniciado si el teléfono está sin red. El cierre sí puede realizarse sin conexión: el evento queda guardado en el teléfono como **cerrado, pendiente de envío**, junto con los datos que HU-13 usará para sincronizarlo de forma idempotente. La pantalla se reconstruye con esos datos si cerrás y volvés a abrir la app. Cuando vuelva la conexión, mantené la app instalada y los datos locales hasta que la cola automática de HU-13 envíe el evento.

## Verificación manual de ID-138

- [ ] Android: revocar ubicación precisa, volver a la app y confirmar que abre configuración y bloquea el inicio.
- [ ] Android: intentar iniciar sin conexión y confirmar el mensaje «Necesitás conexión para iniciar el turno» y que no se inicia.
- [ ] Android: intentar un cierre antes del fin sin motivo y confirmar que queda bloqueado; ingresar un motivo válido y confirmar el cierre.
- [ ] Android: cerrar sin conexión, cerrar la app y volver a abrir el turno guardado; confirmar el estado pendiente de envío.
- [ ] iPhone: repetir permisos revocados, inicio sin conexión, cierre anticipado y reapertura sin red. Pendiente de validación en dispositivo iOS.
