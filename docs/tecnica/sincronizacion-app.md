# Sincronización y trabajo sin señal en la app móvil (HU-13)

Este documento detalla la arquitectura y el comportamiento del cliente móvil (app del vigilador) para operar de manera autónoma sin señal de red y sincronizar automáticamente con la API central.

---

## 1. Cola local de eventos

Toda acción de campo realizada por el vigilador durante su turno (registros de puntos por QR/NFC, cierres de turno e intentos observados) se almacena de forma persistente en SQLite (`garita-field.db`) antes de cualquier intento de comunicación remota.

- **Tabla `pending_events`**: almacena cada evento con su identificador UUID generado por el celular, su tipo (`checkpoint_record`, `shift_close`), su payload estructurado en JSON, la marca temporal `occurred_at_device` y `created_at`.
- **Orden de procesamiento**: las consultas leen los eventos pendientes ordenados cronológicamente por `occurred_at_device ASC, created_at ASC`, garantizando que el servidor reciba la secuencia real en la que sucedieron los hechos en el predio.
- **Eventos admitidos en lotes**: únicamente los eventos de tipo `checkpoint_record` y `shift_close` viajan en los lotes de sincronización. El evento `shift_start` requiere conexión directa y no se procesa por esta vía.
- **Tamaño de lote (`SYNC_BATCH_MAX_EVENTS`)**: los eventos se agrupan en lotes de hasta 100 unidades por solicitud HTTP (`POST /sincronizacion/eventos`).
- **Idempotencia (CA3)**: la API utiliza el identificador de cada evento (`recordId` en registros, `eventId` en cierre). Si un corte de señal interrumpe la respuesta de un lote ya recibido, el reenvío es reconocido como `duplicate` y aceptado sin duplicar marcas.
- **Tratamiento de resultados por evento**:
  - `accepted` / `duplicate`: se marca el evento como enviado (`sent = 1`) en SQLite y se actualiza el resultado en la tabla local `checkpoint_records` (`server_result = 'recorded'`).
  - `rejected`: el evento no se descarta ni bloquea el envío de los restantes. Se registra el motivo en la columna `reject_reason` de `pending_events` para auditoría y diagnóstico técnico, y se refleja en `checkpoint_records` (`server_result = 'rejected'`, `server_reason = reason`).
  - **Fallo de red o 5xx**: ante un error transitorio de conexión o respuesta 5xx del servidor, no se altera ningún estado local y se programa un reintento con espera exponencial.

---

## 2. Disparadores de sincronización

El proceso de vaciado de la cola se activa mediante los siguientes eventos:

1. **Recuperación de señal de red**: suscripción a `expo-network`. Al detectarse conectividad con acceso a internet, se dispara de inmediato la sincronización.
2. **Paso a primer plano (`AppState`)**: cuando el vigilador desbloquea el dispositivo o vuelve a la aplicación, se evalúa el estado de la cola y se inicia el envío.
3. **Reintentos con espera creciente (CA11)**: tras un fallo de red o del servidor, la función pura `computeSyncBackoff(attempt)` calcula el tiempo de espera exponencial:
   $$\text{espera} = \min(300, 5 \times 2^{\text{intento}}) \text{ segundos}$$
   Inicia en 5 segundos y alcanza un tope de 300 segundos (5 minutos), sin límite en la cantidad de intentos para asegurar que ningún registro quede varado indefinidamente en el dispositivo.
4. **Candado de concurrencia**: un semáforo en memoria (`isSyncing`) asegura que nunca se ejecuten dos envíos de lotes simultáneamente.

---

## 3. Credencial de turno

Para proteger las operaciones de campo y permitir el envío aun cuando el vigilador haya sido desactivado administrativamente o su token de Firebase haya expirado (CA10, Escenario 5):

- **Emisión y almacenamiento**: al iniciar el turno (`POST /turnos/:id/iniciar`), la respuesta incluye `credential` (token firmado por el servidor con validez de hasta 7 días posteriores al fin programado). La app la almacena en el llavero seguro del sistema operativo mediante `expo-secure-store`.
- **Ámbito restringido**: se envía únicamente en el encabezado `Authorization: Bearer <credencial>` en los endpoints `/sincronizacion/eventos` y `/avisos-conexion`. La credencial nunca se utiliza para otras funciones ni se imprime en registros de log.
- **Ciclo de vida**: la credencial y los datos del turno se conservan de forma segura mientras existan registros pendientes en la cola. Se eliminan de `expo-secure-store` y SQLite exclusivamente cuando se confirma la recepción del cierre de turno y la cola queda vacía (`pendingCount === 0`).

---

## 4. Avisos de conexión periódicos (CA5)

- **Frecuencia**: cada 120 segundos (`CONNECTION_NOTICE_INTERVAL_SECONDS`).
- **Condiciones**: se emite únicamente si se cumplen en simultáneo tres condiciones:
  1. Hay un turno en curso en el dispositivo.
  2. Existe conexión a internet reachable.
  3. La aplicación se encuentra activa en primer plano (`AppState === 'active'`).
- **Cuerpo del aviso**: `POST /avisos-conexion` informa `shiftId`, `sentAtDevice`, `pendingCount` y la marca temporal `syncedUntil`.
- **Tolerancia a fallos**: cualquier fallo de red en el aviso se ignora en silencio, reintentando de forma natural en el siguiente ciclo de 2 minutos.

---

## 5. Indicadores en pantalla y accesibilidad (ID-162)

En la pantalla de turno en curso (`ShiftScreen`), el vigilador visualiza información clara en modo texto accesible:

- **Contador de registros pendientes**: texto "N registros pendientes de envío", utilizando la forma singular ("1 registro pendiente de envío") o plural ("0 registros pendientes de envío", "5 registros pendientes de envío") según corresponda (BDD 1, 2, 4).
- **Último envío exitoso**: "Último envío: H:mm" expresado en la zona horaria del predio/empresa, o "Todavía no se envió nada" si aún no se completó ninguna sincronización.
- **Estado de conexión**: muestra "Sin conexión" cuando el dispositivo no tiene red y "Enviando…" mientras se transmite un lote al servidor.

---

## 6. Cierre de sesión con registros pendientes (CA6)

Si el vigilador intenta cerrar sesión teniendo eventos pendientes en la cola local:

- La app intercepta la acción y despliega una advertencia modal informando la cantidad exacta de eventos pendientes y solicitando confirmación.
- Si el usuario confirma, la sesión de Firebase se cierra, pero **bajo ninguna circunstancia se eliminan** los registros de SQLite ni la credencial de `expo-secure-store`. Ambos elementos permanecen resguardados para ser transmitidos en cuanto vuelva la señal o se vuelva a ingresar.

---

## 7. Punto de extensión para alertas urgentes (HU-21, CA8)

El servicio de cola expone la función `sendUrgentEvent`, reservada para la alerta de pánico (HU-21). Esta vía permitirá saltar la espera de los lotes regulares y despachar de forma prioritaria la alerta al servidor.
