import {
  monotonicClockSchema,
  timeReferenceSchema,
  deviceClockSchema,
  serverTimeResponseSchema,
  trustedTimeFor,
  recalculateBoot,
  type DeviceClock,
  type TimeReference,
  type PendingFieldEvent,
} from '@garita/shared';
import GaritaNative from '../../../modules/garita-native/src';
import { apiRequest } from '@/lib/api-client';
import type { FieldRepository } from '@/lib/db/database';

export async function readClock(
  repository: FieldRepository,
  deviceTime: string,
): Promise<DeviceClock> {
  const reading = monotonicClockSchema.parse(await GaritaNative.getMonotonicClock());
  const stored = await repository.getSyncMeta('time_reference');
  const reference = stored ? timeReferenceSchema.parse(JSON.parse(stored) as unknown) : null;
  return trustedTimeFor({ ...reading, deviceTime }, reference);
}

export async function saveTimeReference(
  repository: FieldRepository,
  serverTime: string,
): Promise<TimeReference> {
  const reading = monotonicClockSchema.parse(await GaritaNative.getMonotonicClock());
  const reference = timeReferenceSchema.parse({
    ...reading,
    serverTime,
    offsetMs: Date.now() - Date.parse(serverTime),
  });
  await repository.setSyncMeta(`time_reference:${reference.bootId}`, JSON.stringify(reference));
  await repository.setSyncMeta('time_reference', JSON.stringify(reference));
  return reference;
}

/** Persist the resolved payload before transport so retries keep the same idempotency hash. */
export async function prepareEventClocks(
  repository: FieldRepository,
  events: PendingFieldEvent[],
): Promise<PendingFieldEvent[]> {
  let currentReference: TimeReference | null | undefined;
  const prepared: PendingFieldEvent[] = [];
  for (const event of events) {
    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null || !('clock' in payload)) {
      prepared.push(event);
      continue;
    }
    const clock = deviceClockSchema.parse(payload.clock);
    if (clock.timeStatus !== 'pending') {
      prepared.push(event);
      continue;
    }
    const stored = await repository.getSyncMeta(`time_reference:${clock.bootId}`);
    let reference = stored ? timeReferenceSchema.parse(JSON.parse(stored) as unknown) : undefined;
    if (!reference) {
      if (currentReference === undefined) {
        // This endpoint is public and must work even when Firebase can no longer renew a token.
        try {
          const response = await apiRequest('GET', '/hora', serverTimeResponseSchema, undefined, {
            headers: { Authorization: '' },
          });
          currentReference = await saveTimeReference(repository, response.serverTime);
        } catch {
          currentReference = null;
        }
      }
      if (!currentReference) continue;
      reference = currentReference;
    }
    const [resolved] = recalculateBoot([clock], reference);
    const updated = { ...event, payload: { ...payload, clock: resolved } };
    await repository.updatePendingEventPayload(event.id, updated.payload);
    prepared.push(updated);
  }
  return prepared;
}
