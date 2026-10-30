# Alertas de pánico (HU-21)

## Modelo y ciclo de vida

`PanicAlert.id` es el UUID generado en el celular. La alerta pertenece a empresa, predio, turno, asignación y vigilador; guarda hora confiable de activación, recepción, última ubicación, precisión, canal y cantidad de activaciones. `PanicAlertEvent` registra `created`, `activation` y `location_updated`; HU-24 ampliará el ciclo con confirmación, escalamiento y resolución. El estado inicial es `active`; solo HU-24 podrá llevarlo a `confirmed` o `resolved`.

El `POST` con el mismo `alertId` devuelve la alerta previa sin duplicarla. Otro UUID recibido mientras el turno tiene una alerta sin resolver incrementa `activationCount` y agrega un evento a esa alerta. La transacción serializa las activaciones por turno. La API persiste antes de emitir `panico.actualizado` y llamar a `NOTIFICATIONS_PORT.notifySiteStaff` con prioridad alta y solo «Alerta de pánico» y el predio.

## Endpoints

Todas las rutas usan `/api/v1`, HTTPS y exclusivamente la credencial de turno `Bearer` validada por `ShiftCredentialGuard`:

- `POST /alertas-panico`: cuerpo `createPanicAlertRequestSchema`, respuesta `panicAlertStateResponseSchema`; requiere turno en curso y asignación vigente.
- `PATCH /alertas-panico/:alertId/ubicacion`: cuerpo `updatePanicLocationRequestSchema`; conserva solo una ubicación más precisa.
- `GET /alertas-panico/:alertId/estado`: devuelve el estado confirmado por el servidor para la app.

## App y puntos de extensión

`triggerPanic()` es la entrada única para el botón y HU-22. Captura la última ubicación conocida y el reloj confiable, guarda la solicitud en SQLite (`panic_alerts`) y recién después intenta el POST por un pedido propio, sin esperar la cola de HU-13. El botón exige dos segundos, vibra brevemente y no reproduce sonido. Una lectura más precisa posterior se envía por PATCH. La consulta periódica de estado muestra solo recepción y confirmación que el servidor devolvió. No hay cancelación en la app.

El canal SMS es inyectable en `features/panico/transport.ts`. Sin red o después de `PANIC_SMS_FALLBACK_SECONDS`, hoy registra `smsState: unavailable` en SQLite (`TODO(HU-23)`). La solicitud permanece pendiente y se reintenta con el backoff de HU-13; HU-23 reemplazará el canal. HU-24 incorporará atención, confirmación y resolución en la API y el panel.

La cola regular despacha primero los pánicos pendientes al recuperar red o volver al primer plano. Mientras una alerta no tenga recepción confirmada, conserva los eventos (incluido el cierre) y la credencial del turno; un pedido sin respuesta vence a los 8 segundos y vuelve a intentar con el backoff existente. Este ajuste en `processSyncQueue` fue autorizado por el coordinador durante el relevo.

## Corrección W3c: ciclo local y concurrencia

La disponibilidad del botón y `triggerPanic` comparten `getRunningPanicShift`: un turno guardado deja de estar en curso en cuanto tiene `shift_close` pendiente o recepción de cierre confirmada. Las escrituras locales de inicio/cierre notifican al layout sin depender de navegar a otra ruta.

El orden de ocurrencia se conserva ante un cierre sin red: un pánico anterior al cierre se entrega primero y retiene el cierre y la credencial hasta su recepción. Si existe un pánico heredado con hora igual o posterior al cierre local, queda guardado con `blockedReason: shift_closed`, sin estado recibido ni POST, y registra en `sync_state` un mensaje con el identificador de alerta pero sin ubicación; ese registro no bloquea el cierre ni cuenta como envío pendiente.

Las activaciones pendientes no ocultan el último estado confirmado del turno. La persistencia de una respuesta notifica inmediatamente al overlay; la consulta remota periódica queda para cambios posteriores del supervisor.

`patchPanicAlert` serializa por conexión local la lectura, fusión y escritura transaccional del JSON. Transporte, lectura de ubicación y polling actualizan solo sus campos; una segunda llamada de envío espera la misma promesa en curso. API y app descartan como mejora toda ubicación que no sea `ok`, carezca de latitud/longitud o no tenga una precisión mejor.

## Atención (HU-24)

El panel `/alertas-panico` y sus detalles permiten atender alertas a administradores y supervisores asignados al predio. Las nuevas rutas usan Firebase, independientes de las rutas con credencial de turno de HU-21. Todas llevan el prefijo `/api/v1`:

