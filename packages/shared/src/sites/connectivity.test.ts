import { computeStartWindow, computeSyncDeadline, siteConnectivitySchema } from './connectivity';

describe('site connectivity', () => {
  const startsAt = new Date('2030-01-01T13:00:00Z');
  const endsAt = new Date('2030-01-01T15:00:00Z');
  const offline = { type: 'without_signal' as const, minutesToSignal: 180, marginMinutes: 20 };

  it('CA1: allows starting at 09:40', () => {
    expect(computeStartWindow(startsAt, offline).toISOString()).toBe('2030-01-01T09:40:00.000Z');
  });
  it('CA2: requires synchronization by 18:20', () => {
    expect(computeSyncDeadline(endsAt, offline).toISOString()).toBe('2030-01-01T18:20:00.000Z');
  });
  it('CA3: rejects no signal with zero travel time', () => {
    expect(siteConnectivitySchema.safeParse({ ...offline, minutesToSignal: 0 }).success).toBe(
      false,
    );
  });
  it('normalizes signal travel to zero and defaults margin to 30', () => {
    const conn = siteConnectivitySchema.parse({ type: 'with_signal', minutesToSignal: 180 });
    expect(conn).toEqual({ type: 'with_signal', minutesToSignal: 0, marginMinutes: 30 });
    expect(computeStartWindow(startsAt, conn).toISOString()).toBe('2030-01-01T12:30:00.000Z');
    expect(computeSyncDeadline(endsAt, conn).toISOString()).toBe('2030-01-01T15:30:00.000Z');
  });
  it('accepts 720 minutes and zero margin, across midnight', () => {
    const conn = siteConnectivitySchema.parse({
      ...offline,
      minutesToSignal: 720,
      marginMinutes: 0,
    });
    expect(computeStartWindow(startsAt, conn).toISOString()).toBe('2030-01-01T01:00:00.000Z');
    expect(computeSyncDeadline(endsAt, conn).toISOString()).toBe('2030-01-02T03:00:00.000Z');
  });
  it.each([-1, 721, 1.5])('rejects invalid travel %s', (minutesToSignal) => {
    expect(siteConnectivitySchema.safeParse({ ...offline, minutesToSignal }).success).toBe(false);
  });
  it.each([-1, 181, 0.5])('rejects invalid margin %s', (marginMinutes) => {
    expect(siteConnectivitySchema.safeParse({ ...offline, marginMinutes }).success).toBe(false);
  });
  it('accepts maximum margin and signal with zero margin', () => {
    expect(siteConnectivitySchema.parse({ ...offline, marginMinutes: 180 }).marginMinutes).toBe(
      180,
    );
    const conn = siteConnectivitySchema.parse({
      type: 'with_signal',
      minutesToSignal: 0,
      marginMinutes: 0,
    });
    expect(computeSyncDeadline(endsAt, conn)).toEqual(endsAt);
    expect(computeStartWindow(startsAt, conn).toISOString()).toBe('2030-01-01T12:30:00.000Z');
  });
});
