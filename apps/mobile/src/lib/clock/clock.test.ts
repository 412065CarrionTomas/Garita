import { trustedTimeFor, type PendingFieldEvent } from '@garita/shared';
import GaritaNative from '../../../modules/garita-native/src';
import { apiRequest } from '@/lib/api-client';
import type { FieldRepository } from '@/lib/db/database';
import { prepareEventClocks, readClock, saveTimeReference } from './clock';

jest.mock('@/lib/api-client', () => ({ apiRequest: jest.fn() }));
const reference = {
  serverTime: '2026-10-19T01:00:00.000Z',
  elapsedMs: 1000,
  bootId: 'a',
  offsetMs: 0,
};
function repository() {
  const meta = new Map<string, string>();
  const updates: unknown[] = [];
  const repo = {
    getSyncMeta: async (key: string) => meta.get(key) ?? null,
    setSyncMeta: async (key: string, value: string) => {
      meta.set(key, value);
    },
    updatePendingEventPayload: async (_id: string, payload: unknown) => {
      updates.push(payload);
    },
  } as FieldRepository;
  return { repo, meta, updates };
}
function pending(bootId: string): PendingFieldEvent {
  return {
    id: 'event',
    type: 'shift_close',
    occurredAtDevice: reference.serverTime,
    createdAt: reference.serverTime,
    payload: {
      clock: trustedTimeFor({ deviceTime: reference.serverTime, elapsedMs: 0, bootId }, reference),
    },
  };
}
describe('HU-14 persistent clock lifecycle', () => {
  beforeEach(() => {
    jest.mocked(GaritaNative.getMonotonicClock).mockResolvedValue({ elapsedMs: 1000, bootId: 'b' });
    jest.mocked(apiRequest).mockResolvedValue({ serverTime: '2026-10-19T01:00:01.000Z' });
    jest.clearAllMocks();
  });
  it('persists reference and uses native time despite a changed device time (CA1)', async () => {
    const { repo } = repository();
    await saveTimeReference(repo, reference.serverTime);
    const clock = await readClock(repo, '2026-10-19T04:00:00.000Z');
    expect(clock.trustedAt).toBe(reference.serverTime);
    expect(clock.deviceTime).toBe('2026-10-19T04:00:00.000Z');
  });
  it('fetches server time before upload, persists recalculation, preserves baseline and leaves retries stable (CA3, CA5)', async () => {
    const { repo, updates } = repository();
    const result = await prepareEventClocks(repo, [pending('b')]);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      expect.objectContaining({
        clock: expect.objectContaining({
          timeStatus: 'recalculated',
          trustedAt: reference.serverTime,
          referenceOffsetMs: 0,
        }),
      }),
    ]);
    await prepareEventClocks(repo, result);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
  });
  it('does not lose an old boot that already acquired a persisted reference (CA6)', async () => {
    const { repo, meta, updates } = repository();
    meta.set('time_reference:b', JSON.stringify({ ...reference, bootId: 'b' }));
    await prepareEventClocks(repo, [pending('b')]);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(updates).toEqual([
      expect.objectContaining({ clock: expect.objectContaining({ timeStatus: 'recalculated' }) }),
    ]);
  });
  it('marks only the abandoned boot unverifiable after two reboots (CA6 / BDD5)', async () => {
    const { repo, updates } = repository();
    await prepareEventClocks(repo, [pending('lost'), pending('b')]);
    expect(updates).toEqual([
      expect.objectContaining({
        clock: expect.objectContaining({ timeStatus: 'unverifiable', trustedAt: null }),
      }),
      expect.objectContaining({ clock: expect.objectContaining({ timeStatus: 'recalculated' }) }),
    ]);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
  it('fails without uploading or mutating pending data when time cannot be fetched', async () => {
    const { repo, updates } = repository();
    jest.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
    const legacy = { ...pending('a'), payload: {} };
    await expect(prepareEventClocks(repo, [pending('b'), legacy])).resolves.toEqual([legacy]);
    expect(updates).toEqual([]);
  });
  it('allows old events without clock unchanged', async () => {
    const { repo } = repository();
    const event = { ...pending('b'), payload: {} };
    expect(await prepareEventClocks(repo, [event])).toEqual([event]);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
