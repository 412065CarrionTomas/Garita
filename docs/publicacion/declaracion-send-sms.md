# Declaración de SEND_SMS — HU-23 / ID-281

Estado: texto y guion preparados. El usuario debe grabar video y capturas, enviar la declaración en Google Play y seguir la revisión; este archivo no acredita envío ni aprobación.

## Texto propuesto

Garita es una aplicación de seguridad para vigiladores durante sus turnos. Su alerta de pánico permite pedir auxilio a la guardia de la empresa cuando no hay internet o el servidor no confirma recepción en ocho segundos. Solicitamos la excepción de seguridad física y alertas de emergencia para `android.permission.SEND_SMS`.

Usamos el permiso exclusivamente para enviar un SMS de emergencia a un único destinatario configurado por la empresa y descargado al iniciar el turno. El mensaje contiene identificador corto, código aleatorio de turno, hora y última ubicación; con respaldo añade predio y enlace al mapa. No leemos mensajes ni llamadas ni usamos el permiso para publicidad, analítica o comunicaciones secundarias.

Antes de pedir el permiso, al iniciar el turno explicamos su finalidad y solicitamos consentimiento. El vigilador puede rechazarlo y seguir usando la app: en una emergencia se abrirá el compositor del sistema con destinatario y mensaje listos para tocar enviar. En iPhone se usa siempre ese respaldo.

El envío automático evita interacción con otra pantalla durante una situación de peligro. Garita distingue envío confirmado por el sistema, entrega informada por la operadora y mensaje preparado sin confirmación de entrega. La alerta queda guardada para reintentar por internet independientemente del SMS. Repetir la activación de una alerta abierta no envía otro SMS.

## Guion del video

Usar dispositivos y números de prueba autorizados. No mostrar códigos, teléfonos, ubicaciones o credenciales reales en material público. Registrar modelo, versión, operadora, fecha y tiempos.

1. Mostrar inicio del turno, explicación previa del uso exclusivo y consentimiento; capturar también el diálogo de Android.
2. Conceder SEND_SMS, desactivar datos/Wi-Fi manteniendo cobertura y activar pánico dos segundos. Mostrar envío sin otra pantalla y «SMS enviado» tras acuse. Capturar «SMS entregado» si la operadora lo informa y SMS en el receptor.
3. Activar de nuevo y verificar que no sale otro SMS para la alerta. Mostrar destinatario único y formato con datos de prueba.
4. En otro turno, rechazar permiso; mostrar que no insiste y abre el compositor. Tocar enviar y volver: «SMS preparado, sin confirmación de entrega».
5. Repetir cancelando: «No se pudo enviar», alerta pendiente. Volver a internet: «Alerta recibida por la central».
6. Con datos degradados, mostrar ocho segundos sin respuesta y el intento SMS. Aclarar que los acuses no significan lectura del supervisor.

## Gestión del usuario

- [ ] Revisar política vigente y elegibilidad en Play Console.
- [ ] Describir la función de emergencia en la ficha de la tienda.
- [ ] Grabar flujo, adjuntar capturas y enlace accesible al video.
- [ ] Completar y enviar declaración de permisos.
- [ ] Registrar fecha, respuesta y eventuales pedidos de información o apelación.
- [ ] Si se rechaza, mantener compositor y revisar distribución del permiso antes de publicar.

No se ejecutó `eas build`, `eas submit` ni `eas update`. Ver [guía técnica](../tecnica/panico-por-sms.md).
