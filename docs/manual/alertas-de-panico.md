# Atención de alertas de pánico

Entrá al panel como supervisor o administrador y abrí **Alertas de pánico**. El número del menú indica cuántas alertas siguen activas en tus predios. Podés filtrar por estado y predio; el historial muestra primero las más recientes.

## Recibir una alerta

Con el panel abierto aparece un banner destacado, con ícono, texto y anuncio para lectores de pantalla. Tocá **Atender alerta** para abrir el detalle. También podés abrirlo desde la notificación push o el historial. Solo los supervisores asignados y el administrador pueden consultar la información.

Tocá **Activar sonido de alertas** al comenzar tu guardia. La preferencia queda guardada en ese navegador. Si el navegador vuelve a bloquear el audio después de recargar, tocá el botón nuevamente. El tono se repite cada cuatro segundos mientras haya alertas activas y se detiene cuando todas están confirmadas o resueltas.

Mantené habilitadas las notificaciones y verificá volumen, silencio y No molestar. Una pestaña suspendida puede dejar de sonar. En iPhone instalá la PWA y concedé permiso cuando el sistema lo solicite; las notificaciones no garantizan saltar el modo silencio. Probá el funcionamiento en tu equipo antes de iniciar la guardia.

## Confirmar

1. Abrí la alerta y revisá vigilador, predio, hora y ubicación.
2. Tocá **Confirmar alerta**. Se registra tu nombre y la hora; el vigilador puede ver que fue confirmada.
3. Usá **Llamar al vigilador** para comunicarte, si tiene teléfono registrado. Seguí el procedimiento de emergencias de tu empresa.

Confirmar indica que alguien está atendiendo la alerta; todavía requiere resolución. Si otra persona ya la confirmó, el panel actualiza su estado. Si nadie confirma en dos minutos desde que la plataforma la recibió, se reenvía la notificación y se escala al administrador, una sola vez.

## Resolver

1. La alerta debe estar confirmada. Mientras siga activa, **Resolver alerta** está deshabilitado y pide confirmarla primero.
2. Abrí **Resolver alerta**, elegí **Emergencia real**, **Falsa alarma** o **Prueba**.
3. Escribí un comentario de entre 5 y 1.000 caracteres explicando cómo se atendió y tocá **Guardar resolución**.

Quedan guardados resultado, comentario, autor y hora. Podés resolver una alerta confirmada por otro destinatario, incluso si esa persona ya no está disponible. Los controles se operan con Tab y las teclas habituales del navegador; el diálogo tiene etiquetas y errores anunciados.

## Alertas recibidas con demora y SMS

El detalle conserva hora de envío y de recepción, además del canal de origen. Si la diferencia supera un minuto, muestra por ejemplo: **Enviada por SMS a las 03:10, recibida por la plataforma a las 03:25**. Las horas corresponden a la zona horaria de la empresa. La espera hasta escalamiento comienza en recepción; la emergencia pudo comenzar antes. Si una futura alerta indica **No verificada**, atendela igualmente y verificá su origen por el procedimiento de tu empresa.

**En esta versión el backend no envía SMS reales a destinatarios.** Solo registra el intento como **Omitido (sin envío)**. El proveedor real está previsto para Sprint 5. Los estados futuros **Aceptado por el proveedor** y **Fallido** tampoco equivalen a que alguien leyó el mensaje. No dependas de este canal para la respuesta operativa actual.

Si no se registró ubicación o el mapa no está configurado, el detalle lo informa. Cuando existen coordenadas, siempre aparecen por escrito. El mapa representa la última ubicación disponible y su precisión, no un seguimiento garantizado en vivo.
