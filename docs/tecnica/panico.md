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
