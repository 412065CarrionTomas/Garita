import {
  computePortalCompliance,
  portalRoundStatus,
  portalRoundsSchema,
  portalQuerySchema,
} from './portal';
import { ROUND_WINDOW_STATUSES } from './supervision/window-status';

it('traduce demora y observaciones a completa y oculta sincronización y estados en curso', () => {
  expect(ROUND_WINDOW_STATUSES.map(portalRoundStatus)).toEqual([
    null,
    null,
    null,
    'completa',
    'completa',
    'incompleta',
    'no_realizada',
    null,
    'en_verificacion',
  ]);
});
it('usa HU-25: 18/20 = 90%, con dos revisiones aparte, sin campos internos', () => {
  const period = { desde: '2026-10-01', hasta: '2026-11-01' };
  const windows = Array.from({ length: 24 }, (_, i) => ({
    startsAt: '2026-10-01T10:00:00Z',
    endsAt: '2026-10-01T11:00:00Z',
    site: { id: 'p1', name: 'Depósito Ruta 9' },
    status:
      i < 17
        ? ('complete' as const)
        : i === 17
          ? ('complete_late' as const)
          : i === 18
            ? ('incomplete' as const)
            : i === 19
              ? ('not_done' as const)
              : i < 22
                ? ('in_review' as const)
                : i === 22
                  ? ('pending_sync' as const)
                  : ('in_progress' as const),
    severityLevel: 'grave',
  }));
  const result = computePortalCompliance(windows, 'UTC', period);
  expect(result.totals).toEqual({
    completa: 18,
    incompleta: 1,
    no_realizada: 1,
    en_verificacion: 2,
    evaluated: 20,
    percentage: 90,
  });
  expect(result.daily).toHaveLength(31);
  expect(portalRoundsSchema.parse(result)).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(/grave|severity|late|pending_sync|guard/);
  expect(computePortalCompliance([], 'UTC', period).totals.percentage).toBeNull();
});
it('rechaza 13 meses, fechas inválidas y selectores de cliente inyectados', () => {
  expect(portalQuerySchema.safeParse({ desde: '2025-10-01', hasta: '2026-11-01' }).success).toBe(
    false,
  );
  expect(portalQuerySchema.safeParse({ desde: '2026-02-30', hasta: '2026-03-01' }).success).toBe(
    false,
  );
  expect(portalQuerySchema.safeParse({ cliente: 'other' }).success).toBe(false);
});
