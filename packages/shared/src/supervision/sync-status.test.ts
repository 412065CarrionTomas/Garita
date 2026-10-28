import { computeSyncStatus } from './sync-status';

describe('computeSyncStatus', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const base = {
    now,
    lastContactAt: new Date('2026-10-21T09:59:00Z'),
    pendingCount: 0,
    syncedUntil: null,
    scheduledEndAt: new Date('2026-10-21T11:00:00Z'),
    syncDeadlineAt: null,
    withoutSignal: false,
    closed: false,
  };

  it('reports BDD 2 as no contact and preserves the last reported pending count', () => {
    expect(
      computeSyncStatus({
        ...base,
        lastContactAt: new Date('2026-10-21T09:45:00Z'),
        pendingCount: 7,
      }),
    ).toEqual({
      status: 'sin_contacto',
      since: new Date('2026-10-21T09:45:00Z'),
      pendingCount: 7,
    });
  });

  it('reports BDD 3 as waiting through the connectivity snapshot deadline', () => {
    const deadline = new Date('2026-10-21T14:20:00Z');
    expect(
      computeSyncStatus({
        ...base,
        lastContactAt: null,
        withoutSignal: true,
        syncDeadlineAt: deadline,
      }),
    ).toEqual({ status: 'esperando_hasta', deadline });
  });

  it('reports active sync, up to date, overdue, and completed states', () => {
    expect(computeSyncStatus({ ...base, pendingCount: 2 })).toEqual({
      status: 'sincronizando',
      pendingCount: 2,
    });
    expect(computeSyncStatus(base)).toEqual({ status: 'al_dia' });
    expect(
      computeSyncStatus({ ...base, syncDeadlineAt: new Date('2026-10-21T09:00:00Z') }),
    ).toEqual({ status: 'sin_sincronizar' });
    expect(
      computeSyncStatus({
        ...base,
        syncDeadlineAt: new Date('2026-10-21T09:00:00Z'),
        lastContactAt: new Date('2026-10-21T09:59:00Z'),
      }),
    ).toEqual({ status: 'sin_sincronizar' });
    expect(computeSyncStatus({ ...base, closed: true })).toEqual({ status: 'completo' });
    expect(computeSyncStatus({ ...base, closed: true, closedWithoutData: true })).toEqual({
      status: 'cerrado_sin_datos',
    });
  });
});
