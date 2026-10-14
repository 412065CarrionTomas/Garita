# Registros de puntos e intentos rechazados

Documentación técnica del procesamiento e imputación de pasos por puntos de control en la API (HU-11).

## Modelo de datos

Los pasos por puntos de control e intentos de escaneo se persisten en dos modelos inmutables (solo inserción, nunca edición ni borrado):

### CheckpointRecord

Representa un escaneo o lectura confirmada de un punto de control del turno.

- **Campos principales:**
  - `companyId`, `shiftId`, `assignmentId`, `checkpointId`: identificación multitenant del turno, la asignación del vigilador y el punto registrado.
  - `recordId`: UUID v4 generado en el dispositivo móvil, con restricción `@unique`.
  - `method`: método de registro (`qr` o `nfc`).
  - `occurredAtDevice`: marca de tiempo ISO 8601 registrada en el dispositivo en el momento de la lectura.
  - `receivedAt`: marca de tiempo del servidor al recibir la petición (`CLOCK`).
  - `locationStatus`, `latitude`, `longitude`, `accuracyMeters`, `simulation`: estado de ubicación y geolocalización del dispositivo.
  - `phoneNfc`: estado del chip NFC del teléfono (`on`, `off`, `unsupported`).
  - `countedFor`: JSON con el arreglo de imputaciones `{ roundId, windowIndex, late }[]` resueltas por el algoritmo compartido.
  - `outOfWindow`: booleano que indica si el registro se produjo fuera de toda ventana y gracia configurada.
  - `countsForCompliance`: booleano (`false` si el evento ocurrió tras un cierre administrativo del turno; `true` en caso normal).
  - `requestHash`: hash SHA-256 del contenido canónico de la petición (`recordId`, `shiftId`, `method`, `scannedValue`, `occurredAtDevice`, ubicación y `phoneNfc`) utilizado para detectar colisiones o reutilización indebida de identificadores.
- **Índices:**
  - `[companyId, shiftId, checkpointId, occurredAtDevice]`
  - `[companyId, occurredAtDevice]`
  - `[shiftId, occurredAtDevice]`
  - `[checkpointId, occurredAtDevice]`

### InvalidScanAttempt

Registra lecturas fallidas o inválidas de QR o NFC para trazabilidad y auditoría del supervisor.

- **Campos principales:**
  - `companyId`, `shiftId`, `assignmentId`: contexto de la empresa, turno y asignación vigente.
  - `recordId`: UUID único del intento enviado por el celular.
  - `method`: método de lectura (`qr` o `nfc`).
  - `reason`: motivo del rechazo (`malformed`, `signature`, `other_site`, `outdated_version`, `unknown_checkpoint`, `tag_not_associated`, `tag_replaced`).
  - `scannedValue`: valor escaneado truncado a un máximo de 512 caracteres.
  - `occurredAtDevice`, `receivedAt`, datos de ubicación y simulación.
  - `highlighted`: marca booleana destacada (`true` para `outdated_version`, indicando un sticker regenerado o sustituido).
- **Índices:**
  - `[companyId, shiftId, occurredAtDevice]`
  - `[companyId, reason, occurredAtDevice]`
  - `[shiftId, occurredAtDevice]`

Ambos modelos están integrados en las políticas de aislamiento de tenant (`COMPANY_ID_MODELS` y `addSiteAssignmentFilter` a través del turno asociado).

## Idempotencia y detección de conflictos

El endpoint `POST /api/v1/registros-puntos` garantiza idempotencia estricta por `recordId`:

1. Ante un `recordId` nuevo, se computa su `requestHash` y se procesa.
2. Si el `recordId` ya existe en `CheckpointRecord` o `InvalidScanAttempt`:
   - Se compara el `requestHash` existente con el hash de la petición actual.
   - Si los hashes coinciden, se devuelve la **misma** respuesta que en la entrega original con código HTTP `200 OK`.
   - Si los hashes difieren (mismo UUID con datos diferentes), se rechaza con código HTTP `409 Conflict` y error `RECORD_ID_CONFLICT`.

## Verificación de códigos QR

