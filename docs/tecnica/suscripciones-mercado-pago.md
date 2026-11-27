# Suscripciones con Mercado Pago (HU-29, HU-42)

El administrador contrata un plan con débito automático mensual. Garita usa **Mercado Pago Suscripciones** (`preapproval`): la tarjeta se carga en el checkout de Mercado Pago y nunca pasa por Garita. El módulo vive en `apps/api/src/modules/subscriptions` y la pantalla en `apps/web/src/features/suscripcion`.

## Modelo

| Mercado Pago         | Garita                    | Qué representa                                                             |
| -------------------- | ------------------------- | -------------------------------------------------------------------------- |
| —                    | `Plan`                    | Precio mensual (decimal exacto) y límite de vigiladores; se carga por seed |
| `preapproval`        | `Subscription`            | La suscripción de una empresa. `mpPreapprovalId` es el id de Mercado Pago  |
| `authorized_payment` | `SubscriptionCharge`      | Cada débito, con el `payment` y su `status_detail` (motivo de rechazo)     |
| aviso de webhook     | `MercadoPagoNotification` | Registro durable de avisos recibidos; su id es el del aviso                |

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
- desde el worker de notificaciones válidas;
- desde la comparación diaria, con registro de diferencias.

Todas las respuestas de Mercado Pago se validan con Zod en `MercadoPagoClient` antes de usarse.

## Webhook

`POST /api/v1/webhooks/mercadopago` es público (Mercado Pago no tiene usuario de Garita); Swagger documenta la firma y los códigos de respuesta. La autenticidad depende de `x-signature`, no de autenticación de usuario.

1. Sin `MERCADOPAGO_WEBHOOK_SECRET` responde 503: no procesa avisos sin poder verificarlos.
2. Verifica `x-signature` (`ts=…,v1=…`): HMAC-SHA256 con la clave secreta del manifiesto `id:{data.id};request-id:{x-request-id};ts:{ts};`, con `data.id` en minúsculas si es alfanumérico y omitiendo las partes ausentes. Comparación en tiempo constante. Firma inválida: 401. El `ts` llega en segundos.
3. Persiste `MercadoPagoNotification` por el `id` del aviso (distinto de `data.id`), encola en `mercadopago-notifications` con ese mismo `jobId` y responde 200. Espera solo PostgreSQL/Redis, nunca una llamada a Mercado Pago. Si falla el enqueue, responde error y el proveedor puede reenviar; el barrido de cinco minutos también recupera registros `received`. El worker procesa después:
   - `subscription_preapproval` → `syncPreapproval(data.id)`;
   - `subscription_authorized_payment` → consulta el cobro para obtener su `preapproval_id` → `syncPreapproval`;
   - `payment` → consulta `/v1/payments/{id}` y llama al punto de extensión `onOneTimePayment`;
   - otros tipos se registran como procesados sin efectos.
4. El cuerpo del aviso nunca es fuente del estado: aporta los identificadores. Un aviso `processed` repetido no se encola ni se sincroniza; un mismo id con tipo/recurso distinto recibe 409.
5. El registro pasa de `received` a `processed` o `failed`, con error y fecha de procesamiento. Se reintenta hasta seis veces con backoff exponencial desde cinco segundos, respetando `Retry-After` de un 429/5xx. Los jobs terminados se eliminan; el registro durable conserva la deduplicación.
6. Las sincronizaciones de cada preapproval se serializan con un advisory lock de PostgreSQL y consultan el recurso actual después del lock: un aviso viejo no revierte un cobro aprobado. Los cobros hacen upsert por `mpAuthorizedPaymentId`; el marcador `effectsAppliedStatus` evita entregar de nuevo un efecto ya confirmado.

La firma de #106 se conserva sin cambios: no se agrega una ventana de rechazo por `ts`, para admitir reenvíos legítimos demorados. Firma inválida: 401 y log de error, sin registro ni enqueue.

## Cancelación (HU-42)

Mercado Pago no permite reactivar una `preapproval` cancelada, así que la cancelación se programa:

