import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { fieldLocationSchema, type FieldLocation } from '@garita/shared';
import { sendUrgentEvent } from '@/lib/cola/sync-service';
import { readClock } from '@/lib/clock/clock';
import { createDefaultFieldRepository, type LocalPanicAlert } from '@/lib/db/database';
import { getCurrentLocation } from '@/lib/location';
import { sendBetterLocation } from './transport';

export interface PanicActionDependencies {
  now(): Date;
  uuid(): string;
  lastLocation(): Promise<FieldLocation>;
  betterLocation(): Promise<FieldLocation>;
  vibrate(): Promise<void>;
  send(alert: LocalPanicAlert): Promise<void>;
}

const unavailableLocation = fieldLocationSchema.parse({
  status: 'unverifiable',
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  simulation: 'unavailable',
  takenAt: null,
});
const defaults: PanicActionDependencies = {
  now: () => new Date(),
  uuid: () =>
    globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    }),
  lastLocation: async () => {
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (!last) return unavailableLocation;
      return fieldLocationSchema.parse({
        status: 'ok',
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
        accuracyMeters: last.coords.accuracy,
        simulation: 'unavailable',
        takenAt: new Date(last.timestamp).toISOString(),
      });
    } catch {
      return unavailableLocation;
    }
  },
  betterLocation: async () => {
    try {
      const current = await getCurrentLocation({ timeoutMs: 5000 });
      return fieldLocationSchema.parse({
        status: 'ok',
        latitude: current.latitude,
        longitude: current.longitude,
        accuracyMeters: current.accuracyMeters,
        simulation: current.simulation,
        takenAt: current.timestamp,
      });
    } catch {
      return unavailableLocation;
    }
  },
  vibrate: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  send: sendUrgentEvent,
};
let overrides: Partial<PanicActionDependencies> = {};
export function setPanicActionsForTesting(next: Partial<PanicActionDependencies>): void {
  overrides = next;
}
export function resetPanicActionsForTesting(): void {
  overrides = {};
}

/** Single trigger used by the on-screen button and HU-22's future lock-screen action. */
export async function triggerPanic(): Promise<LocalPanicAlert> {
  const deps = { ...defaults, ...overrides };
  const repository = await createDefaultFieldRepository();
  const shift = await repository.getShiftData();
  if (!shift || (await repository.getSyncMeta('shift_closed_done')) === 'true')
    throw new Error('Necesitás un turno en curso para activar el pánico');
  const now = deps.now().toISOString();
  const alert = await repository.savePanicAlert({
    request: {
      alertId: deps.uuid(),
      shiftId: shift.shift.id,
      occurredAtDevice: now,
      clock: await readClock(repository, now),
      location: await deps.lastLocation(),
    },
    state: null,
    smsState: 'pending',
    attempts: 0,
  });
  void deps.vibrate().catch(() => undefined);
  void deps.send(alert).catch(() => undefined);
  void deps
    .betterLocation()
    .then(async (location) => {
      const saved = (await repository.listPanicAlerts()).find(
        (item) => item.request.alertId === alert.request.alertId,
      );
      if (!saved) return;
      await repository.updatePanicAlert({ ...saved, betterLocation: location });
      if (saved.state) await sendBetterLocation(saved, location);
    })
    .catch(() => undefined);
  return alert;
}
