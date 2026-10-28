import { evaluateTimeFlags } from './evaluator';
import { trustedTimeFor } from '../field/trusted-time';

const base = trustedTimeFor(
  { deviceTime: '2026-10-19T04:00:00.000Z', elapsedMs: 1000, bootId: 'a' },
  { serverTime: '2026-10-19T01:00:00.000Z', elapsedMs: 1000, bootId: 'a', offsetMs: 0 },
);
describe('HU-14 deterministic time flags', () => {
  it('CA1: flags an offset changed by three hours', () => {
    expect(evaluateTimeFlags(base)).toEqual([
      expect.objectContaining({
        type: 'time_altered',
        severity: 'grave',
        reason: 'device_offset_changed',
      }),
    ]);
  });
  it('CA3 / CA7: does not flag a recalculation or an unchanged baseline', () => {
    expect(
      evaluateTimeFlags({ ...base, timeStatus: 'recalculated', deviceTime: base.trustedAt ?? '' }),
    ).toEqual([]);
    expect(evaluateTimeFlags({ ...base, referenceOffsetMs: 10800000 })).toEqual([]);
  });
  it('marks future trusted time even without an offset change', () => {
    expect(
      evaluateTimeFlags({ ...base, deviceTime: base.trustedAt ?? '' }, '2026-10-19T00:59:59.999Z'),
    ).toEqual([expect.objectContaining({ reason: 'trusted_time_in_future' })]);
  });
  it('CA6: marks unverifiable time lightly, never legacy or pending time', () => {
    expect(evaluateTimeFlags({ ...base, trustedAt: null, timeStatus: 'unverifiable' })).toEqual([
      expect.objectContaining({ type: 'time_unverifiable', severity: 'leve' }),
    ]);
    expect(evaluateTimeFlags(undefined)).toEqual([]);
    expect(evaluateTimeFlags({ ...base, trustedAt: null, timeStatus: 'pending' })).toEqual([]);
    expect(evaluateTimeFlags({ ...base, referenceOffsetMs: null })).toEqual([]);
  });
});