| Acción                                          | Garita                                                        | Mercado Pago             |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| `POST /api/v1/suscripcion/cancelar`             | `paused`, `cancelAt` = próximo cobro, motivo y quién la pidió | `paused` (sin débitos)   |
| `POST /api/v1/suscripcion/revertir-cancelacion` | Antes de `cancelAt`: vuelve a `authorized`; después, 409      | `authorized`             |
| Llega `cancelAt`                                | `cancelled`; la empresa puede volver a suscribirse            | `cancelled` (definitivo) |

Pausar y reanudar no cobra de más ni mueve `next_payment_date` (verificado en el entorno de prueba). Una suscripción `pending` no tiene ciclo pagado y se descarta al cancelar.

El fin de ciclo se aplica al leer y en la comparación diaria, aunque nadie ingrese. La suspensión de cuenta sigue siendo HU-43; el historial completo de cambios es ID-355.

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
- La API y sus workers deben correr como procesos permanentes (Render), con Redis disponible; la cola sobrevive a reinicios del proceso.
- **Pase a producción:** activar las credenciales de producción, reemplazar el token por el de la cuenta real que cobra, configurar el webhook de producción con la URL de Render y su clave. No requiere cambios de código. No está verificado si en producción Mercado Pago también cancela la suscripción ante el primer rechazo: conviene una prueba real con un monto chico.

## Comparación diaria y operación

La cola `mercadopago-reconciliation` agenda `mercadopago-daily` a las **03:00 America/Argentina/Buenos_Aires**. Descubre las suscripciones abiertas en lotes de 50 y genera un job independiente para cada una, con seis intentos y backoff exponencial. Limita el despacho a un job por segundo: un 429 o fallo de red no impide procesar las otras empresas. El cliente recorre las páginas de facturas de Mercado Pago de a 20. No se presupone una cuota universal del proveedor.

Cada job aplica la cancelación vencida y luego ejecuta el mismo `syncPreapproval` que el webhook. Cada diferencia de estado, fecha o cobro genera `logger.error` con `event: subscription.reconciliation_diff`, correlación, suscripción, estado anterior y corregido. Los cambios de estado y los cobros aprobados/rechazados emiten logs estructurados `subscription.metric`, sin datos de tarjeta ni credenciales.

Ante una diferencia, revisar el id de correlación en `subscription.notification`, la fila `MercadoPagoNotification` (`status`, `error`), los jobs fallidos y el panel de notificaciones del proveedor; contrastar el recurso actual, no el cuerpo del aviso. Verificar PostgreSQL, Redis y credenciales del servidor. Un aviso agotado queda `failed`: se puede reenviar desde Mercado Pago con el mismo id; la comparación diaria recupera igualmente el estado de las suscripciones abiertas. Una caída prolongada o una cola atrasada puede superar el objetivo de un minuto: medirlo en el entorno de prueba con la checklist siguiente.

## Puntos de extensión

`subscription-effects.port.ts` define `SubscriptionEffectsPort` y `NoopSubscriptionEffects`:

- `onChargeRejected(charge)` → HU-30, gracia.
- `onChargeApproved(charge)` → HU-30/HU-43, regularización.
- `onOneTimePayment(payment)` → HU-42, prorrateo y pagos únicos.

Hoy no ejecutan lógica de esas historias. Las implementaciones futuras deben ser idempotentes por id/estado (y reintento si corresponde): una caída después del efecto externo y antes del commit puede volver a entregar el efecto. La autorización inicial llama a `ACCOUNT_STATE_PORT.transition({ to: 'active' })`; si la cuenta está en prueba y `startsAt` es futuro, conserva la prueba y W1 resuelve su vencimiento. No activa una cuenta en gracia por una simple lectura de una preapproval ya autorizada.

## Elección de vigiladores y consulta

`POST /suscripcion` acepta además `guardSelection: { guardsToKeep, shiftDecisions }`. Cada decisión tiene `guardId`, y `shiftAction: derive` con `deriveToUserId`, o `shiftAction: unassign` con `confirmUnassignedCount`. Si se supera el plan sin elección válida devuelve 409 con `code: guard_selection_required`, `maxGuards` y la lista propia de vigiladores con sus turnos futuros. Se cuentan estados `active` e `invitation_pending` mediante `countsTowardGuardLimit`. No se aceptan ids ajenos, duplicados ni derivación a alguien que se dará de baja.

