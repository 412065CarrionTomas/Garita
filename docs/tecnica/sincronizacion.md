# Sincronización y trabajo sin señal

Documentación técnica del mecanismo de sincronización por lotes, credenciales de turno y avisos de conexión de la API (HU-13).

## 1. Diseño de la credencial de turno

Durante el trabajo sin señal o conectividad intermitente, los tokens de sesión de Firebase Authentication expiran en 60 minutos y no pueden renovarse sin acceso a los servidores de Google. Para resolver esto:

- **Token autofirmado de servidor:** Al iniciar un turno (`POST /api/v1/turnos/:id/iniciar`), la API emite una credencial propia firmada mediante HMAC-SHA256 utilizando el secreto `SHIFT_CREDENTIAL_SECRET`.
- **Estructura del payload:**
  ```json
  {
    "shiftId": "uuid-del-turno",
    "assignmentId": "uuid-de-la-asignacion",
    "userId": "uuid-del-vigilador",
    "companyId": "uuid-de-la-empresa",
    "exp": 1800000000
  }
  ```
- **Expiración:** El tiempo de vida (`exp`) se fija a la hora de fin programada del turno (`scheduledEnd`) más una cantidad configurable de días de gracia (`SHIFT_CREDENTIAL_VALID_DAYS_AFTER_END`, por defecto 7 días).
- **Almacenamiento seguro y auditoría:** El token JWT no se almacena en texto plano en la base de datos. Se persiste su hash SHA-256 (`tokenHash`) en la tabla `ShiftCredential` junto con `shiftId`, `userId`, `expiresAt` y `revokedAt`. Esto permite verificar en tiempo constante su existencia, auditar las emisiones y revocar credenciales de manera inmediata sin exponer el secreto ni los tokens originales.
- **Idempotencia al iniciar:** Si el vigilador reintenta la petición de inicio de turno por conectividad inestable, el endpoint devuelve exactamente la misma credencial original emitida sin crear registros duplicados.

## 2. Flujo de autenticación y control de alcance

La API implementa un modelo de seguridad con principio de privilegio mínimo para la credencial de turno:

- **`ShiftCredentialGuard`:** Guard especializado que protege de forma exclusiva los endpoints de sincronización (`POST /api/v1/sincronizacion/eventos` y `POST /api/v1/avisos-conexion`).
  - Estos endpoints se marcan como `@Public()` para el guard global de Firebase Authentication.
  - El guard valida el formato Bearer, la firma criptográfica HMAC-SHA256, la fecha de expiración y consulta `ShiftCredential` para descartar tokens revocados o inexistentes.
  - Configura el contexto multitenant (`TenantContext`) a partir del `companyId` embebido en la credencial.
  - Si la credencial falta, está corrupta, vencida o revocada, responde con código HTTP `401 Unauthorized` y código de error `INVALID_SHIFT_CREDENTIAL`.
- **Restricción de alcance (`AuthGuard`):** El guard global de Firebase Authentication detecta si un cliente intenta utilizar la credencial de turno en cualquier otro endpoint estándar de la API (por ejemplo, endpoints de administración, reportes o configuración). En tal caso, rechaza la solicitud de inmediato con código HTTP `403 Forbidden` y error `CREDENTIAL_SCOPE_NOT_ALLOWED`.
- **Vigiladores desactivados (CA10):** Un vigilador que haya sido desactivado en el sistema después de haber iniciado su turno puede continuar sincronizando los eventos acumulados de ese turno. El `ShiftCredentialGuard` no valida el campo `User.status`, sino que verifica la validez de la credencial y la correspondencia con el turno y la asignación existentes.

## 3. Sincronización por lotes (`POST /api/v1/sincronizacion/eventos`)

El endpoint recibe lotes de eventos generados sin señal (`syncBatchRequestSchema`):

