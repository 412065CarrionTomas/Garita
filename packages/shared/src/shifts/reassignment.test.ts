import { previousAssignmentResult } from './reassignment';

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
