# Cuenta suspendida — HU-43

Una prueba vencida sin suscripción, una gracia vencida o la cancelación al terminar el ciclo suspenden la cuenta. Los datos y la configuración se conservan. El administrador regulariza en **Suscripción y cobros**; si venció la gracia, paga completo el ciclo rechazado con Checkout Pro. Si venció la prueba o se canceló la suscripción, elige un plan y vuelve a suscribirse.

No hay cobro proporcional: un rechazo del 1 de diciembre regularizado el 20 paga diciembre completo, incluidos los días de gracia y suspensión. Garita no cambia la fecha prevista del siguiente débito. Al elegir un plan menor se reutiliza la selección de vigiladores de HU-29; un turno iniciado aplaza las bajas correspondientes.

## Permisos y seguridad

`auth/account-suspension.policy.ts` es la única política. El guard lee el estado de la empresa junto con la identidad que ya consultaba; las cuentas activas no agregan una consulta. Toda ruta autenticada nueva queda bloqueada por defecto. Primero se comprueban sesión, estado del usuario y rol: sin sesión sigue siendo 401 y un rol no permitido sigue recibiendo 403.

Un acceso bloqueado responde 402 con `{ code: 'ACCOUNT_SUSPENDED', accountStatus: 'suspended', message }`. Nunca incluye deuda ni motivo. Los mensajes son:

- Supervisor: “La cuenta de tu empresa está suspendida. Contactá a tu administrador.”
- Cliente: “El servicio no está disponible temporalmente. Contactá a tu empresa de seguridad.”
- Vigilador: “La cuenta de tu empresa está suspendida. Consultá a tu supervisor.”
- Administrador: acceso a suscripción y pago, además de la atención de turnos ya iniciados.

Siempre siguen habilitados, con sus roles originales: `GET /auth/me`, `GET /cuenta/estado` (solo administrador), `GET /planes`, `/suscripcion` y sus subrutas, y `/dispositivos` y sus subrutas. El inicio de sesión ocurre en Firebase.

Para el administrador, el vigilador asignado y los supervisores activos del predio, según los roles originales de cada ruta, siguen habilitados:

- `GET /supervision/turnos`, `GET /mis-turnos`: listados restringidos a los turnos iniciados antes de la suspensión que siguen habilitados, incluidos los que cruzan medianoche.
- `GET /turnos/:id`, `/detalle`, `/estado`, `/datos` y `POST /turnos/:id/cerrar`: únicamente para esos turnos.
- `POST /turnos/:id/cerrar-sin-datos`: solo si fue iniciado antes de la suspensión, sigue pendiente de sincronizar y está dentro de su plazo; el servicio conserva sus demás validaciones.
- `GET /avisos`, `GET /avisos/:id`, `POST /avisos/:id/marcar-visto`: solo avisos de esos turnos, incluidos los contadores.
- `GET /alertas-panico`, `GET /alertas-panico/:id`, `POST /alertas-panico/:id/confirmar` y `/resolver`: alertas aún no resueltas de turnos iniciados antes de la suspensión. La atención del pánico continúa aunque haya vencido el plazo de sincronización del turno.

El acceso al turno vence al cerrarse y llegar sus datos, o al vencer su plazo de sincronización. La política usa la fecha capturada del turno y el cálculo compartido para turnos anteriores a esa captura. Los filtros de empresa y predio existentes siguen aplicándose; no se modificó `tenant-prisma.ts`.

Las rutas `@Public()` (salud, hora, invitaciones y webhooks) conservan su autenticación y firmas correspondientes. Las rutas públicas al guard central que usan `ShiftCredentialGuard` conservan la credencial acotada de turno: registros, sincronización, incidentes/fotos, pánico del vigilador y avisos de conexión. Por eso siguen aceptando los datos tardíos de un turno terminado durante la suspensión.

