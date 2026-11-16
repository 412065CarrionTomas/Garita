# Pánico por SMS (HU-23 y HU-37)

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

Con respaldo se suma el predio sin tildes (hasta 30 caracteres) y, con ubicación, `maps.google.com/?q=<coordenadas>`. El constructor limita el mensaje a 160 caracteres GSM seguros. El código es sensible y no sustituye la credencial HTTPS. HU-37 valida el código y el remitente; la pasarela se autentica con HMAC y tiene una cuota distribuida por IP.

## Idempotencia y extensión HU-37

`smsAttempted` se persiste antes de invocar el canal. Las activaciones del turno sin resolución intermedia heredan intento y estado: no generan otro SMS. Los reintentos de internet y el reinicio tampoco reenvían un SMS intentado. Si el proceso muere después de guardar el marcador, no se supone confirmación ni se reintenta automáticamente el SMS; la alerta sigue por internet. Los acuses nativos requieren que el proceso siga vivo.

La API conserva su deduplicación por UUID. `panicSmsTwinFinder.find` consulta turno, empresa e identificador corto dentro de la transacción serializada por turno. Al llegar internet completa la alerta SMS con el UUID del celular, hora y mejor ubicación; conserva el canal `sms` y la primera recepción. La FK de SMS recibidos sigue el cambio de UUID. Se programan jobs con el UUID completo y el vencimiento original; los del UUID anterior quedan sin efecto al no encontrar la alerta.

En el orden inverso el SMS se vincula a la alerta de internet. El único `(shiftId, shortId)` y el bloqueo por turno protegen la concurrencia. Los reintentos del proveedor tienen único `(provider, messageId)` y procesan siempre el cuerpo original persistido. Si la cola falla después del commit, el reintento repara su programación. Las alertas anteriores a la migración conservan `shortId = NULL` para no arriesgar colisiones al migrar; se reconocen por el prefijo de su UUID o sus activaciones.

## Recepción en la plataforma (HU-37)

