# Gracia ante un cobro rechazado (HU-30)

## Qué hace el administrador

Un débito mensual rechazado de una suscripción abierta deja la cuenta activa en gracia durante siete días completos, hasta las 23:59 locales del último día. El servicio sigue funcionando. El administrador ve la fecha límite y el monto exacto del ciclo adeudado en el aviso del panel. Recibe correo al rechazo, a tres días y el último día; los demás roles no reciben estos avisos. No se crean `Notice` ni notificaciones de supervisores.

En **Suscripción y cobros**, usar **Cambiar medio de pago** para abrir el portal general de Suscripciones de Mercado Pago, elegir Garita y cambiar la tarjeta allí. Garita nunca recibe ni tokeniza tarjetas. Mercado Pago reintenta por su cuenta durante unos días: después de cambiar el medio de pago se puede esperar ese reintento.

**Reintentar cobro** abre un pago único Checkout Pro por el ciclo completo adeudado. No fuerza un nuevo débito de la suscripción. Un cobro en proceso o un pago único pendiente devuelve un mensaje de espera. Si todavía no se inició un pago, se reutiliza el enlace vigente. El enlace vence a las 24 horas o al fin de gracia, lo que ocurra primero. La aprobación vuelve la cuenta a activa y el aviso desaparece al releer su estado (al recuperar foco y cada minuto). La suscripción y las fechas de próximos ciclos siguen iguales.

Si vence la gracia sin aprobación, la cuenta pasa a `suspended` con `grace_expired`. El bloqueo de acceso, pausa de la suscripción y regularización posterior pertenecen a HU-43: esta entrega no los implementa.

## Integración técnica

`GraceService` implementa las ramas HU-30 de `NoopSubscriptionEffects`. Conserva la clase y el provider compartidos con HU-42. Solo despacha pagos únicos cuyo `external_reference` tiene el prefijo `grace:<subscriptionChargeId>`.

`Company.graceChargeId` identifica el débito que originó la gracia; `amountDue` consulta ese cobro y devuelve su decimal como cadena con dos decimales, o `null` fuera de gracia. El identificador es escalar, sin nueva relación inversa entre módulos. Los estados solo se modifican mediante `ACCOUNT_STATE_PORT`. Se reutilizan `graceEndsAt`, `daysLeft` y `GRACE_REMINDER_DAYS` de shared, junto con el reloj inyectable.

La cola `subscription-grace` barre cada minuto con tres intentos y backoff exponencial. Un advisory lock de Postgres por empresa serializa efectos, acciones y barridos entre procesos; no mantiene bloqueos de filas de Company al llamar al puerto. Relee los datos al adquirirlo. El registro `graceRemindersSent` almacena 0 para el rechazo y 3/1 para recordatorios; se limpia al salir de la gracia. Una falla de correo deja pendiente el marcador, se propaga y se reintenta, con clave Resend estable por cobro, destinatario y recordatorio. Como en el período de prueba, la garantía del correo externo depende de la ventana de idempotencia de Resend; no se afirma entrega exactamente una vez fuera de ella.

`SubscriptionCharge` conserva id, enlace y vencimiento de preferencia, más `gracePaidPaymentId` único. No se sobrescribe el estado espejo del débito de Mercado Pago con el pago único. La aprobación verifica moneda ARS y monto exacto con Decimal; una repetición del mismo id no aplica otra transición. Rechazos repetidos, segundos rechazos y aprobaciones ajenas al ciclo que originó la gracia no reinician ni terminan otra gracia.

Antes de crear/reutilizar el enlace, la API consulta el `authorized_payment` actual y busca pagos por la referencia, paginando. Si la creación devuelve un resultado desconocido (timeout), conserva la intención y rechaza otra creación durante su vigencia. Operación debe verificar la referencia en Mercado Pago y recuperar el enlace antes de volver a habilitar un intento; nunca se crea otro a ciegas. Si se conoce el id pero falló ajustar su vigencia, se vuelve a ajustar antes de devolverlo.

### Corrección autorizada de HU-29: efectos después del commit

La base ejecutaba los efectos de cobros dentro de `syncLocked`. El puerto de cuenta abre otra conexión y bloquea Company, mientras un cobro recién insertado ya tiene una referencia a esa fila en la transacción exterior: podía esperar circularmente y además el efecto no podía leer el cobro sin confirmar.

Con autorización expresa del coordinador, `syncLocked` conserva solo la persistencia. Después del commit, `syncPreapproval` entrega los estados resueltos pendientes en orden cronológico. Marca `effectsAppliedStatus` únicamente después del éxito y con condición de id y estado entregado; un fallo se propaga y deja el efecto pendiente para el job o comparación siguiente. Los efectos son idempotentes y se serializan en GraceService. No se cambió la reconciliación ni la cancelación. El cambio se entrega en commit separado `refactor(api)`.

