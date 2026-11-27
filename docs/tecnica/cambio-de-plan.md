# Cambio de plan y cancelación — HU-42

El administrador usa **Suscripción y cobros → Cambio de plan e historial**. La simulación consulta solo PostgreSQL: no llama a Mercado Pago. Se muestran diferencia y fecha antes de confirmar; se puede operar con teclado. Mercado Pago recibe los datos de pago: Garita nunca pide una tarjeta.

## Manual del administrador

- **Subir:** elegí el plan y revisá diferencia/fecha; confirmar abre Checkout Pro con el helper existente. El plan y el cupo aumentan cuando el pago se aprueba. Un rechazo conserva el plan anterior y muestra el motivo. Mientras haya un pago pendiente no se admite otro cambio. El enlace vence a las 24 horas o al fin del ciclo, lo que ocurra primero; el barrido libera el cambio hasta cinco minutos después del vencimiento.
- **Durante la prueba:** si ya autorizaste una suscripción con inicio diferido, cambiar el plan no genera un pago de diferencia. Se actualizan el plan y su débito. Si todavía no existe, elegí el plan al suscribirte; la API devuelve 409 explicándolo.
- **Bajar:** la simulación pide elegir vigiladores cuando hace falta. Se reutiliza la elección y las decisiones de turnos de HU-29. Al confirmar queda programado para el próximo ciclo, sin reintegro. Las altas/reactivaciones ya respetan el cupo menor; las desactivaciones esperan al próximo ciclo. Un vigilador con turno en curso se conserva hasta el barrido siguiente a su cierre (hasta cinco minutos con workers disponibles).
- **Reemplazar/anular:** elegí otro plan menor para reemplazar la baja. Elegí el plan vigente para anularla; se restaura el débito vigente. Para pasar de una baja pendiente a una subida, primero anulá la baja. No puede coexistir con un pago de subida pendiente.
- **Cancelar:** el botón existente abre confirmación y motivo opcional. Se pausa el débito, se anula cualquier baja pendiente restaurando el importe y se conserva el servicio hasta el fin del ciclo pagado. Podés revertir antes. Al vencer se cancela definitivamente y la cuenta pasa a suspendida con motivo `cancelled`; el bloqueo de funciones corresponde a HU-43.
- **Historial:** muestra cambios y administrador, plan, motivo y fecha de vigencia; los pagos de diferencia muestran estado, rechazo y si falta actualizar el débito.

## Cálculo exacto y días

`packages/shared/src/proration.ts` opera exclusivamente con centavos BigInt, entradas y salida como cadenas. Fórmula: `(precio nuevo − precio actual) × días restantes / días del ciclo`, con medio hacia arriba a dos decimales. Ejemplo: `50000.00 → 90000.00`, 20/30 → `26666.67`. Mismo precio y prueba dan `0.00`; la API rechaza elegir el mismo plan salvo que eso anule una baja pendiente. Una diferencia redondeada a cero no crea un pago imposible de importe cero.

Se reutiliza `daysLeft` de la regla compartida de cuenta: fechas de calendario en la zona horaria de la empresa, desde el último cobro aprobado hasta `nextChargeAt`. La fecha final es exclusiva. Se cobra el día del cambio como día restante; si quedan unas horas del último día, cuenta un día. El 11/11 de un ciclo 01/11–01/12 son 20 de 30 días. No se calculan duraciones dividiendo horas UTC, por lo que un cambio de horario estacional no altera los días.

## API y persistencia

Solo administrador, empresa de la sesión; Zod en cuerpos y consultas. Prefijo `/api/v1`:

| Método y ruta                                | Respuesta                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| GET /suscripcion/cambio-plan/simular?plan=ID | tipo, amount, effectiveAt, días y elección requerida; sin llamadas externas       |
| POST /suscripcion/cambio-plan                | initPoint nullable y effectiveAt; 409 por pago pendiente/selección/ciclo inválido |
| GET /suscripcion/historial                   | baja pendiente, últimos 24 pagos, historial con nombres de administradores        |
| POST /suscripcion/cancelar                   | existente; motivo opcional e historial agregado                                   |
| POST /suscripcion/revertir-cancelacion       | existente; registra al administrador actual                                       |

La migración única `cambios_de_plan` agrega `PlanChangePayment`, `SubscriptionChange` y campos de baja pendiente en `Subscription`. Un índice único parcial impide dos pagos `pending` por suscripción; `mpPaymentId` y `mpPreferenceId` son únicos. Los nuevos modelos tienen `companyId` y están registrados en el cliente tenant y sus tests. Las escrituras de cambio de plan se serializan con la misma fila Company que bloquea las altas de vigiladores. Los jobs y pagos verificados consultan mediante systemPrisma, con log, sin usar datos de empresa enviados por clientes.

## Mercado Pago y recuperación

