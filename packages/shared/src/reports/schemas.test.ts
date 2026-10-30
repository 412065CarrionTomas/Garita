import { defaultReportPeriod, reportDetailQuerySchema, reportQuerySchema } from './schemas';

describe('report periods', () => {
  it.each([
    { desde: '2026-11-01', hasta: '2026-10-01' },
    { desde: '2026-10-01', hasta: '2026-10-01' },
    { desde: '2025-09-01', hasta: '2026-10-01' },
    { desde: '2026-02-30', hasta: '2026-03-02' },
    { desde: '2026-10-01' },
    { hasta: '2026-10-01' },
    { desde: '2024-02-29', hasta: '2025-03-01' },
  ])('rejects invalid or incomplete range %j', (input) => {
    expect(reportQuerySchema.safeParse(input).success).toBe(false);
    expect(reportDetailQuerySchema.safeParse(input).success).toBe(false);
  });
  it('accepts twelve calendar months and bounded pagination', () => {
    expect(reportQuerySchema.safeParse({ desde: '2025-10-01', hasta: '2026-10-01' }).success).toBe(
      true,
    );
    expect(reportDetailQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
  it('defaults to the last calendar month in company local time, clamping month ends', () => {
    expect(defaultReportPeriod(new Date('2026-03-31T12:00:00Z'), 'UTC')).toEqual({
      desde: '2026-02-28',
      hasta: '2026-03-31',
    });
    expect(
      defaultReportPeriod(new Date('2026-11-01T01:00:00Z'), 'America/Argentina/Buenos_Aires'),
    ).toEqual({ desde: '2026-09-30', hasta: '2026-10-31' });
  });
});
