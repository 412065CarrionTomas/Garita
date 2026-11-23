import { screen, waitFor, within } from '@testing-library/react';
import {
  adminSummaryCatalog,
  computeCompliance,
  type ComplianceReport,
  type ViewLayout,
} from '@garita/shared';
import { ApiError, apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { SummaryPage } from './summary-page';

jest.mock('@/lib/api-client', () => {
  const actual: Record<string, unknown> = jest.requireActual('@/lib/api-client');
  return { ApiError: actual.ApiError, apiGet: jest.fn() };
});
// La geometría SVG depende del navegador: se prueban textos, tablas y estados.
jest.mock('recharts', () => {
  const Empty = () => null;
  return new Proxy({}, { get: () => Empty });
});

const compliance: ComplianceReport = {
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

let savedLayout: ViewLayout | null = null;
const failing = new Set<string>();

beforeEach(() => {
  savedLayout = null;
  failing.clear();
  jest.mocked(apiGet).mockClear();
  jest.mocked(apiGet).mockImplementation((path: string) => {
    const fail = [...failing].find((prefix) => path.startsWith(prefix));
    if (fail) return Promise.reject(new ApiError('falla', 500));
    if (path.startsWith('/mis-preferencias/vistas/admin-summary'))
      return Promise.resolve({
        layout: savedLayout,
        updatedAt: savedLayout ? '2026-11-23T10:00:00.000Z' : null,
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
  });
});

const section = (name: RegExp) => screen.getByRole('region', { name });

it('sin diseño guardado muestra el diseño A con datos reales de cada bloque', async () => {
  renderWithQueryClient(<SummaryPage />);
  expect(screen.getByRole('heading', { level: 1, name: 'Resumen de la empresa' })).toBeVisible();
  const attention = await screen.findByRole('region', { name: 'Atención ahora' });
  expect(await within(attention).findByText(/Depósito Sur · desde/)).toBeVisible();
  expect(within(attention).getByText('Rondas en revisión')).toBeVisible();
  expect(
    within(attention).getByRole('link', { name: /Atender: Alertas de pánico/ }),
  ).toHaveAttribute('href', '/alertas-panico');
  expect(
    await within(section(/Cumplimiento · 30 días/)).findByText('94,2 %', { selector: 'p > span' }),
  ).toBeVisible();
  expect(within(section(/Cumplimiento · 30 días/)).getByText('1 día bajo 90 %')).toBeVisible();
  const sites = section(/Predios · peor cumplimiento primero/);
  const rows = await within(sites).findAllByRole('row');
  expect(rows[1]).toHaveTextContent('Depósito Sur');
  expect(within(sites).getByText('Revisar')).toBeVisible();
  expect(await within(section(/Turnos de hoy/)).findByText('2 en total')).toBeVisible();
  expect(
    await within(section(/Incidentes · 30 días/)).findByText('2 sin clasificar'),
  ).toBeVisible();
  expect(within(section(/Incidentes · 30 días/)).queryByText('Accidente')).toBeNull();
  expect(await within(section(/Cuenta/)).findByText('18 / 20')).toBeVisible();
});

it('respeta el diseño guardado: bloques ocultos, presentación y ajustes', async () => {
  savedLayout = {
    version: adminSummaryCatalog.version,
    items: adminSummaryCatalog.defaultLayout.items.map((item) => {
      if (item.id === 'account') return { ...item, hidden: true };
      if (item.id === 'attention') return { ...item, presentation: 'column' };
      if (item.id === 'compliance')
        return { ...item, presentation: 'table', settings: { period: '7d' } };
      return item;
    }),
  };
  renderWithQueryClient(<SummaryPage />);
  const compliance = await screen.findByRole('region', { name: /Cumplimiento · 7 días/ });
  expect(await within(compliance).findByRole('table')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Cuenta' })).toBeNull();
  const attention = screen.getByRole('region', { name: 'Atención ahora' });
  expect(
    await within(attention).findByRole('link', { name: /Alertas de pánico: 1/ }),
  ).toBeVisible();
  await waitFor(() => {
    expect(jest.mocked(apiGet).mock.calls.some(([path]) => path.includes('/cuenta/estado'))).toBe(
      false,
    );
  });
});

it('si no puede leer el diseño, avisa y usa el de defecto', async () => {
  failing.add('/mis-preferencias');
  renderWithQueryClient(<SummaryPage />);
  expect(await screen.findByText(/No pudimos cargar tu diseño guardado/)).toBeVisible();
  expect(await screen.findByRole('region', { name: 'Atención ahora' })).toBeVisible();
});

it('un bloque que falla no afecta a los demás y permite reintentar', async () => {
  failing.add('/reportes/incidentes');
  renderWithQueryClient(<SummaryPage />);
  const incidents = await screen.findByRole('region', { name: /Incidentes · 30 días/ });
  expect(await within(incidents).findByRole('button', { name: 'Reintentar' })).toBeVisible();
  expect(
    await within(section(/Cumplimiento · 30 días/)).findByText('94,2 %', { selector: 'p > span' }),
  ).toBeVisible();
});
