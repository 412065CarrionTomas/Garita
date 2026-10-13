import { checkpointRecordRequestSchema, checkpointRecordResponseSchema } from './checkpoint-record';

const location = {
  status: 'ok' as const,
  latitude: -34.6,
  longitude: -58.4,
  accuracyMeters: 6,
  simulation: 'not_simulated' as const,
  takenAt: '2026-10-14T03:10:00.000Z',
};

describe('checkpoint record contract', () => {
  it('accepts a QR record generated on the phone', () => {
    expect(
      checkpointRecordRequestSchema.safeParse({
        recordId: '3d0c3f8e-6c0a-4f8f-9a1b-2b7f4b1f9c10',
        shiftId: 'shift-1',
        method: 'qr',
        scannedValue: 'GQR1.cp1.1.signature',
        occurredAtDevice: '2026-10-14T03:10:00.000Z',
        location,
        phoneNfc: 'on',
      }).success,
    ).toBe(true);
  });

  it('describes each server outcome', () => {
    const recordId = '3d0c3f8e-6c0a-4f8f-9a1b-2b7f4b1f9c10';
    expect(
      checkpointRecordResponseSchema.safeParse({
        result: 'recorded',
        recordId,
        checkpointId: 'cp1',
        countedFor: [{ roundId: 'r1', windowIndex: 0, late: true }],
        outOfWindow: false,
      }).success,
    ).toBe(true);
    expect(
      checkpointRecordResponseSchema.safeParse({
        result: 'rejected',
        recordId,
        reason: 'outdated_version',
      }).success,
    ).toBe(true);
    expect(
      checkpointRecordResponseSchema.safeParse({
        result: 'not_generated',
        recordId,
        cause: 'too_soon',
        retryAfterUtc: '2026-10-14T04:10:00.000Z',
      }).success,
    ).toBe(true);
  });
});
