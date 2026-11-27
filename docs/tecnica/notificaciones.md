# Notificaciones push

HU-18 almacena tokens FCM en `NotificationDevice`, una fila por dispositivo. `kind` distingue `web` de `app`, y `platform` identifica Android, iOS o web; HU-45 puede registrar la app usando la misma API y cola.

## Registro y propiedad

- `POST /api/v1/dispositivos` acepta `registerDeviceRequestSchema`; el usuario autenticado es siempre el dueño inicial.
- Token es único globalmente. Re-registrar un token lo mueve al usuario actual y actualiza su último uso.
- `GET /api/v1/dispositivos` y `DELETE /api/v1/dispositivos/:id` operan solo sobre dispositivos propios. Un ID ajeno responde 404.
- La tabla está en `COMPANY_ID_MODELS`; el aislamiento de supervisor y cliente restringe además a su propio `userId`.
- La desactivación del usuario borra sus dispositivos dentro de la transacción de baja. El worker vuelve a comprobar que el usuario siga activo antes de entregar.

## Envío

`NOTIFICATIONS_PORT` está implementado por `NotificationsService`. `notifySiteStaff` selecciona administradores activos de la empresa y supervisores activos asignados al predio. `notifyUsers` filtra por empresa, IDs solicitados y estado activo. El emisor agrega un job a la cola BullMQ `notifications`; los jobs tienen cinco intentos y backoff exponencial según la configuración común.

El worker valida el job con Zod, carga los dispositivos activos y envía lotes FCM de hasta 500 tokens con Firebase Admin. El mensaje presenta el tipo del aviso y, si está disponible, el nombre del predio. `webpush.fcmOptions.link` lleva al detalle en el panel; los links se limitan al origen configurado en `WEB_APP_URL`. No se envían nombres de personas ni ubicaciones. Los errores de entrega transitorios provocan reintentos.

Los tokens con `messaging/registration-token-not-registered` o `messaging/invalid-argument` se eliminan de la tabla. Los logs registran cantidades y resultado, nunca tokens ni el contenido del aviso.

## Configuración web

La API usa `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` existentes. En `apps/web`, completar `VITE_FIREBASE_MESSAGING_SENDER_ID` y `VITE_FIREBASE_VAPID_KEY` además de la configuración pública de Firebase. El build genera `firebase-messaging-sw.js` con la configuración pública; no contiene credenciales Admin. Si falta Sender ID o VAPID, el panel informa que las notificaciones no están configuradas.

La PWA principal usa el service worker de `vite-plugin-pwa`; el worker FCM se registra bajo `/firebase-messaging-scope/` para no reemplazar el worker de caché de la aplicación.

## Agregar un tipo

1. Agregar el valor al contrato `NOTIFICATION_KINDS` de `packages/shared/src/notifications.ts`.
2. Agregar su título en `TITLES` de `notifications.processor.ts`.
3. El emisor usa `NOTIFICATIONS_PORT` y entrega un `notificationPayloadSchema` válido con link al detalle.
4. Mantener el payload limitado al tipo, predio, fecha/hora necesarias y link; no incluir nombres ni ubicaciones.

## App del vigilador (HU-45)

La restricción a dispositivos `app` se aplica únicamente a la agenda: `shift_assigned`, `shift_changed`, `shift_reassigned_to_you`, `shift_removed`, `shift_cancelled`, `shift_closed_site_removed`, `shift_reassigned_from_you` y `shift_schedule_summary`. Los avisos de supervisión `shift_unsynced`, `shift_not_started`, `shift_closed_early` y `shift_without_guard` también llegan a dispositivos `web` de los destinatarios activos.

En Android, al iniciar sesión como vigilador la app solicita permiso, obtiene el token FCM nativo con `expo-notifications.getDevicePushTokenAsync()` y lo registra en `POST /api/v1/dispositivos` con `kind: app` y `platform: android`. Al cerrar sesión elimina su registro con `DELETE /api/v1/dispositivos/:id` antes de cerrar Firebase Auth; si está sin conexión, informa que debe conectarse para poder quitar el celular. Al desactivar al usuario, la API borra sus dispositivos y el worker vuelve a comprobar su estado antes de enviar. Si se rechaza el permiso, la app explica cómo activarlo en Ajustes.

`ShiftsService` emite después de guardar un turno nuevo, modificar su horario, quitar al vigilador o cancelarlo. `SitesService` dispara el efecto `notifyGuardToLeave` después del commit que cierra un turno en curso por baja del predio. Este efecto también llama a `SMS_PORT`; `NoopSms` registra turno y destinatario sin el número mientras HU-24 no provea el envío real. `buildShiftNotification` mantiene el contenido limitado al tipo de cambio, día y hora. No se incorpora el nombre ni la dirección del predio. El worker entrega los eventos de turno solo a dispositivos `app`, con Android `channelId: turnos` y prioridad FCM alta para reasignaciones próximas, además de `apns-priority` preparado para iOS. La lista «Mis turnos» consulta de nuevo la API al abrirse y sigue siendo la fuente de verdad.

`buildShiftNotification` incluye los casos de reasignación y resumen de programación para HU-44 y HU-32. **TODO(HU-44):** conectar el emisor de reasignación. **TODO(HU-32):** conectar el emisor del resumen semanal.

### Configuración de Android con EAS

1. Descargar `google-services.json` desde Firebase para `com.garita.app` y verificar que corresponde al mismo proyecto usado por la API.
2. Cargarlo en el entorno de build de EAS como archivo secreto y asignar su ruta a `GOOGLE_SERVICES_JSON`; en desarrollo local, colocarlo en `apps/mobile/google-services.json` (ignorado por Git).
3. Generar el cliente nativo con Expo prebuild y probar en un Android físico. Si falta el archivo, prebuild emite un aviso y continúa sin FCM.
4. Verificar permiso concedido y rechazado, llegada con el celular bloqueado, apertura del turno y baja del token al cerrar sesión. Repetir con un turno cancelado y comprobar que se abre «Mis turnos».

### iOS pendiente de decisión

`app.config.ts` incluye `UIBackgroundModes: remote-notification` y el entitlement `aps-environment`. En iOS, `getDevicePushTokenAsync()` devuelve un token APNs, que `firebase-admin` FCM no acepta. Por eso la app no registra ese token. Para habilitar iPhone se debe elegir **una** integración: obtener un token FCM con `@react-native-firebase/messaging` y su configuración nativa, o agregar un emisor APNs separado. La prueba manual en iPhone queda pendiente de esa decisión y de una build firmada. El SMS real también queda pendiente de HU-24.
