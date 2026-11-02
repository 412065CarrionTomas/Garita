# Manual del vigilador

## Configuración inicial de permisos

Al ingresar al área de vigilador, Garita verifica que estén habilitados la ubicación precisa, los servicios de ubicación y la cámara. Si falta alguno, abre **Permisos para trabajar**. La ubicación precisa se utiliza al iniciar y cerrar el turno y al registrar puntos; la cámara se utiliza para leer códigos QR. Tocá **Configurar permisos**, aceptá los permisos solicitados y luego **Continuar**. Si cambiaste los permisos desde Ajustes, volvé a Garita para verificarlos otra vez.

## Iniciar un turno

En **Mis turnos**, tocá el turno que vas a cubrir. El inicio se habilita desde 30 minutos antes del horario programado y hasta el fin del turno, según el reloj del celular; el servidor confirma la validez definitiva. Para iniciar necesitás conexión. Garita registra un identificador único, la hora del dispositivo y una ubicación puntual (con estado no verificable si no se obtiene dentro de cinco segundos), consulta al servidor y guarda en el celular los datos de rondas, ventanas y puntos.

Si el turno fue reasignado, consultá a tu supervisor. Si ya tenés otro turno en curso, el turno no se puede iniciar. Si se revocaron permisos o la ubicación precisa está apagada, Garita vuelve a la configuración de permisos.

## Ver la ventana actual y los pendientes

Durante el turno, la pantalla presenta por cada ronda la ventana vigente y los puntos pendientes en el orden de esa ronda. Se calcula con los datos guardados en el teléfono y se actualiza cada minuto, al regresar a la app y cada vez que registrás un punto, por lo que podés consultarla y operarla sin señal.

## Registrar puntos con QR

Tocá **Escanear código QR** desde la pantalla del turno en curso para abrir el lector de cámara.

1. **Escaneo del punto:** apuntá la cámara hacia el sticker con código QR ubicado en el puesto o punto de control.
2. **Uso de linterna:** en recorridos nocturnos o sectores con poca luz, tocá el botón **Linterna** en la esquina superior para encender o apagar la luz del teléfono.
3. **Confirmación inmediata:** cuando el código entra en cuadro, la app vibra, emite un tono de confirmación y muestra en pantalla «{Nombre del punto} registrado». El punto se descuenta inmediatamente de los pendientes de la ventana en curso sin necesidad de esperar a la red ni al GPS.
4. **Captura de ubicación:** la confirmación ocurre al instante; en los cinco segundos posteriores la app obtiene las coordenadas del GPS y la precisión. Si no hay señal de satélite o el tiempo expira (por ejemplo en un subsuelo), el registro se almacena con la indicación de ubicación no verificable; si los permisos fueron revocados o la ubicación fue apagada, con ubicación desactivada. En puntos interiores configurados previamente, la falta de GPS no se considera sospechosa.
5. **Operación sin señal:** podés escanear todos los puntos de tu ronda sin conexión a internet. Los registros y los intentos se guardan en la base de datos local del teléfono, actualizan los pendientes de inmediato y quedan almacenados como eventos pendientes que se sincronizan con el servidor en cuanto se recupera la señal.
6. **Reglas automáticas y mensajes:**
   - **Punto ya registrado:** si intentás escanear nuevamente un punto que ya completaste en la vuelta actual, la app muestra «Este punto ya está registrado en esta vuelta» y no genera un segundo registro innecesario.
   - **Tiempo mínimo entre pasadas:** para evitar registrar dos vueltas juntas en una sola pasada, debe transcurrir al menos la mitad de la duración de la ventana entre registros de un mismo punto. Si intentás registrar antes, la app indica exactamente a partir de qué hora podés volver a hacerlo (por ejemplo: «Ya registraste Portón trasero a las 0:10. Podés volver a registrarlo desde la 1:10»).
   - **Registro durante el período de gracia:** si una ventana finalizó pero aún faltaba registrar un punto y te encontrás dentro de los minutos de gracia de la ronda, el registro se computa a la ventana anterior marcándola como «completa con demora».
   - **Puntos compartidos entre rondas:** si un mismo punto físico pertenece a más de una ronda asignada en tu turno (por ejemplo, «Galpón 1» en la ronda Perimetral y en la ronda Interna), un único escaneo lo registra simultáneamente en todas las rondas que lo incluyan en esa ventana.
   - **Códigos QR inválidos o ajenos:** si escaneás un código QR que no corresponde al predio o turno asignado, la app muestra «Este punto no pertenece a tu turno». Si el código fue reemplazado por una versión nueva, indica «Código QR desactualizado». El intento queda guardado localmente y se reporta al servidor para conocimiento de la supervisión.
   - **Permiso de cámara ausente:** si la cámara no cuenta con permiso, la app explica el motivo y muestra el botón para otorgarlo. Si el teléfono posee lector NFC, se ofrece la opción de registrar por NFC como alternativa.

## Pedir ayuda con el botón de pánico

Durante un turno en curso, el botón **Pánico** está disponible en las pantallas del vigilador. Mantenelo presionado dos segundos; un toque breve no activa nada. La app confirma el gesto con una vibración corta, sin sonido. La alerta queda guardada en el teléfono y se intenta enviar de inmediato, incluso si hay otros registros pendientes. Si no hay internet, queda pendiente de envío y se reintenta cuando vuelva la conexión.

El texto **Alerta recibida por la central** aparece solamente cuando el servidor registró la alerta. **Confirmada por el supervisor** aparece solamente después de que un supervisor confirmó su lectura. Sin esos textos, no supongas que la central ya recibió el pedido: buscá ayuda por otra vía disponible. No podés cancelar la alerta desde la app; avisá al supervisor si fue una falsa alarma. Una segunda activación de una alerta abierta queda registrada en la misma alerta. La práctica guiada y la resolución como «prueba» quedarán disponibles con HU-24.

