# Suscripciones con Mercado Pago (HU-29, HU-42)

El administrador contrata un plan con débito automático mensual. Garita usa **Mercado Pago Suscripciones** (`preapproval`): la tarjeta se carga en el checkout de Mercado Pago y nunca pasa por Garita. El módulo vive en `apps/api/src/modules/subscriptions` y la pantalla en `apps/web/src/features/suscripcion`.

## Modelo

| Mercado Pago         | Garita                    | Qué representa                                                                |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| —                    | `Plan`                    | Precio mensual (decimal exacto) y límite de vigiladores; se carga por seed    |
| `preapproval`        | `Subscription`            | La suscripción de una empresa. `mpPreapprovalId` es el id de Mercado Pago     |
| `authorized_payment` | `SubscriptionCharge`      | Cada débito, con el `payment` y su `status_detail` (motivo de rechazo)        |
| aviso de webhook     | `MercadoPagoNotification` | Registro de avisos recibidos; su id es el del aviso (todavía sin uso, ID-336) |

- Estados de `Subscription`: los mismos que Mercado Pago (`pending`, `authorized`, `paused`, `cancelled`), definidos en `@garita/shared`.
- Una sola suscripción abierta (`pending`, `authorized` o `paused`) por empresa: índice único parcial `Subscription_one_open_per_company`, que vive solo en la migración porque Prisma no lo puede declarar.
- `Company.trialEndsAt` nulo significa que la empresa no tiene prueba gratis (HU-41) y paga desde el primer día.
- `external_reference` de la `preapproval` es el id de la fila de `Subscription`.

## Flujo de alta

1. El panel pide `GET /api/v1/suscripcion` (solo `admin`; el supervisor recibe 403). La API cierra una cancelación vencida y sincroniza con Mercado Pago antes de responder.
2. El administrador elige un plan (`GET /api/v1/planes`) e indica el **email de su cuenta de Mercado Pago**, que puede ser distinto del de Garita: Mercado Pago exige que coincida con quien paga.
3. Al tocar **Suscribirme**, el panel abre una pestaña en blanco en el mismo clic (si se abre después de esperar a la API, la bloquea el navegador) y envía `POST /api/v1/suscripcion` con `{ planId, payerEmail, keepTrial }`.
4. La API guarda la fila `pending` y llama a `POST https://api.mercadopago.com/preapproval` con el Access Token, el monto del plan, frecuencia mensual en ARS, `back_url = {WEB_APP_URL}/suscripcion` y, solo si la empresa está en prueba y eligió seguirla, `start_date` = fin de la prueba. Si Mercado Pago falla, la fila se cancela y se responde 502.
5. Mercado Pago devuelve el `init_point`. El panel lo carga en la pestaña nueva y corta su vínculo con Garita (`opener = null`, evita reverse tabnabbing). Si el navegador bloqueó la pestaña, redirige en la misma.
6. En el checkout, Mercado Pago intenta el primer cobro:
   - **Aprobado:** la `preapproval` pasa a `authorized` y agenda `next_payment_date`.
   - **Rechazado:** Mercado Pago **cancela la `preapproval`** al instante (observado en el entorno de prueba) y guarda el motivo en el `status_detail` del pago. El botón "Reintentar" de su página ya no sirve: el reintento se hace desde Garita con una suscripción nueva.
7. Al volver a la pestaña de Garita, la consulta de la suscripción se vuelve a pedir (`staleTime: 0`) y la API sincroniza. El panel muestra "Activa" con el próximo cobro, o "No se activó" con el motivo traducido.

Si había una suscripción `pending` abandonada, el alta nueva la cancela en los dos lados. Si una pestaña vieja completa luego ese checkout, la sincronización la cancela en Mercado Pago para no cobrar dos veces. Con una `authorized` vigente, el alta responde 409 (el cambio de plan es HU-42).

## Sincronización

`SubscriptionsService.syncPreapproval(mpPreapprovalId)` copia el estado real desde `GET /preapproval/{id}` y `GET /authorized_payments/search?preapproval_id={id}`: estado, próximo cobro, cada cobro (upsert por `mpAuthorizedPaymentId`) y el último motivo de rechazo. Es idempotente y se ejecuta:

- al leer `GET /suscripcion` (respaldo cuando no llegan avisos, por ejemplo en local sin túnel);
- al recibir un aviso válido del webhook.

Todas las respuestas de Mercado Pago se validan con Zod en `MercadoPagoClient` antes de usarse.

## Webhook

`POST /api/v1/webhooks/mercadopago` es público (Mercado Pago no tiene usuario de Garita) y no figura en Swagger.