El resto queda bloqueado, incluidos altas y edición, reportes, portal, reasignación y cobertura de turnos. `POST /turnos/:id/iniciar` nunca se permite durante la suspensión y marca como `cancelled_by_suspension` únicamente el turno propio no iniciado. La cancelación de los turnos que llegan a su horario también se ejecuta desde los jobs y durante las transiciones de cuenta. No se restauran al reactivar. Sus ventanas no se evalúan como incumplimientos y no generan avisos de turno no iniciado ni de turno sin vigilador. Los avisos de cierre anticipado y las notificaciones, SMS y escalamiento del pánico de turnos iniciados continúan.

La suite HTTP enumera los controladores montados en el servidor mediante metadatos de Nest y comprueba cada ruta autenticada bloqueada con cada rol permitido. Su inventario completo se adjunta al reporte y al PR, con `blocked`, `always`, `shift`, `pending-sync`, `notice`, `panic`, `público` o `credencial de turno` como clasificación.

## Pausa, pago y reactivación

`POST /suscripcion/pagar-adeudado` es solo del administrador. Su cuerpo es `{ planId?, guardSelection? }`; responde con `initPoint` y `expiresAt`. Sin deuda por gracia vencida responde 409 indicando que debe volver a suscribirse. Reutiliza `GraceService.retry`, la referencia `grace:<cobro>`, el importe completo del cobro original, los controles contra pagos simultáneos y la expiración de la preferencia. La aprobación repetida es idempotente.

La transición de cuenta persiste `suspensionEffectsPending` en la misma transacción. La cola `subscription-suspension` la reconcilia cada 15 segundos, con seis intentos y backoff exponencial; la marca persiste ante errores y un barrido posterior recupera fallos definitivos. Este patrón evita perder el efecto entre el commit y el encolado y evita importar el módulo de suscripciones desde el de cuenta. La misma fila de empresa serializa los efectos y las transiciones.

Al suspender, Mercado Pago recibe `status: paused`. La suscripción cancelada por HU-42 se excluye; no se reactiva ni se pausa de nuevo. Al aprobar el pago se activa la cuenta y la cola reanuda la suscripción marcada por esta suspensión con `status: authorized`. Se verifica primero el estado remoto para tolerar respuestas perdidas sin repetir la operación. Los planes menores actualizan el monto futuro y aplican la selección existente de vigiladores. La cola no cambia `nextChargeAt`; `syncPreapproval` mantiene su comportamiento y refleja la fecha real devuelta por Mercado Pago.

Fuentes oficiales consultadas:

- [Gestión de suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management): documenta pausa, reactivación y cambio de fecha mensual.
- [Actualizar suscripción](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/update-preapproval/put): define `PUT /preapproval/{id}` y muestra `next_payment_date` en la respuesta.

**PENDIENTE CRÍTICO: validar en sandbox que `paused → authorized` conserve la fecha de cobro habitual.** Las fuentes no garantizan ese comportamiento. Se compara la fecha devuelta con la prevista; si difiere, se registra `subscription.next_payment_date_diff` con ambas fechas. No se intenta corregir Mercado Pago ni generar prorrateos: la cuenta continúa activa y las sincronizaciones posteriores muestran la fecha real remota. CA7 depende de esa validación externa.

## Panel y app

El cliente web procesa 402 sin alterar los flujos de 401 y 403. La compuerta conserva las pantallas operativas habilitadas; los mensajes usan texto y `role="status"`. Solo el administrador consulta deuda. `/auth/me` entrega únicamente el estado de cuenta, sin motivo ni importe, para que todos los roles recuperen el acceso al volver el foco o en una revalidación cada 15 segundos mientras estén suspendidos.

En la app, el error de inicio conserva el mensaje validado con Zod; si el cuerpo es inválido usa el texto fijo del vigilador. El `Banner` existente anuncia el mensaje y `Text` conserva el tamaño de fuente del sistema. No se cambian el almacenamiento local, las acciones ni la sincronización de un turno iniciado.

## Checklist manual