`POST /api/v1/webhooks/sms` es público y exige JSON, `x-sms-timestamp` (segundos Unix actuales) y `x-sms-signature: sha256=<hex>`. La firma es HMAC-SHA256 de los bytes de `<timestamp>.<cuerpo crudo>` con `SMS_WEBHOOK_SECRET`. No volver a serializar el JSON entre firma y envío. La comparación es constante; se rechazan fechas con más de 5 minutos de diferencia en ambas direcciones. Nest habilita `rawBody: true` conservando el parser habitual ([documentación oficial](https://docs.nestjs.com/faq/raw-body)).

Contrato de la pasarela propia:

```json
{
  "id": "gateway-message-001",
  "from": "+543511234567",
  "text": "GARITA PANICO ABCD1234 T:123456 03:10 SIN-UBICACION",
  "receivedAt": "2035-01-01T06:10:00Z"
}
```

`id` es estable en reintentos, hasta 100 letras, números, guiones o guiones bajos; `from` admite hasta 40 caracteres y `text` hasta 1600. `receivedAt` es la recepción de la pasarela, con fecha completa y zona; Garita guarda su propia recepción. El SMS solo trae HH:mm: se infiere el día más cercano a esa recepción en la zona de la empresa (resolución de un minuto); internet completa después el instante del dispositivo. Un SMS retenido más de un día no permite reconstruir el día original de activación con este formato.

La ruta aplica 60 pedidos por IP y minuto con `INCR` y `EXPIRE` atómicos en Redis, antes de verificar firmas. Devuelve 429 al superar la cuota, 503 si Redis falla, 401 sin secreto o con firma inválida/vieja, 400 si el cuerpo firmado no cumple Zod y 200 después de procesar también repetidos y desconocidos. Los logs no incluyen texto, código, teléfono, firma ni token. `sms.authentication`, `sms.invalid_signature` y `sms.rate_limit_unavailable` permiten detectar rechazos; `sms.processed.latencyMs` mide el tramo dentro de la API, no el tránsito de la operadora.

| Resultado    | Regla                                                        | Acción                                                                      |
| ------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `valid`      | Código de exactamente un turno en curso                      | Alerta SMS y jobs HU-24; si cambia el número, marca "El número no coincide" |
| `unverified` | Sin código válido, teléfono de exactamente un turno en curso | Alerta "No verificada", atendida y notificada igual                         |
| `unknown`    | Sin coincidencia o coincidencia ambigua                      | Registro sin alerta y log de error                                          |

El número puede falsificarse: **no autentica** al remitente. El código tiene prioridad, incluso desde otra SIM. `normalizeArPhone` reconoce +54 y +54 9. Un código o teléfono ambiguo nunca elige arbitrariamente un turno.

`GET /api/v1/sms-recibidos?estado=valid|unverified|unknown&pagina=1` es solo para administradores, 25 registros por página. Usa el cliente tenant: muestra únicamente mensajes cuya empresa se identificó sin ambigüedad por turno o número. Los desconocidos sin empresa quedan en base y logs operativos; ningún administrador puede ver números ajenos. Panel: **Gestión → SMS recibidos**. Listado y detalle de pánico muestran "Por SMS", "No verificada" y "El número no coincide", además de envío y recepción. Swagger: `/api/docs`.

## Activación del proveedor y la pasarela

Sin variables nuevas, `SMS_PROVIDER=log`: `NoopSms` conserva log y `sent: false`, sin entrega externa. Sin `SMS_WEBHOOK_SECRET`, el webhook responde 401. La decisión del 15/11 es mantenerlo así: no se cargan credenciales ni se contrata proveedor en esta entrega.

1. Disponer de una línea argentina y pasarela Android de HU-36, con energía estable, red de respaldo y exclusión del ahorro de batería. Configurar HTTPS y reintentos persistentes con el mismo `id`.
2. Generar un secreto de al menos 32 caracteres y cargarlo en la API y la pasarela como `SMS_WEBHOOK_SECRET` por el gestor de secretos; nunca en Git ni logs.
3. Para envío backend, cargar `SMS_PROVIDER=http`, `SMS_GATEWAY_URL` y `SMS_GATEWAY_TOKEN`. La API rechaza una configuración incompleta. La salida acepta `POST` JSON `{ "to": "+549...", "message": "..." }` con `Authorization: Bearer <token>`; 2xx significa aceptado. Timeout: 5 segundos, sin redirecciones ni reintentos internos. Los jobs reintentan rechazos/timeouts, registran `failed` y conservan destinatarios aceptados. Un timeout puede haber despachado el mensaje antes de perder la respuesta. `sendShiftClosed` usa el mismo transporte.
4. El costo registrado es estimado: USD 0,08 por envío aceptado, tomado de HU-36; no es una tarifa contratada. Ajustarlo al contratar y verificar segmentación/facturación.
5. Probar con un turno de prueba y su código real. Ejemplo Bash: `SMS_WEBHOOK_SECRET` y `API_URL` ya existen en el entorno; se firma exactamente lo enviado. Reemplazar hora/código por los del caso real:

```bash
body='{"id":"gateway-message-001","from":"+543511234567","text":"GARITA PANICO ABCD1234 T:123456 03:10 SIN-UBICACION","receivedAt":"2035-01-01T06:10:00Z"}'
ts=$(date +%s)
sig=$(SMS_BODY="$body" SMS_TS="$ts" node -e 'process.stdout.write(require("node:crypto").createHmac("sha256", process.env.SMS_WEBHOOK_SECRET).update(process.env.SMS_TS + "." + process.env.SMS_BODY).digest("hex"))')
curl --fail-with-body "$API_URL/api/v1/webhooks/sms" \
  -H 'Content-Type: application/json' \
  -H "x-sms-timestamp: $ts" -H "x-sms-signature: sha256=$sig" \
  --data-raw "$body"
```

6. Cargar `PANIC_SMS_PLATFORM_NUMBER` (E.164) y pasar `PANIC_SMS_DESTINATION_TYPE=PLATFORM_GATEWAY` después de verificar recepción y notificaciones. El valor predeterminado sigue siendo `GUARD_PHONE`. Iniciar un turno nuevo para recibir el destino actualizado.
7. Confirmar un único registro, canal SMS, destinatarios, entrega aceptada y escalamiento al administrador tras 120 s sin confirmación. Recuperar datos y verificar deduplicación; medir menos de 30 s con la línea real desde recepción de pasarela hasta notificación. Los mocks no prueban ese plazo físico.

### Caída y brecha de escalamiento

Si cae la pasarela, revisar energía, SIM, datos/Wi-Fi y proceso puente; conservar su cola y reenviar con el mismo `id`, firmando con timestamp actual. Ante 401 revisar secreto, reloj y bytes; ante 429 espaciar reintentos; ante 503 recuperar Redis/API. No regenerar identificadores para forzar reintentos. La cola móvil reenvía por internet cuando vuelven los datos.

Con `GUARD_PHONE` el SMS llega al teléfono humano y **no entra automáticamente a la plataforma**: el escalamiento HU-24 arranca recién cuando llega por internet. Hay que atender ese teléfono como contingencia; este cambio no elimina esa brecha mientras siga configurado el respaldo.

### Checklist manual pendiente

- [ ] Activar secretos y transporte en un entorno de prueba sin publicar credenciales.
- [ ] Recibir un SMS real desde una SIM argentina, medir recepción → notificación (<30 s) y registrar operador/latencia.
- [ ] Probar texto manual, desconocido, segunda SIM con código válido y formatos +54/+54 9.
- [ ] Probar ambos órdenes SMS/internet, reintentos y recuperación tras caída de Redis/pasarela.
- [ ] Dejar una alerta sin confirmar y verificar SMS al administrador y escalamiento a los 120 s.
- [ ] Revisar panel claro/oscuro, móvil/escritorio, teclado y lector de pantalla; comprobar las tres marcas y ambas horas.
- [ ] Verificar que otro administrador no lee los registros y que un SMS sin empresa no se muestra a nadie.

El SMS opcional de "Alerta recibida" al vigilador **no se implementa**. No se toca la app móvil, ID-273 ni ID-281.

## Permiso y publicación

Al iniciar el turno, un diálogo explica el uso exclusivo para emergencias sin datos o sin confirmación de la central. Después del consentimiento pide SEND_SMS mediante PermissionsAndroid. Rechazar o cerrar permite usar el compositor sin insistir en ese turno; el marcador sobrevive a reinicios. El config plugin añade `android.permission.SEND_SMS`; iOS declara capacidad falsa y rechaza envío en segundo plano.

La declaración y el video están preparados en [declaracion-send-sms.md](../publicacion/declaracion-send-sms.md). El usuario realiza el trámite y las pruebas físicas. No se ejecutan comandos EAS.

## Fuentes y validación física

Se siguió [HU-36](../spikes/hu-36-canales-panico.md) y su PoC. Referencias oficiales consultadas el 30/10/2026: [Expo SMS](https://docs.expo.dev/versions/latest/sdk/sms/), [Expo Modules API](https://docs.expo.dev/modules/module-api/) y [Android SmsManager](https://developer.android.com/reference/android/telephony/SmsManager). En SDK 57 el módulo ya es EventEmitter: se usa `addListener` directamente, sin construir el emitter deprecado.

Los tests usan mocks nativos y no mandan SMS reales. Prebuild Android comprueba configuración generada, sin compilar Kotlin/Swift. Queda validar en Android e iPhone los seis BDD, tiempos físicos, operadoras, segundo plano, claro/oscuro y lectores de pantalla. iOS requiere macOS.
