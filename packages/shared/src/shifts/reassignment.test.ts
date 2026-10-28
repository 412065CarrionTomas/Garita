import { previousAssignmentResult } from './reassignment';
import { windowOwner } from '../assignments';

const start = new Date('2026-10-28T20:00:00Z');

it.each([
  [new Date('2026-10-28T19:59:59Z'), true, false, 'replaced'],
  [start, true, false, 'replaced'],
  [new Date('2026-10-28T20:00:01Z'), true, false, 'absent'],
  [new Date('2026-10-28T21:00:00Z'), false, false, 'replaced'],
  [new Date('2026-10-29T01:30:00Z'), true, true, 'closed_early'],
] as const)('decides the prior assignment result at %s', (now, hadGuard, covering, expected) => {
  expect(previousAssignmentResult({ now, hadGuard, covering, previousStartsAt: start })).toBe(
    expected,
  );
});

it('attributes two absences across midnight and the replacement boundary', () => {
  const assignments = [
    { id: 'juan', startsAt: '2030-01-01T20:00:00Z', result: 'absent' as const },
    { id: 'pedro', startsAt: '2030-01-01T21:00:00Z', result: 'absent' as const },
    { id: 'ana', startsAt: '2030-01-02T01:00:00Z', result: 'scheduled' as const },
  ];
  expect(windowOwner('2030-01-02T00:00:00Z', assignments)).toBe('pedro');
  expect(windowOwner('2030-01-02T01:00:00Z', assignments)).toBe('pedro');
  expect(windowOwner('2030-01-02T02:00:00Z', assignments)).toBe('ana');
});

it('ignores a replacement that never governed when the original guard returns', () => {
  const assignments = [
    { id: 'pedro-first', startsAt: '2030-01-01T20:00:00Z', result: 'absent' as const },
    { id: 'juan', startsAt: '2030-01-01T21:00:00Z', result: 'replaced' as const },
    { id: 'pedro-return', startsAt: '2030-01-01T20:40:00Z', result: 'started' as const },
  ];
  expect(windowOwner('2030-01-01T20:40:00Z', assignments)).toBe('pedro-first');
  expect(windowOwner('2030-01-02T00:00:00Z', assignments)).toBe('pedro-return');
});

it('keeps the ending window with the guard who closed early', () => {
  const assignments = [
    { id: 'pedro', startsAt: '2030-01-01T20:00:00Z', result: 'closed_early' as const },
    { id: 'juan', startsAt: '2030-01-02T02:00:00Z', result: 'scheduled' as const },
  ];
  expect(windowOwner('2030-01-02T02:00:00Z', assignments)).toBe('pedro');
  expect(windowOwner('2030-01-02T04:00:00Z', assignments)).toBe('juan');
});