## API y seguridad

- `GET /api/v1/suscripcion/medio-de-pago`: `{ url }`, solo admin; 404 sin suscripción abierta propia.
- `POST /api/v1/suscripcion/reintentar-cobro`: body vacío estricto; `{ initPoint, expiresAt }`, solo admin; 409 fuera de gracia, ante cobro en proceso o pago pendiente.
- `GET /api/v1/cuenta/estado`: conserva acceso exclusivo admin y completa `amountDue`.

La empresa proviene del usuario autenticado; no se acepta un id de empresa o cobro en el body. Lecturas HTTP usan tenantPrisma; los jobs y efectos usan systemPrisma con alcance explícito y log. Los importes viajan como cadenas; el adaptador emite el token decimal JSON exigido por MP sin conversión de punto flotante. No hay secretos ni variables de entorno nuevas.

## Carrera de doble cobro y reintegro manual pendiente

La consulta previa reduce intentos duplicados, pero no elimina la carrera externa: un reintento automático puede aprobarse después de abrir o pagar Checkout Pro. No se pausa la suscripción ni se hacen reintegros automáticos. En ambos órdenes, la primera aprobación puede terminar la gracia y la segunda no modifica el estado. Se registra `Logger.error` con `event: subscription.double_charge`, empresa, cobro y los dos ids.

**Procedimiento manual:** operación revisa el log, contrasta ambos pagos del mismo ciclo en la cuenta vendedora de Mercado Pago y acuerda con el pagador cuál reintegrar. El reintegro se realiza manualmente desde Mercado Pago, registrando los ids y el comprobante en el soporte del incidente; verificar luego que el ciclo siga regularizado y los ciclos siguientes no cambien. La selección y ejecución del reintegro, y su validación en entorno real, quedan pendientes del usuario. No marcar la alerta resuelta hasta confirmar el reintegro.

## Fuentes oficiales consultadas el 16/11/2026

- [Suscripciones con pago autorizado](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments): cuotas en `recycling`, hasta cuatro posibilidades dentro de diez días por defecto; `waiting for gateway` mientras se procesa. No se encontró una operación documentada para forzar el reintento del authorized_payment; el pago único fue confirmado por el coordinador.
- [Gestión de suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management): cambio de tarjeta mediante PUT preapproval con card_token_id. No se implementa esa integración: el coordinador autorizó el portal general como constante con comentario shortcut porque no se verificó un enlace oficial por suscripción.
- [Crear preferencia Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post): POST checkout/preferences, items, external_reference, back_urls, id e init_point.
- [Vigencia de la preferencia](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/term-of-preference) y [actualizar preferencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/update-preference/put): expires y expiration_date_to.
- [Búsqueda de pagos](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/search-payments/get): consulta por external_reference con paginación.

## Checklist manual (usuario, GUIA-MERCADO-PAGO.md)

- [ ] Usar vendedor y comprador de prueba; generar rechazo de un cobro mensual de una suscripción autorizada, con webhook público configurado para suscripciones y payment.
- [ ] Medir desde la notificación hasta la gracia: menos de un minuto con colas disponibles; confirmar siete días hasta 23:59 locales.
- [ ] Reenviar el mismo aviso y provocar segundo rechazo: misma fecha y un solo correo inicial.
- [ ] Comprobar destinatarios y texto de correo al rechazo, a tres días y el último día: monto y fecha límite.
- [ ] Con supervisor, vigilador y cliente: sin aviso de cobro ni acceso a los nuevos endpoints.
- [ ] En panel claro/oscuro y pantalla angosta, usar teclado y lector de pantalla para aviso y ambas acciones.
- [ ] Cambiar tarjeta desde el portal; esperar aprobación automática y comprobar que desaparece el aviso y amountDue vuelve a null.
- [ ] Abrir pago único: monto del ciclo, retorno a Garita, aprobación y desaparición del aviso; reenvío del webhook sin otra transición.
- [ ] Antes de pagar, repetir la acción: mismo enlace; con pago pendiente o débito en proceso: mensaje claro sin otro enlace.
- [ ] Verificar vencimiento de preferencia a las 24 h o al fin de gracia.
- [ ] Ejercitar ambos órdenes de doble aprobación; revisar subscription.double_charge y completar reintegro manual del duplicado.
- [ ] Sin pagar, comprobar suspended/grace_expired después de 23:59; el bloqueo de acceso queda para HU-43.

No se hicieron llamadas a Mercado Pago ni Resend reales desde las pruebas automatizadas. La checklist manual y la revisión visual quedan a cargo del usuario.
