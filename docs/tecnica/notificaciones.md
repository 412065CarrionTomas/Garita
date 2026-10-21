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
