import * as Network from 'expo-network';
import {
  PANIC_SMS_FALLBACK_SECONDS,
  panicAlertStateResponseSchema,
  type PanicAlertStateResponse,
} from '@garita/shared';
import { apiRequest } from '@/lib/api-client';
import { computeSyncBackoff } from '@/lib/cola/backoff';
import { getShiftCredentialToken } from '@/lib/cola/credential';
import { createDefaultFieldRepository, type LocalPanicAlert } from '@/lib/db/database';
import { blockPanicAfterClose, isPanicAfterLocalClose } from './running-shift';

export interface PanicTransportDependencies {
  online(): Promise<boolean>;
  send(alert: LocalPanicAlert, token: string): Promise<PanicAlertStateResponse>;
  sms(alert: LocalPanicAlert): Promise<void>;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const defaultTransport: PanicTransportDependencies = {
  online: async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      return state.isConnected === true && state.isInternetReachable !== false;
    } catch {
      return false;
    }
  },
  send: (alert, token) =>
    apiRequest('POST', '/alertas-panico', panicAlertStateResponseSchema, alert.request, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  // TODO(HU-23): replace this channel with platform SMS; keep the unavailable state locally.
  sms: async () => undefined,
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};
let transportOverrides: Partial<PanicTransportDependencies> = {};
const sending = new Map<string, Promise<void>>();
const retries = new Map<string, ReturnType<typeof setTimeout>>();
export function setPanicTransportForTesting(next: Partial<PanicTransportDependencies>): void {
  transportOverrides = next;
}
export function resetPanicTransportForTesting(): void {
  transportOverrides = {};
  sending.clear();
  for (const timer of retries.values()) clearTimeout(timer);
  retries.clear();
}
function transport(): PanicTransportDependencies {
  return { ...defaultTransport, ...transportOverrides };
}

async function unavailableSms(alert: LocalPanicAlert): Promise<void> {
  const deps = transport();
  await deps.sms(alert);
  const repository = await createDefaultFieldRepository();
  await repository.patchPanicAlert(alert.request.alertId, { smsState: 'unavailable' });
}

export function dispatchPanicAlert(alert: LocalPanicAlert): Promise<void> {
  const id = alert.request.alertId;
  const running = sending.get(id);
  if (running) return running;
  if (alert.state || alert.blockedReason) return Promise.resolve();
  const pending = sendPanicAlert(alert).finally(() => {
    sending.delete(id);
  });
  sending.set(id, pending);
  return pending;
}

async function sendPanicAlert(alert: LocalPanicAlert): Promise<void> {
  const id = alert.request.alertId;
  const repository = await createDefaultFieldRepository();
  if (await isPanicAfterLocalClose(repository, alert)) {
    await blockPanicAfterClose(repository, alert);
    return;
  }
  const deps = transport();
  let confirmed = false;
  let smsStarted = false;
  const fallback = async () => {
    if (confirmed || smsStarted || alert.smsState === 'unavailable') return;
    smsStarted = true;
    await unavailableSms(alert);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      (async () => {
        if (!(await deps.online())) throw new Error('Sin conexión');
        const token = await getShiftCredentialToken();
        if (!token) throw new Error('Credencial de turno no disponible');
        return deps.send(alert, token);
      })(),
      new Promise<never>((_, reject) => {
        timer = deps.setTimeout(
          () => reject(new Error('Sin confirmación')),
          PANIC_SMS_FALLBACK_SECONDS * 1000,
        );
      }),
    ]);
    confirmed = true;
    const saved = await repository.patchPanicAlert(id, { state });
    if (saved?.betterLocation)
      void sendBetterLocation({ ...saved, state }, saved.betterLocation).catch(() => undefined);
    const retry = retries.get(id);
    if (retry) deps.clearTimeout(retry);
    retries.delete(id);
  } catch {
    await fallback().catch(() => undefined);
  } finally {
    if (timer !== undefined) deps.clearTimeout(timer);
    if (!confirmed && !retries.has(id)) {
      const current = (await repository.listPanicAlerts()).find(
        (item) => item.request.alertId === id,
      );
      const attempts = (current?.attempts ?? alert.attempts) + 1;
      await repository.patchPanicAlert(id, { attempts });
      retries.set(
        id,
        deps.setTimeout(
          () => {
            retries.delete(id);
            void resumePanicAlerts().catch(() => undefined);
          },
          computeSyncBackoff(attempts - 1) * 1000,
        ),
      );
    }
  }
}

export async function resumePanicAlerts(): Promise<void> {
  const repository = await createDefaultFieldRepository();
  for (const alert of await repository.listPanicAlerts())
    if (!alert.state && !alert.blockedReason) void dispatchPanicAlert(alert).catch(() => undefined);
}

export async function fetchPanicState(alertId: string): Promise<PanicAlertStateResponse> {
  const token = await getShiftCredentialToken();
  if (!token) throw new Error('Credencial de turno no disponible');
  return apiRequest(
    'GET',
    `/alertas-panico/${alertId}/estado`,
    panicAlertStateResponseSchema,
    undefined,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function sendBetterLocation(
  alert: LocalPanicAlert,
  location: LocalPanicAlert['request']['location'],
): Promise<void> {
  if (
    location.status !== 'ok' ||
    location.latitude === null ||
    location.longitude === null ||
    location.accuracyMeters === null ||
    (alert.request.location.accuracyMeters !== null &&
      location.accuracyMeters >= alert.request.location.accuracyMeters)
  )
    return;
  const token = await getShiftCredentialToken();
  if (!token) return;
  const state = alert.state;
  if (!state) return;
  await apiRequest(
    'PATCH',
    `/alertas-panico/${state.alertId}/ubicacion`,
    panicAlertStateResponseSchema,
    { location },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}
