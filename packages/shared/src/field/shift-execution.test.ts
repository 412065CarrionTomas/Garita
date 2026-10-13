import {
  closeShiftRequestSchema,
  currentRoundProgress,
  isEarlyClose,
  isWithinStartMargin,
  lateStartMinutes,
  startShiftRequestSchema,
} from './shift-execution';

const location = {
  status: 'ok' as const,
  latitude: -34.6,
  longitude: -58.4,
  accuracyMeters: 8,
  simulation: 'not_simulated' as const,
  takenAt: '2026-10-14T01:00:00.000Z',
};

describe('shift execution contract', () => {
  it('accepts a start event generated on the phone', () => {
    const parsed = startShiftRequestSchema.safeParse({
      eventId: '0b6b1f5e-5a36-4f0e-9a52-2f7d3f1e8c11',
      occurredAtDevice: '2026-10-14T00:50:00.000Z',
      location,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a close event without a uuid', () => {
    expect(
      closeShiftRequestSchema.safeParse({
        eventId: 'x',
        occurredAtDevice: '2026-10-14T09:00:00.000Z',
        location,
      }).success,
    ).toBe(false);
  });

  it('opens the start margin 30 minutes before the start and closes it at the end', () => {
    const start = '2026-10-14T01:00:00.000Z';
    const end = '2026-10-14T09:00:00.000Z';
    expect(isWithinStartMargin(start, end, '2026-10-14T00:29:00.000Z')).toBe(false);
    expect(isWithinStartMargin(start, end, '2026-10-14T00:30:00.000Z')).toBe(true);
    expect(isWithinStartMargin(start, end, '2026-10-14T09:00:00.000Z')).toBe(true);
    expect(isWithinStartMargin(start, end, '2026-10-14T09:00:01.000Z')).toBe(false);
  });

  it('computes the late start in whole minutes', () => {
    expect(lateStartMinutes('2026-10-14T01:00:00.000Z', '2026-10-14T00:50:00.000Z')).toBeNull();
    expect(lateStartMinutes('2026-10-14T01:00:00.000Z', '2026-10-14T01:25:30.000Z')).toBe(25);
  });

  it('flags a close before the scheduled end as early', () => {
    expect(isEarlyClose('2026-10-14T09:00:00.000Z', '2026-10-14T07:30:00.000Z')).toBe(true);
    expect(isEarlyClose('2026-10-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z')).toBe(false);
  });
});

describe('currentRoundProgress', () => {
  const data = {
    rounds: [
      {
        roundId: 'r1',
        roundVersionId: 'v1',
        name: 'Perimetral',
        frequencyMinutes: 120,
        windowStartLocal: '22:00',
        windowEndLocal: '06:00',
        graceMinutes: 15,
        checkpointIds: ['a', 'b', 'c'],
      },
    ],
    windows: [
      {
        roundId: 'r1',
        index: 0,
        startUtc: '2026-10-14T01:00:00.000Z',
        endUtc: '2026-10-14T03:00:00.000Z',
        label: '22:00–00:00',
      },
      {
        roundId: 'r1',
        index: 1,
        startUtc: '2026-10-14T03:00:00.000Z',
        endUtc: '2026-10-14T05:00:00.000Z',
        label: '00:00–02:00',
      },
    ],
  };

  it('returns the current window with its checkpoints in order', () => {
    const [progress] = currentRoundProgress(data, '2026-10-14T03:30:00.000Z');
    expect(progress?.currentWindow?.label).toBe('00:00–02:00');
    expect(progress?.pendingCheckpointIds).toEqual(['a', 'b', 'c']);
  });

  it('excludes recorded checkpoints and returns no window outside the franja', () => {
    const recorded = new Map([['r1:0', new Set(['b'])]]);
    expect(
      currentRoundProgress(data, '2026-10-14T01:10:00.000Z', recorded)[0]?.pendingCheckpointIds,
    ).toEqual(['a', 'c']);
    expect(currentRoundProgress(data, '2026-10-14T10:00:00.000Z')[0]?.currentWindow).toBeNull();
  });
});
