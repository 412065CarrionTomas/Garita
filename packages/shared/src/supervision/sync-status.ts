export type SyncStatus =
  | { status: 'al_dia' }
  | { status: 'sincronizando'; pendingCount: number }
  | { status: 'sin_contacto'; since: Date; pendingCount: number }
  | { status: 'esperando_hasta'; deadline: Date }
  | { status: 'sin_sincronizar' }
  | { status: 'completo' }
  | { status: 'cerrado_sin_datos' };

export interface SyncStatusInput {
  now: Date;
  lastContactAt: Date | null;
  pendingCount: number;
  syncedUntil: Date | null;
  scheduledEndAt: Date;
  syncDeadlineAt: Date | null;
  withoutSignal: boolean;
  closed: boolean;
  closedWithoutData?: boolean;
}

const CONTACT_WINDOW_MS = 5 * 60 * 1000;

export function computeSyncStatus(input: SyncStatusInput): SyncStatus {
  if (input.closedWithoutData) return { status: 'cerrado_sin_datos' };
  if (input.closed) return { status: 'completo' };
  if (
    input.syncDeadlineAt &&
    input.now >= input.syncDeadlineAt &&
    (!input.syncedUntil || input.syncedUntil < input.scheduledEndAt)
  ) {
    return { status: 'sin_sincronizar' };
  }

  const inContact =
    input.lastContactAt !== null &&
    input.now.getTime() - input.lastContactAt.getTime() < CONTACT_WINDOW_MS;
  if (inContact) {
    return input.pendingCount > 0
      ? { status: 'sincronizando', pendingCount: input.pendingCount }
      : { status: 'al_dia' };
  }

  if (input.withoutSignal && input.syncDeadlineAt && input.now < input.syncDeadlineAt) {
    return { status: 'esperando_hasta', deadline: input.syncDeadlineAt };
  }
  return input.lastContactAt
    ? {
        status: 'sin_contacto',
        since: input.lastContactAt,
        pendingCount: input.pendingCount,
      }
    : { status: 'sin_sincronizar' };
}
