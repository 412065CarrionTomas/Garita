# Pánico por SMS (HU-23)

## Canales y estados

`triggerPanic` guarda en SQLite antes de despachar la alerta. El transporte de HU-21 llama a `sendPanicSms` inmediatamente sin internet, o a los 8 segundos sin confirmación. El canal no depende del overlay ni del primer plano para Android con SEND_SMS; HU-22 reutiliza esta entrada.

Android con hardware de mensajería y SEND_SMS usa `GaritaNative.sendSms({ destination, message })` y `SmsManager.sendTextMessage`, con un destinatario y un segmento. Los PendingIntent son inmutables y limitados al paquete; los receivers no se exportan. `onSmsStatus` lleva `{ id, status }`, sin teléfono ni ubicación. El resultado de la llamada indica despacho iniciado: solo el acuse `sent` permite mostrar **SMS enviado**, y `delivered`, **SMS entregado**. No todas las operadoras informan entrega. Un fallo produce **No se pudo enviar**.

iPhone y Android sin capacidad de envío en segundo plano usan `expo-sms`, `sendSMSAsync([destination], message)`. `sent` y `unknown` se traducen a `prepared`: **SMS preparado, sin confirmación de entrega**. `cancelled`, dispositivo sin SMS, destino ausente o error se traducen a `failed`: **No se pudo enviar**.

El compositor puede quedar abierto sin bloquear los reintentos por internet. La alerta sigue en su cola con la política de HU-21 incluso si el SMS falla o se cancela. **Alerta recibida por la central** y **Confirmada por el supervisor** tienen prioridad sobre cualquier estado SMS, únicamente tras confirmación del servidor. Los textos son discretos y accesibles, sin sonido.

## Destino, código y almacenamiento

Zod valida `PANIC_SMS_DESTINATION_TYPE`: por defecto `GUARD_PHONE`, con `Company.guardPhone`; `PLATFORM_GATEWAY` usa `PANIC_SMS_PLATFORM_NUMBER`. El flag es temporal hasta confirmar el destino con HU-36/HU-37. Los números son E.164, un único destinatario. La falta de teléfono devuelve `destination: null`; la app no intenta SMS.

Solo `admin` accede a `GET/PUT /api/v1/empresa/telefono-guardia`, cuerpo/respuesta `{ "guardPhone": "+5493511234567" }`; `null` elimina el teléfono. La empresa sale de la sesión y Prisma aplica aislamiento tenant. Se rechazan campos adicionales como `companyId`. No hay pantalla del panel. Las variables están en `apps/api/.env.example`.

Al iniciar, la transacción genera `Shift.panicSmsCode` con `crypto.randomInt(0, 1_000_000)`, completado a seis dígitos, sin derivarlo de identificadores. Los reintentos lo reutilizan. Un turno heredado en curso sin código lo adquiere mediante actualización condicional para evitar carreras.

Los datos offline agregan `shift.panicSms: { destination, shiftCode, backup }`, opcional por compatibilidad con cachés anteriores. `backup: true` identifica el teléfono de guardia. Se guarda dentro de `current_shift`; el borrado existente tras confirmar el cierre y vaciar pendientes elimina destino y código. No se copian al historial de alertas ni a logs.

La migración única `20261030220035_panico_por_sms` añade ambos campos nullable. La lectura de SQLite transforma el estado antiguo `unavailable` en `failed`, sin borrar datos ni reconstruir tablas.

## Formato y autenticación

Se usa `buildPanicSms` de `@garita/shared`: `GARITA PANICO <id corto> T:<código> <HH:mm> <latitud,longitud>`. `panicShortId` toma ocho caracteres hexadecimales del UUID. La hora es la de activación confiable (o la del dispositivo sin referencia), en la zona del predio. Las coordenadas son las últimas utilizables de la alerta, con cinco decimales; sin ellas se incluye `SIN-UBICACION`.

Con respaldo se suma el predio sin tildes (hasta 30 caracteres) y, con ubicación, `maps.google.com/?q=<coordenadas>`. El constructor limita el mensaje a 160 caracteres GSM seguros. El código es sensible y no sustituye la credencial HTTPS. HU-37 deberá validar empresa, turno, código y remitente, autenticar la pasarela y limitar intentos; esta HU no recibe SMS.

## Idempotencia y extensión HU-37

`smsAttempted` se persiste antes de invocar el canal. Las activaciones del turno sin resolución intermedia heredan intento y estado: no generan otro SMS. Los reintentos de internet y el reinicio tampoco reenvían un SMS intentado. Si el proceso muere después de guardar el marcador, no se supone confirmación ni se reintenta automáticamente el SMS; la alerta sigue por internet. Los acuses nativos requieren que el proceso siga vivo.

La API conserva su deduplicación por UUID. En la transacción serializada por turno consulta `PanicSmsTwinFinder.find({ companyId, shiftId, shortId })`. Hoy devuelve `null` con `TODO(HU-37)`: no hay recepción de plataforma. El helper de completado valida empresa, turno, asignación, vigilador y canal; conserva origen SMS y primera recepción, completando UUID, hora y ubicación mejor. El orden internet→SMS corresponde a HU-37. CA4 se cubre para internet y como contrato de extensión para SMS; no se afirma recepción real.

## Permiso y publicación

Al iniciar el turno, un diálogo explica el uso exclusivo para emergencias sin datos o sin confirmación de la central. Después del consentimiento pide SEND_SMS mediante PermissionsAndroid. Rechazar o cerrar permite usar el compositor sin insistir en ese turno; el marcador sobrevive a reinicios. El config plugin añade `android.permission.SEND_SMS`; iOS declara capacidad falsa y rechaza envío en segundo plano.

La declaración y el video están preparados en [declaracion-send-sms.md](../publicacion/declaracion-send-sms.md). El usuario realiza el trámite y las pruebas físicas. No se ejecutan comandos EAS.

## Fuentes y validación física

Se siguió [HU-36](../spikes/hu-36-canales-panico.md) y su PoC. Referencias oficiales consultadas el 30/10/2026: [Expo SMS](https://docs.expo.dev/versions/latest/sdk/sms/), [Expo Modules API](https://docs.expo.dev/modules/module-api/) y [Android SmsManager](https://developer.android.com/reference/android/telephony/SmsManager). En SDK 57 el módulo ya es EventEmitter: se usa `addListener` directamente, sin construir el emitter deprecado.

Los tests usan mocks nativos y no mandan SMS reales. Prebuild Android comprueba configuración generada, sin compilar Kotlin/Swift. Queda validar en Android e iPhone los seis BDD, tiempos físicos, operadoras, segundo plano, claro/oscuro y lectores de pantalla. iOS requiere macOS.