1. Sin `MERCADOPAGO_WEBHOOK_SECRET` responde 503: no procesa avisos sin poder verificarlos.
2. Verifica `x-signature` (`ts=…,v1=…`): HMAC-SHA256 con la clave secreta del manifiesto `id:{data.id};request-id:{x-request-id};ts:{ts};`, con `data.id` en minúsculas si es alfanumérico y omitiendo las partes ausentes. Comparación en tiempo constante. Firma inválida: 401. El `ts` llega en segundos.
3. Responde 200 enseguida y procesa después:
   - `subscription_preapproval` → `syncPreapproval(data.id)`;
   - `subscription_authorized_payment` → consulta el cobro para obtener su `preapproval_id` → `syncPreapproval`;
   - otros tipos se ignoran.
4. El cuerpo del aviso nunca se usa como fuente de verdad: solo aporta el id. Un aviso repetido produce la misma sincronización.

**Pendiente (ID-336):** procesar en un job de BullMQ con reintentos, registrar cada aviso en `MercadoPagoNotification` para descartar repetidos y definir la tolerancia del `ts`. Hoy el procesamiento corre en el mismo proceso después de responder.

## Cancelación (HU-42)

Mercado Pago no permite reactivar una `preapproval` cancelada, así que la cancelación se programa:

| Acción                                          | Garita                                                        | Mercado Pago             |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| `POST /api/v1/suscripcion/cancelar`             | `paused`, `cancelAt` = próximo cobro, motivo y quién la pidió | `paused` (sin débitos)   |
| `POST /api/v1/suscripcion/revertir-cancelacion` | Antes de `cancelAt`: vuelve a `authorized`; después, 409      | `authorized`             |
| Llega `cancelAt`                                | `cancelled`; la empresa puede volver a suscribirse            | `cancelled` (definitivo) |

Pausar y reanudar no cobra de más ni mueve `next_payment_date` (verificado en el entorno de prueba). Una suscripción `pending` no tiene ciclo pagado y se descarta al cancelar.

**Pendiente:** el fin de ciclo se aplica al leer la suscripción; la comparación diaria (ID-337) lo hará también para las empresas que no entran. La suspensión de la cuenta al terminar el ciclo es HU-43 y el historial completo de cambios es ID-355.

## Entorno de prueba (sandbox)

No hay un servidor aparte: las llamadas van a los mismos hosts que en producción. Lo que hace que todo sea ficticio son las **credenciales de un usuario de prueba vendedor**:

- El Access Token pertenece a un usuario con la etiqueta `test_user`; cobra a un **comprador de prueba** del mismo país. Los usuarios de prueba solo operan entre sí.
- En suscripciones no existe `sandbox_init_point`: el `init_point` ya es de prueba.
- Con las tarjetas de prueba, el resultado lo define el **nombre del titular** y no el CVV:

| Titular | Resultado                    | `status_detail`                        |
| ------- | ---------------------------- | -------------------------------------- |
| `APRO`  | Aprobado                     | `accredited`                           |
| `OTHE`  | Rechazo general              | `cc_rejected_other_reason`             |
| `FUND`  | Fondos insuficientes         | `cc_rejected_insufficient_amount`      |
| `SECU`  | Código de seguridad inválido | `cc_rejected_bad_filled_security_code` |

Los tres rechazos y el alta aprobada se probaron de punta a punta desde el panel. Con `SECU`, reingresar el código correcto vuelve a rechazar: el titular manda.

## Configuración

| Variable (`apps/api`)        | Uso                                                    |
| ---------------------------- | ------------------------------------------------------ |
| `MERCADOPAGO_ACCESS_TOKEN`   | Llamadas a la API de Mercado Pago. Solo en el servidor |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta de la sección Webhooks de la aplicación  |
| `WEB_APP_URL`                | Base del `back_url`                                    |

- Mercado Pago rechaza `localhost` en el `back_url`. En local: `WEB_APP_URL=http://127.0.0.1:5173`, sumarlo a `CORS_ORIGINS` y abrir el panel en esa dirección (`vite --host 127.0.0.1`).
- El webhook necesita una URL pública. En local, un túnel (`cloudflared tunnel --url http://localhost:3000`) cuya URL `https://….trycloudflare.com/api/v1/webhooks/mercadopago` se carga en **Webhooks** del panel de Mercado Pago, con los eventos de planes y suscripciones y de pagos. Cambia en cada ejecución. Sin túnel el alta funciona igual, porque la lectura sincroniza.
- La API debe correr como proceso permanente (Render): en funciones serverless el procesamiento posterior a la respuesta se cortaría.
- **Pase a producción:** activar las credenciales de producción, reemplazar el token por el de la cuenta real que cobra, configurar el webhook de producción con la URL de Render y su clave. No requiere cambios de código. No está verificado si en producción Mercado Pago también cancela la suscripción ante el primer rechazo: conviene una prueba real con un monto chico.
