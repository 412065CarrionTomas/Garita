import {
  SYNC_BATCH_MAX_EVENTS,
  computeSyncedUntil,
  syncBatchRequestSchema,
  syncBatchResponseSchema,
  syncEventId,
  syncEventSchema,
} from './sync-contract';

const location = {
  status: 'ok' as const,
  latitude: -34.6,
  longitude: -58.4,
  accuracyMeters: 6,
  simulation: 'not_simulated' as const,
  takenAt: '2026-10-14T03:10:00.000Z',
};
const record = {
  type: 'checkpoint_record' as const,
  payload: {
    recordId: '3d0c3f8e-6c0a-4f8f-9a1b-2b7f4b1f9c10',
    shiftId: 'shift-1',
    method: 'qr' as const,
    scannedValue: 'GQR1.cp1.1.signature',
    occurredAtDevice: '2026-10-14T03:10:00.000Z',
    location,
    phoneNfc: 'on' as const,
  },
};
const close = {
  type: 'shift_close' as const,
  payload: {
    eventId: '9f1d6f2e-1d57-4c2a-8f55-0c7f1e5b7a11',
    occurredAtDevice: '2026-10-14T06:00:00.000Z',
    location,
  },
};

describe('sync contract', () => {
  it('accepts records and the shift close, and reads each event id', () => {
    expect(syncEventSchema.parse(record)).toEqual(record);
    expect(syncEventId(syncEventSchema.parse(record))).toBe(record.payload.recordId);
    expect(syncEventId(syncEventSchema.parse(close))).toBe(close.payload.eventId);
  });

  it('rejects the shift start and unknown event types', () => {
    expect(syncEventSchema.safeParse({ type: 'shift_start', payload: {} }).success).toBe(false);
  });

  it('limits a batch to 100 events and requires at least one', () => {
    const base = { shiftId: 'shift-1', pendingCount: 0, syncedUntil: null };
    expect(syncBatchRequestSchema.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(
      syncBatchRequestSchema.safeParse({
        ...base,
        events: Array.from({ length: SYNC_BATCH_MAX_EVENTS + 1 }, () => record),
      }).success,
    ).toBe(false);
    expect(syncBatchRequestSchema.safeParse({ ...base, events: [record, close] }).success).toBe(
      true,
    );
  });

  it('describes accepted, duplicate and rejected events', () => {
    expect(
      syncBatchResponseSchema.safeParse({
        receivedAt: '2026-10-14T12:00:00.000Z',
        results: [
          {
            status: 'accepted',
            eventId: record.payload.recordId,
            outcome: {
              result: 'recorded',
              recordId: record.payload.recordId,
              checkpointId: 'cp1',
              countedFor: [],
              outOfWindow: true,
            },
          },
          { status: 'duplicate', eventId: close.payload.eventId },
          { status: 'rejected', eventId: 'x', reason: 'invalid_data', message: 'Datos inválidos' },
        ],
      }).success,
    ).toBe(true);
  });

  it('computes syncedUntil as the latest event time sent', () => {
    expect(computeSyncedUntil([], null)).toBeNull();
    expect(
      computeSyncedUntil(
        [
          { occurredAtDevice: '2026-10-14T03:00:00.000Z' },
          { occurredAtDevice: '2026-10-14T05:00:00.000Z' },
        ],
        '2026-10-14T01:00:00.000Z',
      ),
    ).toBe('2026-10-14T05:00:00.000Z');
    expect(
      computeSyncedUntil(
        [{ occurredAtDevice: '2026-10-14T01:00:00.000Z' }],
        '2026-10-14T02:00:00.000Z',
      ),
    ).toBe('2026-10-14T02:00:00.000Z');
  });
});