El panel muestra casillas, contador N de M y la decisión de turnos de cada no elegido. La elección queda guardada como JSON validado con Zod junto al actor y los pendientes; no se aplica antes de la autorización. `GuardSelectionService` es reutilizable por HU-42. Usa `UsersService` para listar, contar y desactivar; conserva las reglas de derivación, historial y revocación de sesiones. La decisión de dejar sin vigilador abarca los turnos futuros al aplicarse y se vuelve a contar entonces, porque el checkout puede demorar. Las derivaciones que no se pueden realizar conservan el resultado de `UsersService.deactivate`.

**Decisión del coordinador:** no modificar los cuatro caminos de cierre del turno. El job fijo `mercadopago-pending-guards` corre cada cinco minutos y también se ejecuta en el barrido diario; el vigilador en turno sigue activo y se desactiva en el siguiente barrido tras el cierre. Demora nominal máxima: cinco minutos, dependiente de disponibilidad de los workers. El comentario `shortcut` indica reemplazarlo por un gancho de cierre si se requiere menor demora. Las aplicaciones concurrentes se serializan por suscripción y el progreso queda persistido.

`GET /suscripcion?chargePage=1` conserva plan, estado, próximo cobro y motivo; devuelve hasta 24 cobros, `chargePage` y `hasMoreCharges`. La pantalla permite avanzar y retroceder. Todo se aísla por empresa y requiere administrador; no se cambia la cancelación ni su reversión.

## Fuentes oficiales verificadas

Consultadas el 15/11/2026, sin llamar a las APIs de pago ni usar credenciales:

- [Webhooks de Suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks): id del aviso, firma, tópicos `subscription_preapproval`, `subscription_authorized_payment`, `payment`, confirmación y consulta posterior del recurso.
- [Obtener suscripción](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-preapproval/get): contrato de preapproval. Se conserva el conjunto de estados existente de #106; un valor desconocido no reemplaza el estado guardado.
- [Obtener factura](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-authorized-payment/get) y [buscar facturas](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/authorized-payment-search/get): el estado de la factura (`scheduled`) es distinto del de `payment`; se usa `payment.status` y `status_detail`. La documentación representa montos como cadenas: se aceptan cadenas decimales y números JSON del proveedor, sin cálculos en punto flotante para persistirlos.
- [Errores y límites de uso](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/integration-errors/api): 429 y recomendación `Retry-After`/backoff. Esta guía es de Orders; no se encontró una cuota numérica publicada específica de Suscripciones, por eso no se afirma una tasa garantizada.

## Checklist manual con GUIA-MERCADO-PAGO.md

La ejecuta el usuario con vendedor/comprador de prueba y un webhook público; no fue ejecutada por el agente:

- [ ] Alta con APRO: plan correcto, Activa, próximo cobro e historial; nunca se piden datos de tarjeta en Garita.
- [ ] Alta durante prueba con «Seguir con la prueba»: primer débito al fin de la prueba y cuenta todavía en prueba.
- [ ] OTHE/FUND/SECU: No se activó y motivo visible; se puede volver a suscribir.
- [ ] Reenviar el mismo aviso desde Mercado Pago: una fila de notificación y ningún cobro duplicado.
- [ ] Registrar hora de recepción y actualización: menos de un minuto con workers disponibles.
- [ ] Cortar recepción del webhook, confirmar un cobro y ejecutar/esperar comparación diaria: aparece en historial y log de diferencia.
- [ ] Simular indisponibilidad y restablecer Redis/proveedor: reintentos y estados failed/processed visibles.
- [ ] 14 vigiladores y plan de 10: elegir retenidos usando teclado; derivar o dejar sin vigilador los turnos de los demás; confirmar que no hay bajas antes de autorizar.
- [ ] Un vigilador excluido tiene turno en curso: sigue activo hasta el cierre y el siguiente barrido (hasta cinco minutos).
- [ ] Historial mayor de 24: Anterior/Siguiente, fecha, monto, resultado y motivo.
- [ ] Supervisor sin acceso; cancelación/reversión y fin del ciclo siguen funcionando.
- [ ] Panel claro/oscuro, viewport angosto y lector de pantalla: casillas, contador y decisiones comprensibles.
