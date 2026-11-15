# Período de prueba y estado de cuenta (HU-41)

La puesta en marcha ofrece una única prueba de 14 días por empresa. El día de
creación cuenta como día 1 y termina a las 23:59 locales del día 14. Las funciones
`trialEndsAt`, `daysLeft`, `countsTowardGuardLimit` y `effectiveGuardLimit` de
`@garita/shared` son la fuente de las reglas de fechas y cupo.

## Persistencia y empresas existentes

La migración `20261115221125_estado_de_cuenta` agrega a `Company` el estado
`trial | active | grace | suspended`, motivo de suspensión, fin de gracia, hora de
suspensión y los recordatorios ya enviados (`trialRemindersSent`).

La migración **no suspende ninguna empresa existente**: una suscripción autorizada
la deja activa; una prueba futura la deja en prueba; si falta fecha, calcula el fin
desde `createdAt` y la zona horaria. Una prueba histórica ya vencida deja la empresa
activa. Esta excepción preserva el acceso de empresas anteriores al lanzamiento.

El seed inicia la prueba al **crear** sus empresas de demostración; volver a
ejecutarlo no reinicia pruebas ni reactiva cuentas suspendidas.

## Puesta en marcha

Crear la empresa con su zona horaria y `accountStatus: 'trial'`, sin `trialEndsAt`,
y llamar `AccountService.startTrial(companyId)` desde el script administrativo.
La fecha se calcula desde la creación, no desde la ejecución del script. El método
serializa la operación y rechaza una empresa con fecha de prueba previa o estado
distinto de `trial`; no existe endpoint público para reiniciarla. El seed calcula
la misma fecha en el alta con la función compartida.

## Puerto y transiciones

`PortsModule` enlaza `ACCOUNT_STATE_PORT` con `AccountService` mediante
`useExisting`. Los demás dominios consultan y cambian estado por ese puerto:

| Origen    | Destino   | Condición                                                 |
| --------- | --------- | --------------------------------------------------------- |
| trial     | active    | autorización sin diferir o fin con suscripción autorizada |
| trial     | suspended | motivo `trial_expired`                                    |
| active    | grace     | fecha de fin de gracia obligatoria (HU-30)                |
| active    | suspended | motivo `cancelled`                                        |
| grace     | active    | regularización                                            |
| grace     | suspended | motivo `grace_expired`                                    |
| suspended | active    | regularización                                            |

Repetir el estado actual no modifica datos de negocio. Las transiciones inválidas
fallan y se registran con `account.transition.invalid`. Cada transición válida
registra `account.transition` con empresa, origen, destino y motivo. Activar limpia
motivo, fin de gracia y hora de suspensión. Todas se serializan en una transacción
con bloqueo ORM de la fila `Company`.

`get` devuelve estado, motivo, fechas y límite: plan autorizado si existe, o el plan
activo con menor `maxGuards`. `pendingPlanMaxGuards` está centralizado en `read`
y queda en `null` hasta HU-42. El puerto puede trabajar desde jobs y webhooks sin
contexto HTTP: sus accesos de sistema filtran explícitamente la empresa y se loguean.

`assertGuardSlot(companyId, tx?)` cuenta vigiladores activos y con invitación
pendiente; los desactivados y otros roles no cuentan. Alta y reactivación de un
vigilador ejecutan el control y la escritura dentro de la **misma transacción**, con
el bloqueo de empresa antes de leer estado y contar. Dos solicitudes concurrentes
no pueden consumir el último cupo. Sin transacción, el método verifica el cupo
actual; los llamadores que escriban deben pasar su transacción. Suspensión también
rechaza el alta/reactivación. Un límite alcanzado devuelve `409`, código
`guard_limit_reached`, mensaje, estado, límite y cantidad contada.

## HTTP y panel

`GET /api/v1/cuenta/estado` solo admite administradores y deriva siempre la empresa
de la sesión. Valida su respuesta con `accountStateResponseSchema`; incluye estado,
motivo, fechas ISO, días restantes, límite y cantidad contada. `amountDue` queda en
`null` hasta HU-30. Swagger lo publica en `/api/docs`.

El banner del administrador consulta cada minuto y aparece mientras está en prueba.
En los días 7, 3 y 1 muestra un recordatorio textual además del tono de advertencia.
Usa `role="status"`, tokens claro/oscuro y un enlace a `/suscripcion`. Otros roles
no consultan el endpoint. Personal muestra el mensaje de cupo y un enlace para
suscribirse o cambiar de plan tanto al crear como al reactivar.

## Barrido y correo

BullMQ registra `account-trial-sweep` en la cola `account-trial` cada 60 segundos,
con tres intentos y backoff exponencial. Usa la configuración Redis común de
`buildQueueOptions`. Cada barrido registra ejecución, empresa fallida y recordatorios.

Envía correo a todos los administradores activos al quedar 7, 3 y 1 día. Persiste
el día en `trialRemindersSent` después del envío; solo lo agrega si falta. Los
reintentos usan una clave Resend estable por empresa, usuario y día restante para
evitar duplicar un envío confirmado cuando otro destinatario falla. Un fallo no
marca el día ni detiene el procesamiento de otras empresas. El aviso del panel
proviene del endpoint de cuenta y nunca de `Notice`.

Al vencer, revalida estado y fecha bajo bloqueo y consulta suscripciones autorizadas:
activa la cuenta si encuentra una, o suspende con `trial_expired`. No vence antes
de las 23:59 locales. Una suscripción diferida conserva la prueba hasta entonces;
la autorización inmediata la integra W2 por `transition`. Esta HU no llama a
Mercado Pago ni cambia su fecha de cobro.

## Límites de esta entrega

HU-30 implementa gracia y deuda; HU-42 cambio de plan; HU-43 bloqueo de acceso de
una cuenta suspendida y excepciones de turnos en curso. Esta entrega solo persiste
la suspensión y rechaza nuevos cupos; conserva todos los datos. Los fallos
persistentes de Redis/correo necesitan atención operativa para sostener los plazos.
No se promete entrega exactamente una vez fuera de la ventana de idempotencia
del proveedor de correo; el marcador persistido evita reenvíos en barridos normales.

Las pruebas automáticas usan `CLOCK` controlado, PostgreSQL local y servicios
externos simulados. La revisión visual en claro/oscuro y los anuncios con lector
de pantalla se completan con la checklist manual del PR.
