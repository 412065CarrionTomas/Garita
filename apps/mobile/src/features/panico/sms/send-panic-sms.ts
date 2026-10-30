import { Platform } from 'react-native';
import * as SMS from 'expo-sms';
import { z } from 'zod';
import { buildPanicSms } from '@garita/shared';
import GaritaNative from '../../../../modules/garita-native/src';
import {
  createDefaultFieldRepository,
  type LocalPanicAlert,
  type FieldRepository,
} from '@/lib/db/database';

const capabilitySchema = z.object({ canSendInBackground: z.boolean() });
const dispatchSchema = z.object({ id: z.string().min(1) });
const statusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'failed']),
});
const composerSchema = z.object({ result: z.enum(['sent', 'cancelled', 'unknown']) });
const claims = new Map<string, Promise<boolean>>();

// Only alerts after the latest resolved alert share the same SMS attempt.
function currentAlerts(alerts: LocalPanicAlert[], shiftId: string): LocalPanicAlert[] {
  const sameShift = alerts.filter(
    (alert) => alert.request.shiftId === shiftId && !alert.blockedReason,
  );
  const resolved = sameShift.findIndex((alert) => alert.state?.status === 'resolved');
  return resolved < 0 ? sameShift : sameShift.slice(0, resolved);
}

async function claim(repository: FieldRepository, alert: LocalPanicAlert): Promise<boolean> {
  const shiftId = alert.request.shiftId;
  const previous = claims.get(shiftId) ?? Promise.resolve(false);
  const pending = previous
    .catch(() => false)
    .then(async () => {
      const alerts = currentAlerts(await repository.listPanicAlerts(), shiftId);
      const current = alerts.find((item) => item.request.alertId === alert.request.alertId);
      if (!current || current.state || current.smsAttempted || current.smsState !== 'pending')
        return false;
      const prior = alerts.find((item) => item.smsAttempted || item.smsState !== 'pending');
      await repository.patchPanicAlert(alert.request.alertId, {
        smsAttempted: true,
        ...(prior ? { smsState: prior.smsState } : {}),
      });
      return !prior;
    });
  claims.set(shiftId, pending);
  try {
    return await pending;
  } finally {
    if (claims.get(shiftId) === pending) claims.delete(shiftId);
  }
}

export async function sendPanicSms(alert: LocalPanicAlert): Promise<void> {
  const repository = await createDefaultFieldRepository();
  if (!(await claim(repository, alert))) return;
  const update = async (smsState: LocalPanicAlert['smsState']) => {
    for (const item of currentAlerts(await repository.listPanicAlerts(), alert.request.shiftId)) {
      if (!item.smsAttempted) continue;
      // Delivery is stronger evidence than an out-of-order sent callback.
      if (item.smsState === 'delivered' && smsState === 'sent') continue;
      await repository.patchPanicAlert(item.request.alertId, { smsState });
    }
  };
  let subscription: { remove(): void } | undefined;
  try {
    const data = await repository.getShiftData();
    const config = data?.shift.panicSms;
    if (!data || data.shift.id !== alert.request.shiftId || !config?.destination) {
      await update('failed');
      return;
    }
    const latest =
      (await repository.listPanicAlerts()).find(
        (item) => item.request.alertId === alert.request.alertId,
      ) ?? alert;
    const location =
      latest.betterLocation?.status === 'ok' &&
      latest.betterLocation.latitude !== null &&
      latest.betterLocation.longitude !== null
        ? latest.betterLocation
        : latest.request.location;
    const message = buildPanicSms({
      alertId: alert.request.alertId,
      shiftCode: config.shiftCode,
      time: new Date(
        alert.request.clock?.trustedAt ?? alert.request.occurredAtDevice,
      ).toLocaleTimeString('en-GB', {
        timeZone: data.shift.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
      latitude: location.latitude,
      longitude: location.longitude,
      ...(config.backup ? { backup: { siteName: data.shift.siteName } } : {}),
    });
    const capability =
      Platform.OS === 'android'
        ? capabilitySchema.parse(
            await GaritaNative.getSmsCapability().catch(() => ({ canSendInBackground: false })),
          )
        : { canSendInBackground: false };
    if (capability.canSendInBackground) {
      let nativeId: string | undefined;
      const early: z.infer<typeof statusSchema>[] = [];
      let writes = Promise.resolve();
      const receive = (event: z.infer<typeof statusSchema>) => {
        if (!nativeId) {
          early.push(event);
          return;
        }
        if (event.id !== nativeId) return;
        writes = writes.then(() => update(event.status)).catch(() => undefined);
        if (event.status === 'delivered' || event.status === 'failed') subscription?.remove();
      };
      subscription = GaritaNative.addListener('onSmsStatus', (input) => {
        const parsed = statusSchema.safeParse(input);
        if (parsed.success) receive(parsed.data);
      });
      nativeId = dispatchSchema.parse(
        await GaritaNative.sendSms({ destination: config.destination, message }),
      ).id;
      for (const event of early) receive(event);
      return;
    }
    if (!(await SMS.isAvailableAsync())) {
      await update('failed');
      return;
    }
    const result = composerSchema.parse(await SMS.sendSMSAsync([config.destination], message));
    await update(result.result === 'cancelled' ? 'failed' : 'prepared');
  } catch {
    subscription?.remove();
    await update('failed');
  }
}
