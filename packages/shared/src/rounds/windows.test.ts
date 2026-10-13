import {
  computeRoundWindows,
  defaultGraceMinutes,
  previewWindows,
  windowsForShift,
} from './windows';

describe('round windows', () => {
  it('calculates overnight and clipped windows', () => {
    expect(
      previewWindows({ windowStartLocal: '22:00', windowEndLocal: '06:00', frequencyMinutes: 120 }),
    ).toEqual(['22:00–00:00', '00:00–02:00', '02:00–04:00', '04:00–06:00']);
    expect(
      previewWindows({ windowStartLocal: '20:00', windowEndLocal: '01:00', frequencyMinutes: 120 }),
    ).toEqual(['20:00–22:00', '22:00–00:00', '00:00–01:00']);
    expect(
      previewWindows({ windowStartLocal: '06:00', windowEndLocal: '06:00', frequencyMinutes: 120 }),
    ).toHaveLength(12);
  });
  it('converts local windows to UTC and filters a partial shift', () => {
    const windows = computeRoundWindows('2026-10-13', {
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      frequencyMinutes: 120,
      timezone: 'America/Argentina/Buenos_Aires',
    });
    expect(windows).toHaveLength(4);
    expect(windows[0]?.startUtc).toBe('2026-10-14T01:00:00.000Z');
    expect(
      windowsForShift(windows, {
        shiftStartUtc: '2026-10-14T02:00:00.000Z',
        shiftEndUtc: '2026-10-14T07:00:00.000Z',
      }).completeWindows,
    ).toHaveLength(2);
  });
  it('sets the default grace', () => {
    expect(defaultGraceMinutes(120)).toBe(15);
    expect(defaultGraceMinutes(20)).toBe(10);
  });
});
