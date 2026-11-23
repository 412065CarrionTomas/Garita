import { computeCompliance, type ComplianceReport, type ViewLayout } from '@garita/shared';
import { ApiError } from '@/lib/api-client';

/*
 * Respuestas de la API que usa el Resumen, para los tests de la pantalla. `state` permite que
 * cada test elija el diseño guardado y qué rutas fallan.
 */

export const compliance: ComplianceReport = {
  ...computeCompliance([], 'UTC'),
  desde: '2026-10-25',
  hasta: '2026-11-24',
  timezone: 'UTC',
  filters: { sites: [], clients: [], guards: [] },
};
compliance.totals = {
  ...compliance.totals,
  complete: 412,
  complete_late: 41,
  incomplete: 14,
  not_done: 11,
  evaluated: 437,
  percentage: 94.2,
};
compliance.daily = [
  { id: '2026-11-22', name: '2026-11-22', totals: { ...compliance.totals, percentage: 86 } },
  { id: '2026-11-23', name: '2026-11-23', totals: compliance.totals },
];
compliance.bySite = [
  { id: 'p1', name: 'Depósito Sur', totals: { ...compliance.totals, percentage: 82.4 } },
  { id: 'p2', name: 'Oficinas Centro', totals: { ...compliance.totals, percentage: 98.2 } },
];

export function createSummaryApi() {
  const state = {
    savedLayout: null as ViewLayout | null,
    updatedAt: '2026-11-23T10:00:00.000Z',
    failing: new Set<string>(),
  };
  function respond(path: string): Promise<unknown> {
    const fail = [...state.failing].find((prefix) => path.startsWith(prefix));
    if (fail) return Promise.reject(new ApiError('falla', 500));
    if (path.startsWith('/mis-preferencias/vistas/admin-summary'))
      return Promise.resolve({
        layout: state.savedLayout,
        updatedAt: state.savedLayout ? state.updatedAt : null,
      });
    if (path.startsWith('/alertas-panico'))
      return Promise.resolve({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            site: { id: 'p1', name: 'Depósito Sur' },
            triggeredAt: '2026-11-23T13:02:00.000Z',
          },
        ],
        total: 1,
        activeCount: 1,
        page: 1,
        pageSize: 25,
      });
    if (path.startsWith('/avisos'))
      return Promise.resolve({ items: [], openCount: 0, unseenOpenCount: 0 });
    if (path.startsWith('/reportes/pendientes'))
      return Promise.resolve({
        inReview: { count: 3, oldestAt: '2026-11-23T08:40:00.000Z' },
        incidents: { count: 2, oldestAt: '2026-11-23T11:15:00.000Z' },
        unsynced: { count: 0, oldestAt: null },
        unassigned: { count: 1, nextAt: '2026-11-23T17:00:00.000Z' },
        message: '',
      });
    if (path.startsWith('/reportes/rondas')) return Promise.resolve(compliance);
    if (path.startsWith('/reportes/incidentes'))
      return Promise.resolve({
        desde: '2026-10-25',
        hasta: '2026-11-24',
        timezone: 'UTC',
        total: 8,
        byType: [
          { id: 'intrusion', name: 'Intrusión', value: 3 },
          { id: 'suspicious_person', name: 'Persona sospechosa', value: 5 },
          { id: 'accident', name: 'Accidente', value: 0 },
        ],
        byTimeBand: [],
        bySite: [],
        byClassification: [],
        pending: { count: 2, oldestAt: null, oldestAgeMs: null },
        filters: { sites: [], clients: [] },
      });
    if (path.startsWith('/supervision/turnos'))
      return Promise.resolve([
        {
          id: 's1',
          site: { id: 'p1', name: 'Depósito Sur' },
          startsAt: '2026-11-23T09:00:00Z',
          endsAt: '2026-11-23T17:00:00Z',
          status: 'in_progress',
          syncStatus: null,
          assignment: null,
          windows: {},
        },
        {
          id: 's2',
          site: { id: 'p2', name: 'Planta Este' },
          startsAt: '2026-11-23T17:00:00Z',
          endsAt: '2026-11-24T01:00:00Z',
          status: 'uncovered',
          syncStatus: null,
          assignment: null,
          windows: {},
        },
      ]);
    if (path.startsWith('/cuenta/estado'))
      return Promise.resolve({
        status: 'active',
        suspensionReason: null,
        trialEndsAt: null,
        trialDaysLeft: null,
        graceEndsAt: null,
        graceDaysLeft: null,
        amountDue: null,
        guardLimit: 20,
        guardsCounted: 18,
      });
    return Promise.reject(new Error(`ruta sin mock: ${path}`));
  }
  function reset() {
    state.savedLayout = null;
    state.updatedAt = '2026-11-23T10:00:00.000Z';
    state.failing.clear();
  }
  return { state, respond, reset };
}
