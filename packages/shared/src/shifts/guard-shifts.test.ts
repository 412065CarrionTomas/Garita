import { guardShiftsQuerySchema } from './guard-shifts';

describe('guardShiftsQuerySchema', () => {
  it('acepta un rango libre y rechaza fechas invertidas o inválidas', () => {
    expect(
      guardShiftsQuerySchema.safeParse({ desde: '2025-01-01', hasta: '2026-12-31' }).success,
    ).toBe(true);
    expect(
      guardShiftsQuerySchema.safeParse({ desde: '2026-02-01', hasta: '2026-01-31' }).success,
    ).toBe(false);
    expect(
      guardShiftsQuerySchema.safeParse({ desde: '2026-13-01', hasta: '2026-12-31' }).success,
    ).toBe(false);
  });
});
