import { computeRoundWindows } from '../rounds/windows';
import { assignWindowsToShifts, findUncoveredWindows } from './windows';

const round = {
  windowStartLocal: '22:00',
  windowEndLocal: '06:00',
  frequencyMinutes: 120,
  timezone: 'America/Argentina/Buenos_Aires',
};

describe('shift window allocation', () => {
  it('allocates four expected windows to an overnight shift', () => {
    const windows = computeRoundWindows('2026-10-12', round);
    const shift = {
      id: 'night',
      startsAt: '2026-10-12T23:00:00.000Z',
      endsAt: '2026-10-13T11:00:00.000Z',
    };
    const assigned = assignWindowsToShifts(windows, [shift]);
    expect(assigned.filter((item) => item.shiftId === shift.id)).toHaveLength(4);
  });

  it('assigns the midnight-crossing window to the shift active at its end', () => {
    const windows = computeRoundWindows('2026-10-12', round);
    const target = windows.find((window) => window.label === '00:00–02:00');
    if (!target) throw new Error('No se encontró la ventana de medianoche.');
    const assigned = assignWindowsToShifts(windows, [
      { id: 'first', startsAt: '2026-10-12T00:00:00.000Z', endsAt: '2026-10-13T04:00:00.000Z' },
      { id: 'second', startsAt: '2026-10-13T04:00:00.000Z', endsAt: '2026-10-13T12:00:00.000Z' },
    ]);
    expect(assigned.find((item) => item.window === target)?.shiftId).toBe('second');
  });

  it('warns when a window ends after the only shift and clears the warning when covered', () => {
    const window = { ...at(computeRoundWindows('2026-10-12', round), 1), roundId: 'round' };
    const first = {
      id: 'first',
      startsAt: '2026-10-13T00:00:00.000Z',
      endsAt: '2026-10-13T04:00:00.000Z',
      roundIds: ['round'],
    };
    expect(findUncoveredWindows([window], [first])).toHaveLength(1);
    const next = {
      id: 'next',
      startsAt: '2026-10-13T04:00:00.000Z',
      endsAt: '2026-10-13T12:00:00.000Z',
      roundIds: ['round'],
    };
    expect(findUncoveredWindows([window], [first, next])).toHaveLength(0);
  });

  it('keeps a window ending exactly at a shift end assigned to that shift', () => {
    const window = at(computeRoundWindows('2026-10-12', round), 0);
    const shift = { id: 'ends-here', startsAt: window.startUtc, endsAt: window.endUtc };
    expect(assignWindowsToShifts([window], [shift])[0]?.shiftId).toBe(shift.id);
  });

  it('marks windows without an active shift or on cancelled shifts not evaluable', () => {
    const window = at(computeRoundWindows('2026-10-12', round), 0);
    expect(assignWindowsToShifts([window], []).at(0)?.notEvaluable).toBe(true);
    expect(
      assignWindowsToShifts(
        [window],
        [
          {
            id: 'cancelled',
            startsAt: window.startUtc,
            endsAt: window.endUtc,
            status: 'cancelled',
          },
        ],
      ).at(0)?.notEvaluable,
    ).toBe(true);
  });
});

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`No existe el elemento ${index}.`);
  return value;
}