1. Persistir pago pending, con planes, actor, días, monto y vencimiento. Crear preferencia con `external_reference = plan-change:<id>`, ítem ARS, `back_urls` y vencimiento. Se limita la preferencia al vencimiento exacto persistido mediante PUT; no se ofrecen ticket/ATM. Si crearla falla se rechaza el registro y se permite reintentar.
2. El webhook existente valida firma, persiste/encola el aviso `payment`, consulta `/v1/payments/{id}` y delega a `onOneTimePayment`. La rama `plan-change:` verifica el importe y serializa el efecto. No usa estado ni montos del cuerpo del aviso.
3. Aprobado: en una transacción, marcar pago aprobado, cambiar plan y registrar historial. El cupo queda disponible al commit. **Después** hacer PUT del monto en `preapproval`; si falla, `amountUpdatePending` queda persistido y se reintenta. Avisos repetidos no duplican historial ni aplicación.
4. Rechazado/cancelado: conservar plan/cupo y motivo. Un aviso aprobado tardío que ya compite con otro cambio o con una suscripción cancelada falla para revisión y reintento; no aplica un plan obsoleto silenciosamente. Revisar el pago y resolver con soporte si hubo dinero acreditado fuera del flujo vigente.
5. Al pedir baja, actualizar primero el monto remoto y luego persistir la programación. Si el PUT falla, no queda programada. Anular/reemplazar/cancelar ajusta/restaura el monto. Aplicar el plan y transferir su elección de vigiladores recién al llegar `pendingPlanAt`; `GuardSelectionService.apply` se ejecuta después del commit y mantiene los pendientes de turnos en curso.

La cola propia `subscription-plan-change` agenda barrido cada cinco minutos y comparación diaria a las 03:15 Buenos Aires, con seis intentos y backoff. Descubre en lotes de 50; un fallo por suscripción no oculta las demás. El barrido vence pagos, aplica bajas y reintenta montos pendientes. La pasada diaria compara `auto_recurring.transaction_amount` con el plan vigente o el pendiente, repara con PUT y registra `logger.error` de `subscription.amount_diff` (antes/corregido). Nunca corrige mientras exista un pago pending. Un campo remoto ausente genera aviso y no se interpreta como importe cero. No se modifica syncPreapproval, syncLocked, el webhook ni la comparación de HU-29.

**Decisión del coordinador, 16/11/2026:** se actualiza el importe al programar la baja porque el ciclo en curso está pago. La documentación oficial permite el PUT, pero no explicita una garantía de desde qué factura rige. **Pendiente de verificación sandbox por el usuario**: comprobar el importe del primer débito siguiente, especialmente si se pide cerca del cobro. Esta entrega no afirma haberlo comprobado con pagos reales.

## Fuentes oficiales consultadas

Consultadas el 16/11/2026; no se usaron credenciales ni servicios de pago reales.

- [Crear preferencia Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post): POST /checkout/preferences, items/unit_price, ARS, external_reference, back_urls, init_point, expires y expiration_date_to.
- [Actualizar preferencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/update-preference/put): PUT /checkout/preferences/{id}; se fija el vencimiento persistido, sin cambiar el contrato compartido createPreference de W5.
- [Webhooks](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks): tópicos, firma y consulta del pago; se conserva íntegro el mecanismo HU-29.
- [Gestión de suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management) y [actualizar suscripción](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/update-preapproval/put): PUT /preapproval/{id}, auto_recurring.transaction_amount y currency_id. No se infiere una garantía de corte de facturación ausente en estas fuentes.

Montos en Prisma Decimal y contratos en cadenas; el cliente serializa los campos monetarios validados como literales JSON exactos, sin convertirlos a number ni operar con punto flotante.

## Checklist manual — entorno de prueba de Mercado Pago

La ejecuta el usuario con la guía GUIA-MERCADO-PAGO.md y cuentas/tarjetas de prueba, webhook público y workers activos. No ejecutada por el agente.

- [ ] 50.000 → 90.000 con 20/30 días: se ve 26.666,67 y fecha antes de confirmar; medir respuesta <1 s en el despliegue.
- [ ] APRO: pago único por ese importe, cupo 25 al aprobar y siguiente débito 90.000; reenviar aviso sin cambios duplicados.
- [ ] FUND/OTHE/SECU: conserva plan/cupo y motivo visible; pending impide otro cambio; enlace vencido deja volver a intentar.
- [ ] Baja con 14 vigiladores a 10: elección y decisiones de turnos, no desactivar antes del ciclo y sí en el primer barrido posterior; un turno en curso espera a cerrar.
- [ ] **Pendiente crítico sandbox:** bajar cerca del próximo cobro, confirmar cuál es la primera factura que refleja el nuevo importe. Reemplazar/anular baja y cancelar/revertir: comprobar que el débito queda por el importe correcto.
- [ ] Baja pendiente impide alta/reactivación por encima del cupo menor.
- [ ] Prueba con suscripción diferida: cambia plan/monto sin cobro único; sin suscripción recibe instrucción de elegir al suscribirse.
- [ ] Cancelar 10/11, ciclo pagado hasta 30/11: servicio hasta el fin, luego suspended/cancelled; revertir antes conserva servicio e historial con actor.
- [ ] Simular caída del PUT tras aprobación y recuperar: cupo inmediato, estado pendiente de actualizar, reintento y log de comparación diaria.
- [ ] Supervisor, vigilador y cliente sin acceso; una empresa no ve historial/pagos de otra.
- [ ] Teclado, lector de pantalla, tema claro/oscuro y pantalla angosta: diferencia, vigencia, selección, errores e historial legibles.

## Alternativa si HU-42 no se usara

La plataforma cambia el plan a pedido de la empresa fuera de la aplicación. Al alcanzar el cupo, HU-29 ofrece contactar a la plataforma en lugar de subir de plan. No se implementa una segunda vía administrativa ni se alteran cobros automáticamente fuera de este flujo.
