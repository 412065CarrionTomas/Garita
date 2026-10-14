import {
  fieldLocationSchema,
  isEarlyClose,
  isWithinStartMargin,
  SHIFT_EXECUTION_ERROR_CODES,
  type FieldLocation,
  type ShiftCredential,
  type ShiftOfflineData,
} from '@garita/shared';
import * as Network from 'expo-network';
import { checkFieldPermissions, type FieldPermissionState } from '@/features/permisos/permissions';
import { ApiError } from '@/lib/api-client';
import { deleteShiftCredential, processSyncQueue, saveShiftCredential } from '@/lib/cola';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { getCurrentLocation } from '@/lib/location';
import { closeShift, ShiftExecutionApiError, startShift } from './api';

export type ShiftActionResult =
  | { status: 'started'; data: ShiftOfflineData; late: boolean }
  | { status: 'closed' }
  | { status: 'closed_pending' }
  | { status: 'permissions'; permission: FieldPermissionState }
  | { status: 'error'; message: string };

interface ShiftActionsDependencies {
  now(): Date;
  online(): Promise<boolean>;
  permissions(): Promise<FieldPermissionState>;
  location(): Promise<FieldLocation>;
  uuid(): string;
  start(id: string, body: Parameters<typeof startShift>[1]): ReturnType<typeof startShift>;
  close?(id: string, body: Parameters<typeof closeShift>[1]): ReturnType<typeof closeShift>;
  repository(): ReturnType<typeof createDefaultFieldRepository>;
  redirectToPermissions(): void;
  saveCredential(credential: ShiftCredential): Promise<void>;
  deleteCredential?(): Promise<void>;
  triggerSync(): Promise<unknown>;
}

function uuid(): string {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.randomUUID) return cryptoProvider.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

async function readLocation(): Promise<FieldLocation> {
  const permission = await checkFieldPermissions();
  if (permission !== 'ok')
    return fieldLocationSchema.parse({
      status: 'disabled',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      simulation: 'unavailable',
      takenAt: null,
    });
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
  } catch {
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

const dependencies: ShiftActionsDependencies = {
  now: () => new Date(),
  online: async () => {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },
  permissions: checkFieldPermissions,
  location: readLocation,
  uuid,
  start: startShift,
  close: closeShift,
  repository: createDefaultFieldRepository,
  redirectToPermissions: () => undefined,
  saveCredential: saveShiftCredential,
  deleteCredential: deleteShiftCredential,
  triggerSync: processSyncQueue,
};

let overrides: Partial<ShiftActionsDependencies> = {};
export function setShiftActionsForTesting(next: Partial<ShiftActionsDependencies>): void {
  overrides = next;
}
function deps(): ShiftActionsDependencies {
  return { ...dependencies, ...overrides };
}
export function resetShiftActionsForTesting(): void {
  overrides = {};
}

export async function beginShift(
  id: string,
  scheduledStart: string,
  scheduledEnd: string,
): Promise<ShiftActionResult> {
  const d = deps();
  if (!(await d.online()))
    return { status: 'error', message: 'Necesitás conexión para iniciar el turno' };
  const permission = await d.permissions();
  if (permission !== 'ok') {
    d.redirectToPermissions();
    return { status: 'permissions', permission };
  }
  const now = d.now();
  if (!isWithinStartMargin(scheduledStart, scheduledEnd, now.toISOString()))
    return {
      status: 'error',
      message: 'Todavía no podés iniciar este turno o el turno ya terminó',
    };
  const result = await d
    .start(id, {
      eventId: d.uuid(),
      occurredAtDevice: now.toISOString(),
      location: await d.location(),
    })
    .catch((error: unknown) => {
      if (error instanceof ShiftExecutionApiError) {
        const messages: Record<string, string> = {
          [SHIFT_EXECUTION_ERROR_CODES.reassigned]:
            'Tu turno fue reasignado. Consultá a tu supervisor',
          [SHIFT_EXECUTION_ERROR_CODES.outsideStartMargin]:
            'Todavía no podés iniciar este turno o el turno ya terminó',
          [SHIFT_EXECUTION_ERROR_CODES.anotherInProgress]: 'Ya tenés otro turno en curso',
          [SHIFT_EXECUTION_ERROR_CODES.invitationPending]:
            'Tu invitación está pendiente. Consultá a tu supervisor',
          [SHIFT_EXECUTION_ERROR_CODES.notStartable]: 'Este turno ya no se puede iniciar',
        };
        return { status: 'error' as const, message: messages[error.code ?? ''] ?? error.message };
      }
      if (!(error instanceof ApiError) || error.status === undefined)
        return { status: 'error' as const, message: 'Necesitás conexión para iniciar el turno' };
      return {
        status: 'error' as const,
        message: 'No pudimos iniciar el turno. Volvé a intentar.',
      };
    });
  if (result.status === 'error') return result;
  if ('credential' in result && result.credential) {
    await d.saveCredential(result.credential);
  }
  await d.repository().then((repository) => repository.saveShiftData(result.data));
  return { status: 'started', data: result.data, late: result.lateStartMinutes !== null };
}

export async function finishShift(
  data: ShiftOfflineData,
  reason: string,
): Promise<ShiftActionResult> {
  const d = deps();
  const now = d.now();
  const early = isEarlyClose(data.shift.endsAt, now.toISOString());
  const trimmedReason = reason.trim();
  if (early && trimmedReason.length < 3)
    return { status: 'error', message: 'Indicá un motivo de al menos 3 caracteres' };
  const eventId = d.uuid();
  const location = await d.location();
  const occurredAtDevice = now.toISOString();
  const repository = await d.repository();
  await repository.addPendingEvent({
    id: eventId,
    type: 'shift_close',
    payload: {
      shiftId: data.shift.id,
      eventId,
      occurredAtDevice,
      location,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    },
    occurredAtDevice,
    createdAt: new Date().toISOString(),
  });
  if (!(await d.online())) return { status: 'closed_pending' };
  try {
    await d.triggerSync();
  } catch {
    return { status: 'closed_pending' };
  }
  const isConfirmed = await repository.isPendingEventConfirmed(eventId);
  return isConfirmed ? { status: 'closed' } : { status: 'closed_pending' };
}
