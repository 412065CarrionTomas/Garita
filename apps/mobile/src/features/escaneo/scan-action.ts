import {
  fieldLocationSchema,
  computeSyncedUntil,
  formatTooSoonMessage,
  imputeRecord,
  nfcTagUidSchema,
  type CheckpointRecordMethod,
  type CheckpointRecordRequest,
  type CheckpointRecordResponse,
  type FieldLocation,
  type ImputedCountedWindow,
  type InvalidScanReason,
  type PhoneNfcState,
  type ShiftOfflineData,
} from '@garita/shared';
import * as Network from 'expo-network';
import { checkFieldPermissions, type FieldPermissionState } from '@/features/permisos/permissions';
import {
  createDefaultFieldRepository,
  applyCheckpointRecordResponse,
  type FieldRepository,
  type LocalCheckpointRecord,
} from '@/lib/db/database';
import { scheduleSyncRetry, notifySyncState } from '@/lib/cola/sync-service';
import { getCurrentLocation, LocationError } from '@/lib/location';
import { readClock } from '@/lib/clock/clock';
import { nfcAvailability } from '@/lib/nfc';
import { sendCheckpointRecord } from './api';
import { playSuccessFeedback } from './feedback';
import { parseAndValidateQr } from './qr-parser';

export type ScanActionResult =
  | {
      status: 'counted';
      message: string;
      checkpointId: string;
      checkpointName: string;
      recordId: string;
      countedFor: ImputedCountedWindow[];
    }
  | {
      status: 'out_of_window';
      message: string;
      checkpointId: string;
      checkpointName: string;
      recordId: string;
    }
  | {
      status: 'already_recorded';
      message: string;
      checkpointId: string;
      checkpointName: string;
    }
  | {
      status: 'too_soon';
      message: string;
      checkpointId: string;
      checkpointName: string;
      retryAfterUtc: string;
    }
  | {
      status: 'invalid_attempt';
      reason: InvalidScanReason;
      message: string;
      recordId: string;
    }
  | {
      status: 'error';
      message: string;
    };

export interface ScanActionsDependencies {
  now(): Date;
  online(): Promise<boolean>;
  permissions(): Promise<FieldPermissionState>;
  location(timeoutMs?: number): Promise<FieldLocation>;
  nfc(): Promise<PhoneNfcState>;
  uuid(): string;
  send(body: CheckpointRecordRequest): Promise<CheckpointRecordResponse>;
  repository(): Promise<FieldRepository>;
  feedback(): Promise<void>;
  triggerSync(): void;
}

function generateUuid(): string {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.randomUUID) return cryptoProvider.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

async function readLocation(timeoutMs = 5000): Promise<FieldLocation> {
  let permission: FieldPermissionState;
  try {
    permission = await checkFieldPermissions();
  } catch {
    permission = 'location_denied';
  }

  if (
    permission === 'location_denied' ||
    permission === 'location_approximate' ||
    permission === 'location_services_off'
  ) {
    return fieldLocationSchema.parse({
      status: 'disabled',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      simulation: 'unavailable',
      takenAt: null,
    });
  }

  try {
    const location = await getCurrentLocation({ timeoutMs });
    return fieldLocationSchema.parse({
      status: 'ok',
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracyMeters,
      simulation: location.simulation,
      takenAt: location.timestamp,
    });
  } catch (error) {
    if (error instanceof LocationError && error.code === 'PERMISSION_DENIED') {
      return fieldLocationSchema.parse({
        status: 'disabled',
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        simulation: 'unavailable',
        takenAt: null,
      });
    }
    return fieldLocationSchema.parse({
      status: 'unverifiable',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      simulation: 'unavailable',
      takenAt: null,
    });
  }
}

