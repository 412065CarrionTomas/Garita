# Ejecución de turno

## Estados y eventos

Un turno planificado pasa a `in_progress` al iniciarlo el vigilador asignado, a `closed` al cerrarlo el vigilador o el administrador y a `auto_closed` cuando vence el plazo del servidor. Cada acción se registra en `ShiftEvent` con empresa, turno, asignación, hora ocurrida y recibida, actor, motivo y ubicación disponible. Los identificadores del dispositivo son UUID únicos; la restricción única de base hace idempotentes los reintentos.

El inicio usa `CLOCK` del servidor como `startedAt`; `occurredAtDevice` se conserva en el contrato recibido y la operación requiere conexión. Se fija en `ShiftRound.roundVersionId` la versión vigente de cada ronda. La respuesta incluye puntos activos, versión de QR, UID NFC vigente, rondas, ventanas calculadas para el turno y `serverTime`.

## Cierre y automatización

El cierre del vigilador usa la hora del dispositivo, que debe estar entre el inicio del turno y la recepción. Si ocurre antes del fin programado, el motivo es obligatorio y `closedEarly` queda verdadero. El cierre automático de BullMQ se programa para el más tardío entre `endsAt + 120 minutos` y el plazo de sincronización del predio; un barrido periódico recupera jobs vencidos. Ambos caminos usan `CLOCK` y verifican el estado para tolerar reintentos.

El cierre automático deja un evento `auto_close` y el turno en `auto_closed`. Un cierre real recibido después reemplaza `closedAt` y el estado a `closed`, preservando `autoClosedAt` y el evento automático en el historial. El cierre automático no declara completas las ventanas.

## Cierres administrativos y eventos tardíos

Desactivar un vigilador con turno en curso devuelve `409 GUARD_HAS_SHIFT_IN_PROGRESS`; `{ "forceDeactivate": true, "reason": "..." }` lo cierra en el momento como `admin_close`. Dar de baja un predio o cliente cierra los turnos en curso con motivo `baja del predio`; el impacto de baja los cuenta. Los eventos móviles posteriores a ese cierre se guardan con `countsForCompliance: false`.

Los servicios de notificación de cierre anticipado (HU-35), cobertura (HU-44), y notificación/SMS (HU-45) quedan como puntos de integración para sus historias.