- [ ] Sandbox: preparar un ciclo rechazado el día 1 con siguiente cobro el día 1 del mes siguiente; guardar `next_payment_date` antes de pausar.
- [ ] Suspender al vencer la gracia y verificar que la suscripción queda pausada y no acumula nuevos cobros.
- [ ] Pagar el día 20 el importe completo del ciclo original, aprobar el pago y verificar reactivación en menos de un minuto.
- [ ] Reanudar y consultar `next_payment_date`: **confirmar que continúa en el día 1 del mes siguiente**. Si cambia, registrar evidencia del pendiente crítico y del log de discrepancia; comprobar que el panel muestra la fecha remota real.
- [ ] Repetir webhook; confirmar que no hay otro pago ni reanudación duplicada.
- [ ] Elegir plan menor, seleccionar vigiladores y comprobar que un turno iniciado conserva su vigilador hasta cerrar.
- [ ] Android e iPhone: suspender durante un turno, seguir registrando, cargar incidentes, activar pánico, sincronizar sin señal y cerrar.
- [ ] Android e iPhone: intentar iniciar otro turno y comprobar el mensaje exacto con TalkBack/VoiceOver y fuente ampliada.
- [ ] Panel: mensajes por rol, cliente sin deuda ni motivo, supervisor del predio atendiendo pánico, otro predio bloqueado, recuperación automática al pagar.

El sandbox, los lectores de pantalla y los dispositivos físicos requieren validación manual; los mocks no prueban el calendario del proveedor ni el comportamiento nativo en hardware.

## Inventario de endpoints verificado

La suite e2e enumera rutas de los controladores montados y contrasta el bloqueo por rol. Este inventario registra el método, la ruta y la clasificación aplicada por el guard; las rutas públicas y las que usan credencial de turno conservan sus controles propios.

