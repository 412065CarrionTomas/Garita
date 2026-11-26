import { addDays, weekDays, weekStart } from './board';

describe('week helpers', () => {
  it('starts weeks on Monday, including from a Sunday', () => {
    expect(weekStart('2026-11-26')).toBe('2026-11-23');
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
  });
  it('lists seven days across a month boundary', () => {
    expect(weekDays('2026-12-01')).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
