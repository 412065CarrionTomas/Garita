import {
  countsTowardGuardLimit,
  daysLeft,
  effectiveGuardLimit,
  graceEndsAt,
  trialEndsAt,
} from './account';

const BA = 'America/Argentina/Buenos_Aires'; // UTC-3, no DST

describe('trialEndsAt', () => {
  it('ends at 23:59 of day 14 in company local time (HU-41 BDD 2)', () => {
    const created = new Date('2026-11-01T15:00:00.000Z');
    expect(trialEndsAt(created, BA).toISOString()).toBe('2026-11-15T02:59:00.000Z');
  });

  it('uses the local date when UTC is already the next day', () => {
    // 1 Nov 22:30 in Buenos Aires
    const created = new Date('2026-11-02T01:30:00.000Z');
    expect(trialEndsAt(created, BA).toISOString()).toBe('2026-11-15T02:59:00.000Z');
  });
});

describe('graceEndsAt', () => {
  it('gives seven full days after the rejected charge', () => {
    const rejected = new Date('2026-11-10T12:00:00.000Z');
    expect(graceEndsAt(rejected, BA).toISOString()).toBe('2026-11-18T02:59:00.000Z');
  });
});

describe('daysLeft', () => {
  const endsAt = trialEndsAt(new Date('2026-11-01T15:00:00.000Z'), BA);

  it('counts today: 14 on the first day, 1 on the last', () => {
    expect(daysLeft(endsAt, new Date('2026-11-01T15:00:00.000Z'), BA)).toBe(14);
    expect(daysLeft(endsAt, new Date('2026-11-14T15:00:00.000Z'), BA)).toBe(1);
  });

  it('is 0 after the end', () => {
    expect(daysLeft(endsAt, new Date('2026-11-15T03:00:00.000Z'), BA)).toBe(0);
  });
});

describe('guard limit', () => {
  it('counts active guards and pending invitations only', () => {
    expect(countsTowardGuardLimit('active')).toBe(true);
    expect(countsTowardGuardLimit('invitation_pending')).toBe(true);
    expect(countsTowardGuardLimit('deactivated')).toBe(false);
  });

  it('uses the basic plan during the trial', () => {
    expect(
      effectiveGuardLimit({
        planMaxGuards: null,
        pendingPlanMaxGuards: null,
        basicPlanMaxGuards: 10,
      }),
    ).toBe(10);
  });

  it('respects a requested downgrade before it applies', () => {
    const base = { planMaxGuards: 30, basicPlanMaxGuards: 10 };
    expect(effectiveGuardLimit({ ...base, pendingPlanMaxGuards: null })).toBe(30);
    expect(effectiveGuardLimit({ ...base, pendingPlanMaxGuards: 20 })).toBe(20);
  });
});
