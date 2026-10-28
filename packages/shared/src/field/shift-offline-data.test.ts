import { pendingFieldEventSchema, shiftOfflineDataSchema } from './shift-offline-data';

const valid = {
  shift: {
    id: 'shift-1',
    siteId: 'site-1',
    siteName: 'Predio Norte',
    startsAt: '2026-10-13T10:00:00.000Z',
    endsAt: '2026-10-13T18:00:00.000Z',
    timezone: 'America/Argentina/Buenos_Aires',
    assignmentId: 'assignment-1',
  },
  rounds: [
    {
      roundId: 'round-1',
      roundVersionId: 'version-1',
      name: 'Principal',
      frequencyMinutes: 30,
      windowStartLocal: '10:00',
      windowEndLocal: '18:00',
      graceMinutes: 5,
      checkpointIds: ['cp-1'],
    },
  ],
  windows: [
    {
      roundId: 'round-1',
      index: 0,
      startUtc: '2026-10-13T10:00:00.000Z',
      endUtc: '2026-10-13T10:30:00.000Z',
      label: '10:00–10:30',
    },
  ],
  checkpoints: [{ id: 'cp-1', name: 'Portón', qrVersion: 1, nfcUid: null, isIndoor: false }],
  serverTime: { serverNowUtc: '2026-10-13T10:00:00.000Z' },
};
describe('offline field contracts', () => {
  it('accepts complete shift data and a pending event', () => {
    expect(shiftOfflineDataSchema.parse(valid)).toEqual(valid);
    expect(
      pendingFieldEventSchema.parse({
        id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        type: 'shift_start',
        payload: {},
        occurredAtDevice: '2026-10-13T10:00:00.000Z',
        createdAt: '2026-10-13T10:00:01.000Z',
      }),
    ).toBeDefined();
  });
  it('rejects malformed timestamps and event ids', () => {
    expect(
      shiftOfflineDataSchema.safeParse({ ...valid, serverTime: { serverNowUtc: 'yesterday' } })
        .success,
    ).toBe(false);
    expect(
      pendingFieldEventSchema.safeParse({
        id: 'nope',
        type: 'shift_start',
        payload: {},
        occurredAtDevice: '2026-10-13T10:00:00Z',
        createdAt: '2026-10-13T10:00:00Z',
      }).success,
    ).toBe(false);
  });
});
