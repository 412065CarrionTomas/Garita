import { windowSeverity, shouldNotifyMissedRound } from './review';
import type { RecordFlagType } from '../marcas/types';

const points = (flags: RecordFlagType[], count = 5) => [
  ...flags.map((flag) => ({ flags: [flag], invalidated: false })),
  ...Array.from({ length: count - flags.length }, () => ({ flags: [], invalidated: false })),
];

describe('windowSeverity', () => {
  it.each([
    [['simulated_location'], 'grave'],
    [['out_of_range', 'out_of_range', 'location_unverifiable'], 'grave'],
    [['out_of_range', 'out_of_range'], 'media'],
    [['location_unverifiable', 'location_unverifiable'], 'leve'],
    [['location_unverifiable', 'location_unverifiable', 'location_unverifiable'], 'grave'],
    [
      [
        'qr_on_tagged_point',
        'qr_on_tagged_point',
        'qr_on_tagged_point',
        'qr_on_tagged_point',
        'qr_on_tagged_point',
      ],
      'grave',
    ],
    [['out_of_range'], 'media'],
  ] as const)('classifies %j as %s in five points', (flags, expected) => {
    expect(windowSeverity(points([...flags]), 5)).toBe(expected);
  });

  it('requires more than half, including for four points', () => {
    expect(windowSeverity(points(['out_of_range', 'location_unverifiable'], 4), 4)).toBe('media');
  });

  it('ignores invalidated records', () => {
    expect(windowSeverity([{ flags: ['simulated_location'], invalidated: true }], 5)).toBeNull();
  });

  it('keeps a reviewed window out of the missed-round notice', () => {
    expect(shouldNotifyMissedRound('in_review')).toBe(false);
    expect(shouldNotifyMissedRound('incomplete')).toBe(true);
  });
});
