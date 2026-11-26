import { guardShiftsQuerySchema } from './guard-shifts';

const ok = (desde: string, hasta: string) =>
  guardShiftsQuerySchema.safeParse({ desde, hasta }).success;

describe('guardShiftsQuerySchema', () => {
  it('acepta un rango de hasta un año y rechaza fechas invertidas, inválidas o rangos mayores', () => {
    expect(ok('2026-01-01', '2026-12-31')).toBe(true);
    expect(ok('2028-01-01', '2028-12-31')).toBe(true); // bisiesto: 366 días
    expect(ok('2025-01-01', '2026-12-31')).toBe(false);
    expect(ok('2026-02-01', '2026-01-31')).toBe(false);
    expect(ok('2026-13-01', '2026-12-31')).toBe(false);
  });
});
