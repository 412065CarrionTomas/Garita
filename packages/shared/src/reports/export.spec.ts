import { isReportExportPeriodAllowed, REPORT_EXPORT_PERIOD_MESSAGE } from './export';

describe('período de exportación PDF [desde, hasta)', () => {
  it.each([
    ['2026-08-01', '2026-11-01', true],
    ['2026-08-01', '2026-11-02', false],
    ['2026-11-30', '2027-02-28', true],
    ['2026-11-30', '2027-03-01', false],
    ['2027-11-30', '2028-02-29', true],
    ['2027-11-30', '2028-03-01', false],
    ['2026-12-31', '2027-03-31', true],
    ['2026-01-31', '2026-04-30', true],
    ['2026-02-29', '2026-03-01', false],
    ['2026-10-01', '2026-10-01', false],
    ['2026-10-02', '2026-10-01', false],
    ['no-es-fecha', '2026-10-01', false],
  ])('%s a %s: %s', (desde, hasta, expected) => {
    expect(isReportExportPeriodAllowed(desde, hasta)).toBe(expected);
  });
  it('conserva el mensaje común de API y botón', () => {
    expect(REPORT_EXPORT_PERIOD_MESSAGE).toBe('El período máximo para exportar es de 3 meses');
  });
});
