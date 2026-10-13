import type { RoundWindow } from '../rounds/windows';

export interface ShiftWindowSource {
  id: string;
  startsAt: string;
  endsAt: string;
  status?: 'scheduled' | 'unassigned' | 'cancelled';
  roundIds?: readonly string[];
}

export interface AssignedRoundWindow {
  window: RoundWindow;
  shiftId: string | null;
  notEvaluable: boolean;
}

/** Assigns a window to the shift active at its end; an exact shift end is included. */
export function assignWindowsToShifts(
  windows: readonly RoundWindow[],
  shifts: readonly ShiftWindowSource[],
): AssignedRoundWindow[] {
  return windows.map((window) => {
    const end = Date.parse(window.endUtc);
    const shift = shifts
      .filter((candidate) => {
        const start = Date.parse(candidate.startsAt);
        const finish = Date.parse(candidate.endsAt);
        return candidate.status !== 'cancelled' && start <= end && end <= finish;
      })
      .sort((a, b) => {
        const aEndsHere = Date.parse(a.endsAt) === end ? 1 : 0;
        const bEndsHere = Date.parse(b.endsAt) === end ? 1 : 0;
        return bEndsHere - aEndsHere || Date.parse(b.startsAt) - Date.parse(a.startsAt);
      })[0];
    return { window, shiftId: shift?.id ?? null, notEvaluable: !shift };
  });
}

/** Finds windows that start during a shift but whose end is not covered by a same-round shift. */
export function findUncoveredWindows(
  windows: readonly (RoundWindow & { roundId: string })[],
  shifts: readonly ShiftWindowSource[],
): (RoundWindow & { roundId: string })[] {
  return windows.filter((window) => {
    const start = Date.parse(window.startUtc);
    const end = Date.parse(window.endUtc);
    const beginsDuringShift = shifts.some(
      (shift) =>
        shift.status !== 'cancelled' &&
        Date.parse(shift.startsAt) <= start &&
        start < Date.parse(shift.endsAt) &&
        (shift.roundIds ?? []).includes(window.roundId),
    );
    if (!beginsDuringShift) return false;
    return !shifts.some(
      (shift) =>
        shift.status !== 'cancelled' &&
        (shift.roundIds ?? []).includes(window.roundId) &&
        Date.parse(shift.startsAt) < end &&
        end <= Date.parse(shift.endsAt),
    );
  });
}