Para lecturas con `method: 'qr'`:

1. El servidor verifica el payload mediante `QrService.verifyQrPayload(scannedValue)`.
   - `malformed`: formato de payload inválido -> rechazo `malformed`.
   - `signature`: firma HMAC-SHA256 no coincide -> rechazo `signature`. Un QR de otra empresa utiliza un secreto distinto y falla la firma sin revelar la existencia de la otra empresa.
   - `outdated`: el punto existe y la firma es válida, pero el `qrVersion` es menor a la versión vigente en base de datos -> rechazo `outdated_version` con `highlighted: true`.
   - `not_found`: identificador de punto no existe en la base de datos de la empresa -> rechazo `unknown_checkpoint`.
2. Verificación de predio: si el punto es válido y vigente pero su `siteId` no coincide con el `siteId` del turno en curso, se rechaza con `other_site`.
3. Todo escaneo rechazado genera un registro en `InvalidScanAttempt` y responde con `{ result: 'rejected', recordId, reason }`.

## Verificación de etiquetas NFC

Para lecturas con `method: 'nfc'`:

- Se verifica que el UID escaneado coincida con la etiqueta NFC activa del punto de control en el predio del turno.
- Si no está asociado a ningún punto del predio, se rechaza con motivo `tag_not_associated`.
- Si el UID pertenecía a una etiqueta histórica ya reemplazada, se rechaza con `tag_replaced`.
- Si pertenece a un punto de otro predio, se rechaza con `other_site`.
- Si es válido, continúa el mismo flujo de imputación a ventanas que un QR.

## Imputación a ventanas de ronda

Una vez validado el punto, se evalúa su asignación e imputación con la función compartida `imputeRecord`:

- **Ventanas y rondas del turno:** se construyen las rondas del turno con las versiones fijadas al iniciar el turno (`ShiftRound.roundVersionId`) y sus ventanas calculadas según horarios y frecuencias.
- **Historial de registros previos:** se consultan los registros previos válidos del turno para el cálculo del tiempo mínimo y duplicados.
- **Asignación:** se verifica la asignación vigente del vigilador en el turno.
- **Resultados de imputación:**
  - `counted`: el punto cuenta para una o varias rondas que tienen una ventana abierta o en período de gracia a la que le falta el punto. Se guarda en `CheckpointRecord` con `countedFor: [{ roundId, windowIndex, late }]` y `outOfWindow: false`. Si la ventana ya había finalizado pero estaba dentro de su período de gracia (`graceMinutes`), se marca `late: true` ("completa con demora").
  - `out_of_window`: el registro ocurrió fuera de cualquier ventana o período de gracia configurado. Se guarda en `CheckpointRecord` con `outOfWindow: true`, `countedFor: []` y `countsForCompliance: true` (a menos que aplique cierre administrativo).
  - `too_soon`: el punto ya fue registrado recientemente y no transcurrió el tiempo mínimo requerido (la mitad de la duración de la ventana). **No** se guarda en la base de datos y se responde `{ result: 'not_generated', cause: 'too_soon', retryAfterUtc }`.
  - `already_recorded`: el punto ya fue completado en la ventana actual de todas las rondas que lo contienen. **No** se guarda en la base de datos y se responde `{ result: 'not_generated', cause: 'already_recorded', retryAfterUtc: null }`.
- **Puntos compartidos entre rondas:** un único escaneo de un punto compartido (por ejemplo, "Galpón 1" perteneciente a las rondas "Perimetral" e "Interna") cuenta simultáneamente para todas las rondas aplicables en `countedFor`.
- **Sospecha y ubicación:** el servidor nunca rechaza un registro por falta de GPS o sospecha (conforme a HU-15).

## Turnos cerrados administrativamente

Si el turno fue cerrado de forma administrativa (por desactivación forzada del vigilador, baja del predio o baja del cliente):

- Los registros móviles generados con fecha de dispositivo `occurredAtDevice` posterior al cierre administrativo del turno se aceptan y almacenan con `countsForCompliance: false`.
- Esto permite registrar el paso sin alterar las métricas de cumplimiento del turno cerrado.
