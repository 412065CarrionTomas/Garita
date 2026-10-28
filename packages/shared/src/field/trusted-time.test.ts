import {
  deviceClockSchema,
  monotonicClockSchema,
  timeReferenceSchema,
  serverTimeResponseSchema,
  isTimeAltered,
  recalculateBoot,
  trustedTimeFor,
} from './trusted-time';

const reference = {
  serverTime: '2026-10-19T00:00:00.000Z',
  elapsedMs: 1000,
  bootId: 'a',
  offsetMs: 0,
};
const event = { deviceTime: '2026-10-19T01:00:00.000Z', elapsedMs: 3601000, bootId: 'a' };

describe('HU-14 trusted time', () => {
  it('validates native, reference, event and public response boundaries', () => {
    expect(monotonicClockSchema.parse(event).bootId).toBe('a');
    expect(timeReferenceSchema.parse(reference)).toEqual(reference);
    expect(serverTimeResponseSchema.parse(reference)).toEqual({ serverTime: reference.serverTime });
    expect(deviceClockSchema.parse(trustedTimeFor(event, reference)).timeStatus).toBe('verified');
    expect(monotonicClockSchema.safeParse({ elapsedMs: -1, bootId: '' }).success).toBe(false);
  });
  it('CA1 / BDD1: ignores a device clock advanced 3 hours', () => {
    const clock = trustedTimeFor({ ...event, deviceTime: '2026-10-19T04:00:00.000Z' }, reference);
    expect(clock.trustedAt).toBe(event.deviceTime);
    expect(clock.timeStatus).toBe('verified');
    expect(
      isTimeAltered(
        Date.parse(clock.deviceTime) - Date.parse(clock.trustedAt ?? ''),
        clock.referenceOffsetMs ?? Number.NaN,
      ),
    ).toBe(true);
  });
  it('CA2 / BDD2: 12 hours offline has zero arithmetic drift', () => {
    expect(trustedTimeFor({ ...event, elapsedMs: 43201000 }, reference).trustedAt).toBe(
      '2026-10-19T12:00:00.000Z',
    );
  });
  it('CA3 / BDD3: recalculates backwards after an offline reboot', () => {
    const pending = trustedTimeFor({ ...event, bootId: 'b', elapsedMs: 1000 }, reference);
    expect(pending.timeStatus).toBe('pending');
    expect(pending.trustedAt).toBeNull();
    const [clock] = recalculateBoot([pending], {
      ...reference,
      bootId: 'b',
      elapsedMs: 3601000,
      serverTime: '2026-10-19T02:00:00.000Z',
    });
    expect(clock?.trustedAt).toBe(event.deviceTime);
    expect(clock?.timeStatus).toBe('recalculated');
    expect(isTimeAltered(0, clock?.referenceOffsetMs ?? Number.NaN)).toBe(false);
  });
  it('CA5 / BDD4: retains the pre-reboot baseline when the device moves back one hour', () => {
    const pending = trustedTimeFor(
      { ...event, bootId: 'b', elapsedMs: 0, deviceTime: reference.serverTime },
      reference,
    );
    const [clock] = recalculateBoot([pending], {
      ...reference,
      bootId: 'b',
      elapsedMs: 1000,
      serverTime: '2026-10-19T01:00:01.000Z',
      offsetMs: -3600000,
    });
    expect(clock?.trustedAt).toBe(event.deviceTime);
    expect(isTimeAltered(-3600000, clock?.referenceOffsetMs ?? Number.NaN)).toBe(true);
  });
  it('CA6 / BDD5: only an abandoned boot is unverifiable; keeps resolved events', () => {
    const pending = trustedTimeFor({ ...event, bootId: 'b' }, reference);
    const verified = trustedTimeFor(event, reference);
    const [lost, resolved, current] = recalculateBoot(
      [pending, verified, { ...pending, bootId: 'c' }],
      { ...reference, bootId: 'c' },
    );
    expect(lost?.timeStatus).toBe('unverifiable');
    expect(lost?.trustedAt).toBeNull();
    expect(resolved).toEqual(verified);
    expect(current?.timeStatus).toBe('recalculated');
  });
  it('CA7: a pre-existing three-minute offset is not alteration', () => {
    const clock = trustedTimeFor(
      { ...event, deviceTime: '2026-10-19T01:03:00.000Z' },
      { ...reference, offsetMs: 180000 },
    );
    expect(isTimeAltered(180000, clock.referenceOffsetMs ?? Number.NaN)).toBe(false);
    expect(isTimeAltered(300000, 180000)).toBe(false);
    expect(isTimeAltered(300001, 180000)).toBe(true);
    expect(isTimeAltered(-120001, 0)).toBe(true);
  });
  it('CA4: missing initial reference remains pending and acquires its first baseline', () => {
    const pending = trustedTimeFor(event, null);
    expect(pending.referenceOffsetMs).toBeNull();
    const [clock] = recalculateBoot([pending], reference);
    expect(clock?.referenceOffsetMs).toBe(0);
  });
});
