import { computeRoundWindowStatus } from './window-status';

describe('computeRoundWindowStatus', () => {
  const startsAt = new Date('2026-10-21T10:00:00Z');
  const endsAt = new Date('2026-10-21T11:00:00Z');
  const graceEndsAt = new Date('2026-10-21T11:15:00Z');
  const base = { startsAt, endsAt, graceEndsAt, expectedCount: 5, recordedCount: 0 };

  it('covers pending, in progress, and grace states', () => {
    expect(computeRoundWindowStatus({ ...base, now: new Date('2026-10-21T09:00:00Z') })).toBe(
      'pending',
    );
    expect(computeRoundWindowStatus({ ...base, now: startsAt })).toBe('in_progress');
    expect(computeRoundWindowStatus({ ...base, now: endsAt })).toBe('late');
  });

  it('covers CA2 and CA3 completion and late completion', () => {
    expect(
      computeRoundWindowStatus({ ...base, now: endsAt, recordedCount: 5, completedLate: true }),
    ).toBe('complete_late');
    expect(computeRoundWindowStatus({ ...base, now: endsAt, recordedCount: 5 })).toBe('complete');
  });

  it('covers pending sync (CA2/CA3), incomplete (CA7), and not done (CA8)', () => {
    expect(
      computeRoundWindowStatus({
        ...base,
        now: graceEndsAt,
        pendingSync: true,
        recordedCount: 2,
      }),
    ).toBe('pending_sync');
    expect(computeRoundWindowStatus({ ...base, now: graceEndsAt, recordedCount: 2 })).toBe(
      'incomplete',
    );
    expect(computeRoundWindowStatus({ ...base, now: graceEndsAt })).toBe('not_done');
    expect(
      computeRoundWindowStatus({ ...base, now: graceEndsAt, shiftEndedWithoutCoverage: true }),
    ).toBe('not_done');
    expect(
      computeRoundWindowStatus({
        ...base,
        now: graceEndsAt,
        expectedCount: 4,
        recordedCount: 2,
        shiftEndedWithoutCoverage: true,
      }),
    ).toBe('incomplete');
  });
});