| Método | Endpoint                                                   | Clasificación       |
| ------ | ---------------------------------------------------------- | ------------------- |
| GET    | /api/v1/health/live                                        | público             |
| GET    | /api/v1/health/ready                                       | público             |
| GET    | /api/v1/auth/me                                            | always              |
| GET    | /api/v1/usuarios                                           | blocked             |
| GET    | /api/v1/usuarios/:id                                       | blocked             |
| POST   | /api/v1/usuarios                                           | blocked             |
| PATCH  | /api/v1/usuarios/:id                                       | blocked             |
| POST   | /api/v1/usuarios/:id/desactivar                            | blocked             |
| POST   | /api/v1/usuarios/:id/reactivar                             | blocked             |
| POST   | /api/v1/usuarios/:id/reenviar-invitacion                   | blocked             |
| POST   | /api/v1/invitaciones/canjear                               | público             |
| GET    | /api/v1/clientes/:id/usuarios                              | blocked             |
| POST   | /api/v1/clientes/:id/usuarios                              | blocked             |
| POST   | /api/v1/turnos/:id/iniciar                                 | blocked             |
| GET    | /api/v1/turnos/:id/datos                                   | shift               |
| GET    | /api/v1/turnos/:id/estado                                  | shift               |
| POST   | /api/v1/turnos/:id/cerrar                                  | shift               |
| POST   | /api/v1/turnos/:id/cerrar-sin-datos                        | pending-sync        |
| GET    | /api/v1/supervision/turnos                                 | shift               |
| GET    | /api/v1/turnos/:id/detalle                                 | shift               |
| GET    | /api/v1/turnos/:id/registros                               | blocked             |
| PATCH  | /api/v1/predios/:id/recorrido                              | blocked             |
| GET    | /api/v1/configuracion/predios                              | blocked             |
| PUT    | /api/v1/puntos/:id/etiqueta-nfc                            | blocked             |
| DELETE | /api/v1/puntos/:id/etiqueta-nfc                            | blocked             |
| POST   | /api/v1/puntos/:id/etiqueta-segura/configuracion           | blocked             |
| POST   | /api/v1/etiquetas-seguras/configuracion/:session/comando   | blocked             |
| POST   | /api/v1/etiquetas-seguras/configuracion/:session/confirmar | blocked             |
| POST   | /api/v1/etiquetas-seguras/:id/restablecer                  | blocked             |
| GET    | /api/v1/clientes                                           | blocked             |
| POST   | /api/v1/clientes                                           | blocked             |
| PATCH  | /api/v1/clientes/:id                                       | blocked             |
| POST   | /api/v1/clientes/:id/baja                                  | blocked             |
| GET    | /api/v1/clientes/:id/impacto-baja                          | blocked             |
| GET    | /api/v1/clientes/:id                                       | blocked             |
| GET    | /api/v1/predios                                            | blocked             |
| GET    | /api/v1/predios/supervisores-disponibles                   | blocked             |
| GET    | /api/v1/predios/:id                                        | blocked             |
| POST   | /api/v1/predios                                            | blocked             |
| PATCH  | /api/v1/predios/:id                                        | blocked             |
| POST   | /api/v1/predios/:id/baja                                   | blocked             |
| GET    | /api/v1/predios/:id/impacto-baja                           | blocked             |
| GET    | /api/v1/predios/:id/supervisores                           | blocked             |
| PUT    | /api/v1/predios/:id/supervisores                           | blocked             |
| GET    | /api/v1/usuarios/:id/predios                               | blocked             |
| GET    | /api/v1/predios/:id/conectividad                           | blocked             |
| PUT    | /api/v1/predios/:id/conectividad                           | blocked             |
| GET    | /api/v1/predios/:id/conectividad/simular                   | blocked             |
| GET    | /api/v1/predios/:id/puntos                                 | blocked             |
| POST   | /api/v1/predios/:id/puntos                                 | blocked             |
| PATCH  | /api/v1/puntos/:id                                         | blocked             |
| POST   | /api/v1/puntos/:id/baja                                    | blocked             |
| POST   | /api/v1/puntos/:id/regenerar-qr                            | blocked             |
| GET    | /api/v1/predios/:id/stickers                               | blocked             |
| GET    | /api/v1/predios/:id/rondas                                 | blocked             |
| POST   | /api/v1/predios/:id/rondas                                 | blocked             |
| PATCH  | /api/v1/rondas/:id                                         | blocked             |
| POST   | /api/v1/rondas/:id/baja                                    | blocked             |
| POST   | /api/v1/rondas/previsualizar-ventanas                      | blocked             |
| POST   | /api/v1/dispositivos                                       | always              |
| GET    | /api/v1/dispositivos                                       | always              |
| DELETE | /api/v1/dispositivos/:id                                   | always              |
| GET    | /api/v1/avisos                                             | notice              |
| POST   | /api/v1/avisos/:id/marcar-visto                            | notice              |
| GET    | /api/v1/avisos/:id                                         | notice              |
| GET    | /api/v1/cuenta/estado                                      | always              |
| GET    | /api/v1/turnos                                             | blocked             |
| GET    | /api/v1/turnos/:id                                         | shift               |
| POST   | /api/v1/turnos                                             | blocked             |
| PATCH  | /api/v1/turnos/:id                                         | blocked             |
| POST   | /api/v1/turnos/:id/cancelar                                | blocked             |
| POST   | /api/v1/turnos/:id/reasignar                               | blocked             |
| GET    | /api/v1/turnos/:id/asignaciones                            | blocked             |
| GET    | /api/v1/turnos/:id/reemplazos                              | blocked             |
| GET    | /api/v1/mis-turnos                                         | shift               |
| GET    | /api/v1/usuarios/:id/turnos-futuros                        | blocked             |
| POST   | /api/v1/registros-puntos                                   | blocked             |
| POST   | /api/v1/sincronizacion/eventos                             | credencial de turno |
| POST   | /api/v1/avisos-conexion                                    | credencial de turno |
| POST   | /api/v1/incidentes/:id/fotos/autorizacion                  | credencial de turno |
| POST   | /api/v1/incidentes/:id/fotos                               | credencial de turno |
| GET    | /api/v1/incidentes/cola/cantidad                           | blocked             |
| GET    | /api/v1/incidentes/cola                                    | blocked             |
| GET    | /api/v1/incidentes                                         | blocked             |
| GET    | /api/v1/incidentes/:id                                     | blocked             |
| POST   | /api/v1/incidentes/:id/clasificar                          | blocked             |
| POST   | /api/v1/incidentes/:id/reclasificar                        | blocked             |
| GET    | /api/v1/hora                                               | público             |
| GET    | /api/v1/ventanas-ronda/en-revision                         | blocked             |
| GET    | /api/v1/ventanas-ronda/:id                                 | blocked             |
| POST   | /api/v1/ventanas-ronda/:id/validar                         | blocked             |
| POST   | /api/v1/registros-puntos/:id/invalidar                     | blocked             |
| POST   | /api/v1/registros-puntos/:id/restituir                     | blocked             |
| POST   | /api/v1/alertas-panico                                     | credencial de turno |
| PATCH  | /api/v1/alertas-panico/:alertId/ubicacion                  | credencial de turno |
| GET    | /api/v1/alertas-panico/:alertId/estado                     | credencial de turno |
| GET    | /api/v1/alertas-panico                                     | panic               |
| GET    | /api/v1/alertas-panico/:id                                 | panic               |
| POST   | /api/v1/alertas-panico/:id/confirmar                       | panic               |
| POST   | /api/v1/alertas-panico/:id/resolver                        | panic               |
| GET    | /api/v1/empresa/telefono-guardia                           | blocked             |
| PUT    | /api/v1/empresa/telefono-guardia                           | blocked             |
| GET    | /api/v1/reportes/rondas                                    | blocked             |
| GET    | /api/v1/reportes/rondas/detalle                            | blocked             |
| GET    | /api/v1/reportes/pendientes                                | blocked             |
| GET    | /api/v1/reportes/puntos-marcas-frecuentes                  | blocked             |
| GET    | /api/v1/reportes/incidentes                                | blocked             |
| GET    | /api/v1/reportes/incidentes/detalle                        | blocked             |
| GET    | /api/v1/reportes/tiempos-de-respuesta                      | blocked             |
| GET    | /api/v1/reportes/panico                                    | blocked             |
| GET    | /api/v1/reportes/panico/detalle                            | blocked             |
| GET    | /api/v1/portal/predios                                     | blocked             |
| GET    | /api/v1/portal/rondas                                      | blocked             |
| GET    | /api/v1/portal/rondas/dia                                  | blocked             |
| GET    | /api/v1/portal/incidentes                                  | blocked             |
| GET    | /api/v1/portal/incidentes/:id/fotos                        | blocked             |
| GET    | /api/v1/portal/emergencias                                 | blocked             |
| GET    | /api/v1/reportes/rondas/pdf                                | blocked             |
| GET    | /api/v1/reportes/incidentes/pdf                            | blocked             |
| GET    | /api/v1/portal/reporte/pdf                                 | blocked             |
| GET    | /api/v1/mis-preferencias/notificaciones                    | blocked             |
| PUT    | /api/v1/mis-preferencias/notificaciones                    | blocked             |
| POST   | /api/v1/webhooks/mercadopago                               | público             |
| GET    | /api/v1/planes                                             | always              |
| POST   | /api/v1/suscripcion                                        | always              |
| POST   | /api/v1/suscripcion/cancelar                               | always              |
| POST   | /api/v1/suscripcion/revertir-cancelacion                   | always              |
| GET    | /api/v1/suscripcion                                        | always              |
| GET    | /api/v1/suscripcion/cambio-plan/simular                    | always              |
| POST   | /api/v1/suscripcion/cambio-plan                            | always              |
| GET    | /api/v1/suscripcion/historial                              | always              |
| GET    | /api/v1/suscripcion/medio-de-pago                          | always              |
| POST   | /api/v1/suscripcion/reintentar-cobro                       | always              |
| POST   | /api/v1/suscripcion/pagar-adeudado                         | always              |
| GET    | /api/v1/sms-recibidos                                      | blocked             |
| POST   | /api/v1/webhooks/sms                                       | público             |
