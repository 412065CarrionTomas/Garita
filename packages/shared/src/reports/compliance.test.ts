import { computeCompliance, complianceOwner, type ComplianceWindow } from './compliance';

const window = (
  status: ComplianceWindow['status'],
  extra: Partial<ComplianceWindow> = {},
): ComplianceWindow => ({
  status,
  severityLevel: null,
  startsAt: '2026-10-02T01:00:00Z',
  endsAt: '2026-10-02T03:00:00Z',
  shiftStatus: 'closed',
  site: { id: 's1', name: 'Depósito Ruta 9' },
  assignments: [
    {
      id: 'a1',
      startsAt: '2026-10-01T22:00:00Z',
      result: 'absent',
      guard: { id: 'g1', name: 'Pedro', status: 'deactivated' },
    },
  ],
  ...extra,
});

describe('computeCompliance', () => {
  it('muestra días sin evaluadas como sin datos, sin unir huecos de la evolución', () => {
    const result = computeCompliance([], 'UTC', { desde: '2026-10-01', hasta: '2026-11-01' });
    expect(result.daily).toHaveLength(31);
    expect(result.daily[0]).toMatchObject({
      id: '2026-10-01',
      totals: { percentage: null, evaluated: 0 },
    });
  });
  const ca1 = [
    ...Array.from({ length: 18 }, () => window('complete')),
    window('incomplete'),
    window('not_done'),
    window('in_review'),
    window('in_review'),
  ];
  it('CA1: 18 completas de 20 evaluadas, dos en revisión aparte', () => {
    expect(computeCompliance(ca1, 'America/Argentina/Buenos_Aires').totals).toMatchObject({
      complete: 18,
      evaluated: 20,
      percentage: 90,
      in_review: 2,
    });
  });
  it('BDD2: validar una da 19 de 21, invalidar cambia la siguiente consulta', () => {
    const validated = [...ca1.slice(0, -1), window('complete')];
    expect(computeCompliance(validated, 'UTC').totals).toMatchObject({
      complete: 19,
      evaluated: 21,
      percentage: (19 / 21) * 100,
      in_review: 1,
    });
    validated[0] = window('incomplete');
    expect(computeCompliance(validated, 'UTC').totals.complete).toBe(18);
  });
  it.each(['pending', 'in_progress', 'late'] as const)(
    'no evalúa %s ni turnos cancelados',
    (status) => {
      expect(
        computeCompliance([window(status), window('complete', { shiftStatus: 'cancelled' })], 'UTC')
          .totals,
      ).toMatchObject({ evaluated: 0, percentage: null });
    },
  );
  it('separa observaciones medias y leves, validadas graves, demora y sincronización', () => {
    expect(
      computeCompliance(
        [
          window('complete'),
          window('complete', { severityLevel: 'media' }),
          window('complete', { severityLevel: 'leve' }),
          window('complete', { severityLevel: 'grave' }),
          window('complete_late'),
          window('pending_sync'),
        ],
        'UTC',
      ).totals,
    ).toMatchObject({
      complete: 5,
      withoutObservations: 1,
      media: 1,
      leve: 1,
      validated: 1,
      complete_late: 1,
      pending_sync: 1,
      percentage: 100,
    });
  });
  it.each(['no_show', 'closed', 'auto_closed', 'unassigned'])(
    'cuenta no realizada de %s, sin cobertura o cerrada sin datos',
    (shiftStatus) => {
      expect(computeCompliance([window('not_done', { shiftStatus })], 'UTC').totals).toMatchObject({
        not_done: 1,
        evaluated: 1,
        percentage: 0,
      });
    },
  );
  it('atribuye ausentes y desactivados y agrupa por fecha local al cruzar medianoche', () => {
    const result = computeCompliance([window('not_done')], 'America/Argentina/Buenos_Aires');
    expect(result.byGuard[0]).toMatchObject({
      id: 'g1',
      deactivated: true,
      totals: { not_done: 1 },
    });
    expect(result.daily[0]?.id).toBe('2026-10-01');
    expect(computeCompliance([window('not_done')], 'UTC').daily[0]?.id).toBe('2026-10-02');
  });
  it('usa windowOwner: borde exacto, reemplazada, sin dueño y sin vigilador', () => {
    const original = window('not_done');
    original.assignments.push({
      id: 'a2',
      startsAt: original.endsAt,
      result: 'started',
      guard: { id: 'g2', name: 'Ana', status: 'active' },
    });
    expect(complianceOwner(original)?.id).toBe('g1');
    const firstAssignment = original.assignments[0];
    if (!firstAssignment) throw new Error('Falta la asignación del fixture');
    firstAssignment.result = 'replaced';
    expect(complianceOwner(original)).toBeNull();
    for (const assignments of [
      [],
      [{ ...firstAssignment, result: 'started' as const, guard: null }],
    ]) {
      const result = computeCompliance([window('not_done', { assignments })], 'UTC');
      expect(result.bySite[0]?.totals.not_done).toBe(1);
      expect(result.byGuard).toMatchObject([{ id: null, name: 'Sin vigilador' }]);
    }
  });
});
