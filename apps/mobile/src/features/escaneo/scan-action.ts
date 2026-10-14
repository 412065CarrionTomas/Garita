import {
  fieldLocationSchema,
  formatTooSoonMessage,
  imputeRecord,
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
  type FieldRepository,
  type LocalCheckpointRecord,
} from '@/lib/db/database';
import { getCurrentLocation, LocationError } from '@/lib/location';
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
  location(): Promise<FieldLocation>;
  nfc(): Promise<PhoneNfcState>;
  uuid(): string;
  send(body: CheckpointRecordRequest): Promise<CheckpointRecordResponse>;
  repository(): Promise<FieldRepository>;
  feedback(): Promise<void>;
}

function generateUuid(): string {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.randomUUID) return cryptoProvider.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

async function readLocation(): Promise<FieldLocation> {
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
    const location = await getCurrentLocation({ timeoutMs: 5000 });
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
): Promise<ScanActionResult> {
  const d = deps();
  const now = d.now();
  const parsed = parseAndValidateQr(scannedValue, shiftData.checkpoints);

  if (!parsed.valid) {
    const recordId = d.uuid();
    const location = await d.location();
    const phoneNfc = await d.nfc();
    const occurredAtDevice = now.toISOString();

    const requestPayload: CheckpointRecordRequest = {
      recordId,
      shiftId: shiftData.shift.id,
      method: 'qr',
      scannedValue,
      occurredAtDevice,
      location,
      phoneNfc,
    };

    const repository = await d.repository();
    await repository.addPendingEvent({
      id: recordId,
      type: 'invalid_scan_attempt',
      payload: requestPayload,
      occurredAtDevice,
      createdAt: now.toISOString(),
    });

    if (await d.online()) {
      try {
        await d.send(requestPayload);
        await repository.markPendingEventSent(recordId);
      } catch {
        // Keeps event pending for sync
      }
    }

    return {
      status: 'invalid_attempt',
      reason: parsed.reason,
      message: parsed.message,
      recordId,
    };
  }

  const { checkpoint } = parsed;
  const repository = await d.repository();
  const localRecords = await repository.listCheckpointRecords(shiftData.shift.id);
  const validPreviousRecords = localRecords.filter((r) => r.serverResult !== 'rejected');

  const imputation = imputeRecord({
    rounds: shiftData.rounds,
    windows: shiftData.windows,
    checkpointId: checkpoint.id,
    occurredAtUtc: now.toISOString(),
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
  await d.feedback();

  const recordId = d.uuid();
  const location = await d.location();
  const phoneNfc = await d.nfc();
  const occurredAtDevice = now.toISOString();

  const localRecord: LocalCheckpointRecord = {
    recordId,
    shiftId: shiftData.shift.id,
    checkpointId: checkpoint.id,
    checkpointName: checkpoint.name,
    occurredAtUtc: occurredAtDevice,
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
    method: 'qr',
    scannedValue,
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

  if (await d.online()) {
    try {
      const response = await d.send(requestPayload);
      await repository.markPendingEventSent(recordId);
      if (response.result === 'recorded') {
        await repository.updateCheckpointRecordServerResult(recordId, 'recorded');
      } else if (response.result === 'rejected') {
        await repository.updateCheckpointRecordServerResult(recordId, 'rejected', response.reason);
      }
    } catch {
      // Keeps event pending for sync
    }
  }

  return isCounted
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
}