- **Registro de lote en `SyncBatch`:** Cada lote recibido se persiste registrando `id`, `shiftId`, `companyId`, `receivedAt`, `eventCount` (cantidad de eventos), `pendingCount` y `syncedUntil`.
- **Procesamiento en orden estricto:** Los eventos se procesan uno por uno en el orden cronológico en que fueron recolectados en el dispositivo móvil.
- **Aislamiento de fallos:** El rechazo o error en un evento no aborta el lote completo ni frena el procesamiento de los eventos subsiguientes. El endpoint siempre responde con código HTTP `200 OK` y un arreglo `results` con el resultado individual de cada evento:
  - `accepted`: Evento procesado exitosamente, con su `outcome` específico (`recorded`, `closed`, etc.).
  - `duplicate`: Evento que ya había sido procesado previamente con datos idénticos; se confirma sin duplicar registros.
  - `rejected`: Evento con datos inválidos, con su `reason` y mensaje descriptivo en español. Si el evento indica un `shiftId` distinto al de la credencial presentada, se rechaza con motivo `not_in_credential_shift`. Si se reutiliza un identificador con datos distintos a los originales, se rechaza con `event_id_conflict`.
- **Deduplicación e idempotencia:**
  - `checkpoint_record`: Se verifica la existencia previa de `recordId` en `CheckpointRecord` e `InvalidScanAttempt`. Si existe con el mismo `requestHash`, se reporta como `duplicate`. Si existe con hash diferente, se rechaza por `event_id_conflict`.
  - `shift_close`: Se verifica la existencia previa de `deviceEventId` en `ShiftEvent`. Si ya existe para el mismo turno, se reporta como `duplicate`. Si pertenece a otro turno, se rechaza como `event_id_conflict`.
- **Optimización de contexto (`batchContext`):** Antes de recorrer los eventos, el servicio precarga en memoria los datos del predio, rondas fijadas, ventanas y registros previos del turno, reutilizándolos en cada paso para maximizar el rendimiento.

## 4. Estados de turno permitidos y eventos tardíos

- **Turno en progreso (`in_progress`):** Flujo habitual. Los registros de puntos se imputan contra las ventanas de ronda correspondientes y el cierre finaliza el turno.
- **Turno cerrado automáticamente (`auto_closed` - CA9):** Si el servidor cerró el turno automáticamente por vencimiento de plazo antes de que el celular recuperara señal:
  - Los eventos de lectura recibidos en el lote se aceptan y se imputan con normalidad (`countsForCompliance: true`).
  - El evento de cierre real del vigilador (`shift_close`) reemplaza el estado a `closed`, actualiza `closedAt` con la hora real del dispositivo y preserva `autoClosedAt` y el evento `auto_close` en el historial de `ShiftEvent`.
- **Turno cerrado administrativamente (`closed` - CA10):** Si el turno fue cerrado por un administrador (por ejemplo, por desactivación forzada del vigilador o baja del predio):
  - Los eventos móviles con hora del dispositivo posterior al cierre administrativo se aceptan y persisten con `countsForCompliance: false`, evitando distorsionar los indicadores de cumplimiento del turno ya liquidado.

## 5. Avisos de conexión y estado de sincronización (`ShiftSyncState`)

El endpoint `POST /api/v1/avisos-conexion` permite a la aplicación móvil enviar avisos periódicos de presencia de red cuando aún tiene eventos pendientes por sincronizar:

- **Registro en `ConnectionNotice`:** Se guarda cada aviso con `shiftId`, `companyId`, `sentAtDevice`, `receivedAt`, `pendingCount` y `syncedUntil`.
- **Avance monótono de `syncedUntil`:** En la tabla `ShiftSyncState` (que mantiene el último estado conocido por turno), la marca temporal `syncedUntil` **solo avanza**. Si por fluctuaciones de red un aviso o lote llega fuera de orden o con una fecha anterior a la ya registrada, `syncedUntil` se mantiene inmutable en el valor más reciente alcanzado.
- **Monitoreo desde el panel:** El panel de supervisión y los servicios de monitoreo leen `ShiftSyncState` para conocer `lastContactAt`, `lastBatchAt` y la cantidad de eventos pendientes informados por el dispositivo móvil a través del campo `pendingEventsLastReported`.
