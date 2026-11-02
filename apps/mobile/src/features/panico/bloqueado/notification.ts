import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';
import { PANIC_SMS_FALLBACK_SECONDS } from '@garita/shared';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { triggerPanic } from '../actions';
import { getRunningPanicShift } from '../running-shift';
import { panicGesture } from './gesture';

export const NOTIFICATION_ID = 'garita-panic-running-shift';
const CHANNEL_ID = 'panico-bloqueado';
const STATE_KEY = 'garita:locked-panic';
const stateSchema = z.object({
  shiftId: z.string(),
  armedUntil: z.number().finite().nonnegative(),
});
const responseSchema = z.object({
  actionIdentifier: z.enum(['panic', 'confirm']),
  notification: z.object({
    date: z.number().finite().optional(),
    request: z.object({ identifier: z.literal(NOTIFICATION_ID) }),
  }),
});
const handledResponses = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work);
  pending = next.catch(() => undefined);
  return next;
}

async function readState() {
  const raw = await AsyncStorage.getItem(STATE_KEY);
  try {
    const parsed = stateSchema.safeParse(raw ? (JSON.parse(raw) as unknown) : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function dismiss() {
  clearTimeout(timer);
  await AsyncStorage.removeItem(STATE_KEY);
  await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
}

async function publish(armedUntil: number) {
  const armed = armedUntil > Date.now();
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Pánico con el celular bloqueado',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationCategoryAsync(armed ? 'panic-confirm' : 'panic-ready', [
    {
      identifier: armed ? 'confirm' : 'panic',
      buttonTitle: armed ? 'Confirmar pánico' : 'Pánico',
      options: { opensAppToForeground: false, isAuthenticationRequired: false },
    },
  ]);
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'Turno en curso',
      categoryIdentifier: armed ? 'panic-confirm' : 'panic-ready',
      sticky: true,
      autoDismiss: false,
      sound: false,
      priority: Notifications.AndroidNotificationPriority.LOW,
    },
    trigger: { channelId: CHANNEL_ID },
  });
  clearTimeout(timer);
  if (armed) {
    // shortcut: Android may kill JS timers; every later tap also validates the persisted deadline.
    timer = setTimeout(
      () => {
        void reconcilePanicNotification().catch(recordLockedPanicFailure);
      },
      Math.max(0, armedUntil - Date.now()),
    );
  }
}

export async function recordLockedPanicFailure(): Promise<void> {
  try {
    const repository = await createDefaultFieldRepository();
    await repository.setSyncMeta(
      'locked_panic_error',
      'No se pudo actualizar el acceso al pánico bloqueado',
    );
  } catch {
    // Storage failure must not interrupt shift closing or sign-out.
  }
}

// TODO(HU-22-iOS): connect the HU-36 Live Activity extension, App Group and shift token.
export function reconcilePanicNotification(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return serialize(reconcile);
}

async function reconcile(): Promise<void> {
  const shift = await getRunningPanicShift(await createDefaultFieldRepository());
  const state = await readState();
  if (!shift || !(await Notifications.getPermissionsAsync()).granted) return dismiss();
  const armedUntil = state?.shiftId === shift.shift.id ? state.armedUntil : 0;
  const next = panicGesture('timeout', Date.now(), armedUntil);
  await AsyncStorage.setItem(
    STATE_KEY,
    JSON.stringify({ shiftId: shift.shift.id, armedUntil: next.armedUntil }),
  );
  const visible = await Notifications.getPresentedNotificationsAsync();
  const existing = visible.find((item) => item.request.identifier === NOTIFICATION_ID);
  const category = next.armedUntil ? 'panic-confirm' : 'panic-ready';
  if (!existing || existing.request.content.categoryIdentifier !== category || next.armedUntil)
    await publish(next.armedUntil);
}

export function expireLockedPanicArm(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return serialize(async () => {
    const state = await readState();
    if (state && state.armedUntil > 0 && state.armedUntil <= Date.now()) await reconcile();
  });
}

export function dismissPanicNotification(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return serialize(dismiss);
}

export function subscribeLockedPanicResponses(): () => void {
  if (Platform.OS !== 'android') return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    if (!responseSchema.safeParse(response).success) return;
    void handleLockedPanicResponse(response).catch(recordLockedPanicFailure);
  });
  return () => subscription.remove();
}

export function handleLockedPanicResponse(input: unknown): Promise<number> {
  if (Platform.OS !== 'android') return Promise.resolve(0);
  const response = responseSchema.safeParse(input);
  if (!response.success) return Promise.resolve(0);
  const responseKey =
    response.data.notification.date === undefined
      ? null
      : `${response.data.actionIdentifier}:${response.data.notification.date}`;
  return serialize(async () => {
    if (responseKey && handledResponses.has(responseKey)) {
      // A background copy still needs to keep the transport alive if the foreground listener won.
      return Math.max(0, (handledResponses.get(responseKey) ?? 0) - Date.now());
    }
    const state = await readState();
    const shift = await getRunningPanicShift(await createDefaultFieldRepository());
    if (!shift || !state || state.shiftId !== shift.shift.id) {
      await dismiss();
      return 0;
    }
    const next = panicGesture(response.data.actionIdentifier, Date.now(), state.armedUntil);
    await AsyncStorage.setItem(
      STATE_KEY,
      JSON.stringify({ shiftId: shift.shift.id, armedUntil: next.armedUntil }),
    );
    if (responseKey) {
      handledResponses.set(
        responseKey,
        next.fire ? Date.now() + (PANIC_SMS_FALLBACK_SECONDS + 2) * 1000 : next.armedUntil,
      );
      // Bound the history while deduplicating native responses shared by listener and background task.
      if (handledResponses.size > 32) {
        const oldest = handledResponses.keys().next().value;
        if (oldest) handledResponses.delete(oldest);
      }
    }
    if (next.fire) {
      try {
        // Persists and dispatches through HU-21; its transport never blocks this on network acknowledgement.
        await triggerPanic();
      } catch {
        await recordLockedPanicFailure();
      }
    }
    if (!(await getRunningPanicShift(await createDefaultFieldRepository()))) {
      await dismiss();
      return 0;
    }
    await publish(next.armedUntil);
    // Keep TaskManager's headless context alive for the 8 s fallback plus the SMS dispatch budget.
    return next.fire
      ? (PANIC_SMS_FALLBACK_SECONDS + 2) * 1000
      : Math.max(0, next.armedUntil - Date.now());
  });
}