async function readPhoneNfc(): Promise<PhoneNfcState> {
  try {
    const state = await nfcAvailability();
    if (state === 'ready') return 'on';
    if (state === 'disabled') return 'off';
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

const defaultDependencies: ScanActionsDependencies = {
  now: () => new Date(),
  online: async () => {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },
  permissions: checkFieldPermissions,
  location: readLocation,
  nfc: readPhoneNfc,
  uuid: generateUuid,
  send: sendCheckpointRecord,
  repository: createDefaultFieldRepository,
  feedback: playSuccessFeedback,
  triggerSync: scheduleSyncRetry,
};

let overrides: Partial<ScanActionsDependencies> = {};

export function setScanActionsForTesting(next: Partial<ScanActionsDependencies>): void {
  overrides = { ...overrides, ...next };
}

export function resetScanActionsForTesting(): void {
  overrides = {};
}

function deps(): ScanActionsDependencies {
  return { ...defaultDependencies, ...overrides };
}

export async function processScan(
  scannedValue: string,
  shiftData: ShiftOfflineData,
  method: CheckpointRecordMethod = 'qr',
  onSaved?: (result: ScanActionResult) => void,
  sdmMessage?: string,
): Promise<ScanActionResult> {
  const d = deps();
  const now = d.now();
  const clockRepository = await d.repository();
  const clock = await readClock(clockRepository, now.toISOString());
  let uid: string | null = null;
  if (method === 'nfc') {
    try {
      uid = nfcTagUidSchema.parse(scannedValue);
      scannedValue = uid;
    } catch {
      // Conserva el valor original para guardar el intento inválido.
    }
  }
  const nfcCheckpoint = uid
    ? shiftData.checkpoints.find((point) => point.nfcUid === uid)
    : undefined;
  const parsed =
    method === 'qr'
      ? parseAndValidateQr(scannedValue, shiftData.checkpoints)
      : nfcCheckpoint
        ? { valid: true as const, checkpoint: nfcCheckpoint }
        : {
            valid: false as const,
            reason: 'tag_not_associated' as const,
            message:
              'Etiqueta no válida para este turno. Intento guardado; se verificará al enviar.',
          };

  if (!parsed.valid) {
    const recordId = d.uuid();
    const location = await d.location(method === 'nfc' ? 1500 : 5000);
    const phoneNfc = await d.nfc();
    const occurredAtDevice = now.toISOString();

    const requestPayload: CheckpointRecordRequest = {
      recordId,
      shiftId: shiftData.shift.id,
      method,
      clock,
      scannedValue,
      ...(sdmMessage ? { sdmMessage } : {}),
      occurredAtDevice,
      location,
      phoneNfc,
    };

    const repository = await d.repository();
    await repository.addPendingEvent({
      id: recordId,
      type: 'checkpoint_record',
      payload: requestPayload,
      occurredAtDevice,
      createdAt: now.toISOString(),
    });

    const attempt: ScanActionResult = {
      status: 'invalid_attempt',
      reason: parsed.reason,
      message: parsed.message,
      recordId,
    };
    onSaved?.(attempt);

    const response = await deliverScan(requestPayload, repository, d);
    return response ? serverScanResult(response, shiftData, attempt) : attempt;
  }

  const { checkpoint } = parsed;
  const repository = await d.repository();
  const localRecords = await repository.listCheckpointRecords(shiftData.shift.id);
  const validPreviousRecords = localRecords.filter((r) => r.serverResult !== 'rejected');

  const imputation = imputeRecord({
    rounds: shiftData.rounds,
    windows: shiftData.windows,
    checkpointId: checkpoint.id,
    occurredAtUtc: clock.trustedAt ?? now.toISOString(),
    previousRecords: validPreviousRecords.map((r) => ({
      checkpointId: r.checkpointId,
      occurredAtUtc: r.occurredAtUtc,
      countedFor: r.countedFor,
    })),
    assignment: {
      startsAtUtc: shiftData.shift.startsAt,
      endsAtUtc: shiftData.shift.endsAt,
    },
  });

  if (imputation.kind === 'already_recorded') {
    return {
      status: 'already_recorded',
      message: 'Este punto ya está registrado en esta vuelta',
      checkpointId: checkpoint.id,
      checkpointName: checkpoint.name,
    };
  }

  if (imputation.kind === 'too_soon') {
    const message = formatTooSoonMessage(checkpoint.name, imputation, shiftData.shift.timezone);
    return {
      status: 'too_soon',
      message,
      checkpointId: checkpoint.id,
      checkpointName: checkpoint.name,
      retryAfterUtc: imputation.retryAfterUtc,
    };
  }

  const isCounted = imputation.kind === 'counted';
  const message = isCounted
    ? `${checkpoint.name} registrado`
    : `${checkpoint.name} registrado fuera de ventana`;

  // Visual and audio confirmation
  if (method === 'qr') await d.feedback();

  const recordId = d.uuid();
  const location = await d.location(method === 'nfc' ? 1500 : 5000);
  const phoneNfc = await d.nfc();
  const occurredAtDevice = now.toISOString();

  const localRecord: LocalCheckpointRecord = {
    recordId,
    shiftId: shiftData.shift.id,
    checkpointId: checkpoint.id,
    checkpointName: checkpoint.name,
    occurredAtUtc: clock.trustedAt ?? occurredAtDevice,
    countedFor: isCounted ? imputation.countedFor : [],
    outOfWindow: !isCounted,
    serverResult: null,
    serverReason: null,
    createdAt: now.toISOString(),
  };

  await repository.saveCheckpointRecord(localRecord);

  const requestPayload: CheckpointRecordRequest = {
    recordId,
    shiftId: shiftData.shift.id,
    method,
    clock,
    scannedValue,
    ...(sdmMessage ? { sdmMessage } : {}),
    occurredAtDevice,
    location,
    phoneNfc,
  };

  await repository.addPendingEvent({
    id: recordId,
    type: 'checkpoint_record',
    payload: requestPayload,
    occurredAtDevice,
    createdAt: now.toISOString(),
  });

  const saved: ScanActionResult = isCounted
    ? {
        status: 'counted',
        message,
        checkpointId: checkpoint.id,
        checkpointName: checkpoint.name,
        recordId,
        countedFor: imputation.countedFor,
      }
    : {
        status: 'out_of_window',
        message,
        checkpointId: checkpoint.id,
        checkpointName: checkpoint.name,
        recordId,
      };
  if (method === 'nfc') await d.feedback();
  onSaved?.(saved);

  notifySyncState();
  const response = await deliverScan(requestPayload, repository, d);
  return response ? serverScanResult(response, shiftData, saved) : saved;
}

async function deliverScan(
  request: CheckpointRecordRequest,
  repository: FieldRepository,
  d: ScanActionsDependencies,
): Promise<CheckpointRecordResponse | null> {
  try {
    if (request.clock?.timeStatus !== 'pending' && (await d.online())) {
      const response = await d.send(request);
      await applyCheckpointRecordResponse(repository, request, response);
      await repository.markPendingEventSent(request.recordId);
      const pending = await repository.listPendingEvents();
      const earlierPending = pending.some(
        (event) => Date.parse(event.occurredAtDevice) <= Date.parse(request.occurredAtDevice),
      );
      const previous = await repository.getSyncMeta('synced_until');
      const syncedUntil = earlierPending ? previous : computeSyncedUntil([request], previous);
      if (syncedUntil) await repository.setSyncMeta('synced_until', syncedUntil);
      await repository.setSyncMeta('last_sync_at', d.now().toISOString());
      notifySyncState();
      if (pending.length > 0) d.triggerSync();
      return response;
    }
  } catch {
    // El evento persiste hasta que la cola confirme la entrega.
  }
  d.triggerSync();
  return null;
}

function serverScanResult(
  response: CheckpointRecordResponse,
  data: ShiftOfflineData,
  saved: ScanActionResult,
): ScanActionResult {
  if (
    response.result === 'rejected' &&
    saved.status === 'invalid_attempt' &&
    saved.reason === response.reason
  )
    return saved;
  if (response.result === 'rejected')
    return {
      status: 'invalid_attempt',
      recordId: response.recordId,
      reason: response.reason,
      message:
        response.reason === 'tag_replaced'
          ? 'Etiqueta reemplazada. Intento guardado.'
          : 'Lectura rechazada por el servidor. Intento guardado.',
    };
  const checkpointId =
    response.result === 'recorded'
      ? response.checkpointId
      : 'checkpointId' in saved
        ? saved.checkpointId
        : '';
  const checkpointName =
    data.checkpoints.find((point) => point.id === checkpointId)?.name ?? 'Punto de control';
  if (response.result === 'not_generated') {
    return response.cause === 'too_soon' && response.retryAfterUtc
      ? {
          status: 'too_soon',
          checkpointId,
          checkpointName,
          retryAfterUtc: response.retryAfterUtc,
          message: 'Este punto se registró hace poco. Esperá antes de volver a registrarlo.',
        }
      : {
          status: 'already_recorded',
          checkpointId,
          checkpointName,
          message: 'Este punto ya está registrado en esta vuelta',
        };
  }
  return response.outOfWindow
    ? {
        status: 'out_of_window',
        recordId: response.recordId,
        checkpointId,
        checkpointName,
        message: `${checkpointName} registrado fuera de ventana`,
      }
    : {
        status: 'counted',
        recordId: response.recordId,
        checkpointId,
        checkpointName,
        countedFor: response.countedFor,
        message: `${checkpointName} registrado`,
      };
}