| Método y ruta                                  | Comportamiento                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /alertas-panico?estado=&predio=&pagina=1` | Más nuevas primero, páginas de 25 y `activeCount` de todas las activas visibles, independiente de los filtros.                                                                             |
| `GET /alertas-panico/:id`                      | Vigilador y teléfono, predio, canal, horas, ubicación, autores de atención y estados de SMS; no expone teléfonos de destinatarios.                                                         |
| `POST /alertas-panico/:id/confirmar`           | `active` → `confirmed`, guarda `confirmedById` y `confirmedAt`. Repetir devuelve 409, incluso con el mismo usuario.                                                                        |
| `POST /alertas-panico/:id/resolver`            | `confirmed` → `resolved`; exige `outcome` (`real_emergency`, `false_alarm`, `test`) y `comment` de 5 a 1.000 caracteres después de recortar espacios. Puede hacerlo otra persona asignada. |

La actualización condicional y su evento (`confirmed` o `resolved`) comparten transacción. Una decisión concurrente que pierde responde 409. No hay cancelación. El vigilador sigue consultando `GET /alertas-panico/:id/estado`, que refleja `confirmedAt`. Recursos de otra empresa o predio no asignado responden 404; `guard` y `client`, 403. `PanicSmsDelivery` comparte aislamiento tenant y por predio a través de la alerta.

`triggeredAt` conserva la hora de envío del celular; `receivedAt`, la recepción por la plataforma. No se reemplazan al confirmar. El tiempo de respuesta para E6 se calcula desde `triggeredAt`; los reportes quedan fuera de esta entrega. El detalle muestra las dos horas en la zona horaria de la empresa y avisa cuando difieren más de un minuto. HU-37 aportará la autenticación de las alertas SMS; hoy todas las alertas registradas están autenticadas.

### Entrega y escalamiento

Se conserva la push de HU-21: `notifySiteStaff` selecciona supervisores asignados activos y administradores, todos sus dispositivos, prioridad alta. No se envía identidad ni coordenadas en la notificación. `panico.actualizado` invalida las consultas `['panico']`; no existe un evento separado para alerta nueva. El panel también consulta las activas cada 15 segundos como respaldo.

Después del commit de creación se encolan `panic-sms` (SMS inicial) y `panic-escalation` (job con el UUID de alerta, demora de `PANIC_ESCALATION_SECONDS = 120` desde **recepción**). Redis/BullMQ debe estar disponible. Repetir el POST repara el encolado si hubo un error después del commit; las claves estables evitan duplicar jobs. Ambos usan los cinco intentos y backoff exponencial comunes.

El procesador de escalamiento comprueba estado `active`, plazo y `escalatedAt` nulo, y marca el escalamiento con una actualización condicional y evento `escalated` en transacción. Si ya está confirmada, no hace nada. Reenvía push alta, encola SMS con motivo `escalation` y emite `panico.actualizado`. El evento guarda si se despacharon los efectos, para reintentar un fallo de cola sin otro escalamiento. El log `panic.escalated` contiene la demora real en segundos desde recepción. Redis y el worker deben estar operativos para cumplir el objetivo de 120 segundos con menos de 30 segundos de desvío; no es una garantía medida en dispositivos.

### SMS a destinatarios

El job resuelve supervisores activos asignados al predio y empresa; si ninguno tiene teléfono válido, incorpora administradores activos. Al escalar siempre incorpora administradores. Un teléfono debe tener formato internacional `+` y 8 a 15 dígitos; vacío o inválido queda `skipped`, sin llamar al puerto. El mensaje usa hora local y predio sin tildes: `Garita: alerta de panico en Deposito Ruta 9, 03:10. Abri el panel.` No incluye vigilador ni coordenadas y entra en 160 caracteres.

**Decisión vigente: solo log.** `SMS_PORT` mantiene `NoopSms`, que no registra teléfono ni mensaje y devuelve `{ sent: false }`. Por tanto hoy no salen SMS reales: se registra `skipped`; un proveedor simulado con `true` produce `accepted`, y una excepción produce `failed` y reintento. Cada registro contiene destinatario, teléfono, motivo y fecha; el detalle devuelve únicamente sus identificadores y estado. Se registra evento `sms_sent` con el estado, que no afirma entrega física. La clave única alerta/usuario/motivo evita reenviar destinatarios ya procesados; los fallidos se reintentan.

`TODO(HU-24-proveedor)` reserva el proveedor del Sprint 5 y `SMS_PROVIDER_API_KEY` está comentada en `.env.example`, sin configuración activa. Al integrarlo deberá usar una clave idempotente por alerta/usuario/motivo: una caída entre aceptación del proveedor y persistencia local puede repetir una entrega. Tampoco se informa costo estimado mientras no existe proveedor ni tarifa configurada. El SMS enviado por el celular es HU-23; la recepción de SMS es HU-37.

### Sonido y límites de los dispositivos

El layout presenta un banner de peligro con ícono y texto, `role="alert"` y anuncio assertivo. Mientras haya alguna alerta activa, Web Audio repite un tono cada cuatro segundos; al confirmar la última activa se detiene. **Activar sonido de alertas** reanuda el audio con interacción y guarda la preferencia en `localStorage`; el navegador puede pedir otra interacción después de recargar. No se agrega una dependencia ni un archivo de audio.

La pestaña en segundo plano puede ser suspendida y el modo silencio, No molestar o permisos del sistema pueden impedir sonido y notificaciones. En iPhone la PWA debe estar instalada y contar con permiso de notificaciones; no se prometen alertas críticas que ignoren el silencio. El envío push de la app iOS del vigilador sigue sujeto a la integración FCM/APNs documentada en `notificaciones.md`. El sonido del panel es complementario: no sustituye la guardia ni acredita recepción humana. La suspensión de cuentas conserva un punto de extensión `TODO(HU-43)`.
