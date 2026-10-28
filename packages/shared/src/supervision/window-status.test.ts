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

  it('uses the synced watermark at grace expiry, including midnight and partial sync', () => {
    const overnight = {
      ...base,
      startsAt: new Date('2026-10-21T22:00:00Z'),
      endsAt: new Date('2026-10-22T00:00:00Z'),
      graceEndsAt: new Date('2026-10-22T00:15:00Z'),
      now: new Date('2026-10-22T00:15:00Z'),
    };
    expect(
      computeRoundWindowStatus({ ...overnight, syncedUntil: new Date('2026-10-22T00:14:59Z') }),
    ).toBe('pending_sync');
    expect(computeRoundWindowStatus({ ...overnight, syncedUntil: overnight.graceEndsAt })).toBe(
      'not_done',
    );
  });

  it('evaluates a 00:00–02:00 window at 02:15 only when synced through grace (CA1 and CA4)', () => {
    const window = {
      ...base,
      startsAt: new Date('2026-10-22T00:00:00Z'),
      endsAt: new Date('2026-10-22T02:00:00Z'),
      graceEndsAt: new Date('2026-10-22T02:15:00Z'),
      now: new Date('2026-10-22T02:15:00Z'),
      recordedCount: 4,
    };
    expect(
      computeRoundWindowStatus({ ...window, syncedUntil: new Date('2026-10-22T02:14:00Z') }),
    ).toBe('pending_sync');
    expect(computeRoundWindowStatus({ ...window, syncedUntil: window.graceEndsAt })).toBe(
      'incomplete',
    );
  });

  it('handles absent, unassigned, cancelled, guard closed and admin closed windows', () => {
    const expired = { ...base, now: graceEndsAt };
    expect(computeRoundWindowStatus({ ...expired, coverage: 'absent' })).toBe('not_done');
    expect(computeRoundWindowStatus({ ...expired, coverage: 'unassigned' })).toBe('not_done');
    expect(computeRoundWindowStatus({ ...expired, coverage: 'cancelled' })).toBe('pending');
    expect(computeRoundWindowStatus({ ...expired, coverage: 'guard_closed' })).toBe('not_done');
    expect(
      computeRoundWindowStatus({ ...expired, coverage: 'admin_closed_before', syncedUntil: null }),
    ).toBe('pending_sync');
    expect(computeRoundWindowStatus({ ...expired, coverage: 'admin_closed_after' })).toBe(
      'not_done',
    );
    expect(computeRoundWindowStatus({ ...expired, coverage: 'site_closed_after' })).toBe('pending');
  });

  it('keeps completion in grace and accepts late data corrections', () => {
    expect(
      computeRoundWindowStatus({
        ...base,
        now: graceEndsAt,
        recordedCount: 5,
        completedLate: true,
      }),
    ).toBe('complete_late');
    expect(
      computeRoundWindowStatus({ ...base, now: graceEndsAt, recordedCount: 5, syncedUntil: null }),
    ).toBe('complete');
  });
});