## Con el celular bloqueado

En Android, mientras haya un turno en curso y estén habilitadas las notificaciones, aparece **Turno en curso**, sin datos del predio. Encendé la pantalla y tocá **Pánico**; luego tocá **Confirmar pánico** dentro de cinco segundos. Un solo toque no envía. Sin confirmación vuelve a **Pánico**; si el teléfono suspendió la app y quedó la etiqueta anterior, el toque vencido solo vuelve a armarla. La activación usa la misma alerta de la app, con vibración breve y sin sonido.

Al cerrar el turno, incluso sin internet, o cerrar sesión, desaparece el acceso. Si ves **Activá las notificaciones para usar el pánico con el celular bloqueado**, habilitalas en Ajustes del celular y volvé a Garita. La configuración de pantalla bloqueada y el ahorro de batería del fabricante pueden impedir que aparezca: practicá el gesto en tu teléfono con tu supervisor.

Sin internet, Android necesita el permiso SMS para enviarlo sin desbloquear. Sin ese permiso, la pantalla de envío del sistema no se puede usar con el celular bloqueado; no supongas que salió el SMS. La alerta queda pendiente para internet. Revisá en la app los estados confirmados y buscá ayuda por otra vía si no hay recepción.

En iPhone este acceso todavía está pendiente. Se prevé una actividad en vivo; hoy se usa el botón dentro de la app, desbloqueando el celular.

## Cerrar el turno

Tocá **Cerrar turno**. Si todavía no llegó el fin programado, escribí un motivo de al menos tres caracteres para habilitar el cierre. Garita registra un identificador único, la hora y una lectura puntual de ubicación. Con conexión, envía el cierre al servidor y elimina los datos activos del turno local cuando recibe confirmación.

## Qué pasa sin señal

### Sin datos: pánico por SMS

Al iniciar el turno en Android, Garita explica el permiso SMS: únicamente para emergencias sin datos o sin confirmación de la central. Podés rechazarlo; no se vuelve a pedir en ese turno.

Sin internet, el pánico intenta el SMS inmediatamente; con datos sin confirmación de la central, a los ocho segundos. Va a un solo número configurado por la empresa. Repetir una alerta abierta no envía otro SMS.

En Android con permiso se envía en segundo plano. En iPhone o Android sin permiso se abre la pantalla del sistema: **tocá enviar** y volvé a Garita. Si cancelás, el SMS no se envía.

- **SMS enviado**: Android confirmó salida hacia la red; no confirma recepción por la central.
- **SMS entregado**: la operadora informó entrega al teléfono; no significa lectura de un supervisor.
- **SMS preparado, sin confirmación de entrega**: se usó la pantalla del sistema; Garita no tiene confirmación de entrega.
- **No se pudo enviar**: falló, cancelaste o no hay destino. Sigue pendiente por internet; buscá ayuda por otra vía disponible.

Necesitás cobertura celular y una línea habilitada para SMS. Al volver internet, la alerta se reintenta: **Alerta recibida por la central** aparece cuando el servidor confirma; **Confirmada por el supervisor**, cuando confirma lectura. Esos textos tienen prioridad. El teléfono y el código se borran con los datos activos al confirmar el cierre y terminar de sincronizar. La recepción automática en la plataforma está prevista para HU-37: mientras se usa el teléfono de guardia, quien lo recibe debe actuar según el procedimiento de la empresa.

El inicio requiere conexión y no se guarda como iniciado si el teléfono está sin red. El registro de puntos y el cierre sí pueden realizarse sin conexión: los eventos quedan guardados en el teléfono como pendientes de envío, junto con los datos que HU-13 usará para sincronizar de forma idempotente. La pantalla del turno se actualiza inmediatamente sin red con los registros locales. Cuando vuelva la conexión, mantené la app instalada hasta que la sincronización envíe los eventos pendientes.

## Verificación manual de ID-138 e ID-143

- [ ] Android: revocar ubicación precisa, volver a la app y confirmar que abre configuración y bloquea el inicio.
- [ ] Android: intentar iniciar sin conexión y confirmar el mensaje «Necesitás conexión para iniciar el turno» y que no se inicia.
- [ ] Android: intentar un cierre antes del fin sin motivo y confirmar que queda bloqueado; ingresar un motivo válido y confirmar el cierre.
- [ ] Android: cerrar sin conexión, cerrar la app y volver a abrir el turno guardado; confirmar el estado pendiente de envío.
- [ ] Android: escanear código QR válido y confirmar vibración, sonido, mensaje «{Punto} registrado» en menos de cinco segundos y que el punto desaparece de la lista de pendientes.
- [ ] Android: escanear código QR en penumbra o de noche activando el botón de linterna.
- [ ] Android: escanear código QR de otro predio y confirmar el mensaje «Este punto no pertenece a tu turno» y el guardado del intento.
- [ ] Android: escanear código QR desactualizado y confirmar mensaje «Código QR desactualizado».
- [ ] Android: escanear dos veces seguidas el mismo punto en la misma ventana y verificar el mensaje de punto ya registrado o el tiempo mínimo («Ya registraste... Podés volver a registrarlo desde...»).
- [ ] Android: escanear un punto en modo avión o sin señal de GPS y verificar confirmación inmediata con indicación no verificable y registro local sin conexión.
- [ ] Android: denegar permiso de cámara y comprobar mensaje explicativo y ofrecimiento de NFC en dispositivos compatibles.
- [ ] iPhone: repetir verificación de permisos, inicio, cierre anticipado, reapertura sin red, escaneo de QR y linterna. Pendiente de validación en dispositivo iOS físico.
