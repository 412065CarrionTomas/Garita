import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { computeIncidentReport, computeResponseTimes, computePanicReport } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { renderWithQueryClient } from '@/test/render';
import { IncidentReportsPage } from './incident-reports-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('@/features/auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('recharts', () => ({
  ResponsiveContainer: () => null,
  Bar: () => null,
  BarChart: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));
const period = { desde: '2026-10-01', hasta: '2026-11-01', timezone: 'UTC' };
const incidentReport = {
  ...period,
  ...computeIncidentReport(
    [
      {
        type: 'intrusion',
        classificationStatus: 'pending',
        site: { id: 'p', name: 'Depósito' },
        occurredAtDevice: '2026-10-01T02:00:00Z',
        trustedAt: null,
        receivedAt: '2026-10-01T02:00:00Z',
      },
    ],
    'UTC',
    new Date('2026-10-03T02:00:00Z'),
  ),
  filters: { sites: [{ id: 'p', name: 'Depósito' }], clients: [{ id: 'c', name: 'Cliente' }] },
};
const response = computeResponseTimes(
  [
    {
      site: { id: 'p', name: 'Depósito' },
      triggeredAt: '2026-10-01T03:10:00Z',
      confirmedAt: '2026-10-01T03:27:00Z',
      confirmedBy: { id: 's', name: 'Ana' },
      escalatedAt: '2026-10-01T03:26:00Z',
    },
  ],
  [],
  [],
);
let role: 'admin' | 'supervisor';
beforeEach(() => {
  role = 'admin';
  jest
    .mocked(useAuth)
    .mockImplementation(() => ({ user: { role }, loading: false }) as ReturnType<typeof useAuth>);
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path.includes('/detalle'))
      return Promise.resolve({
        total: 1,
        page: 1,
        pageSize: 25,
        items: [
          {
            id: 'i1',
            site: { id: 'p', name: 'Depósito' },
            type: 'intrusion',
            classificationStatus: 'pending',
            occurredAt: '2026-10-01T02:00:00Z',
          },
        ],
      });
    if (path.includes('/tiempos-de-respuesta'))
      return Promise.resolve(
        role === 'admin'
          ? { ...period, ...response }
          : {
              ...period,
              totals: response.totals,
              bySite: response.bySite,
              own: response.bySupervisor[0],
            },
      );
    if (path.includes('/panico')) return Promise.resolve({ ...period, ...computePanicReport([]) });
    return Promise.resolve(incidentReport);
  });
});
function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <IncidentReportsPage />
    </MemoryRouter>,
  );
}
it('cada gráfico tiene título y tabla; muestra antigüedad, escaladas y comparación del administrador', async () => {
  renderPage();
  await screen.findByRole('table', { name: 'Incidentes por tipo' });
  for (const title of [
    'Incidentes por tipo',
    'Incidentes por franja de dos horas',
    'Incidentes por predio',
    'Incidentes por clasificación',
    'Pánico por resultado',
    'Pánico por canal',
  ]) {
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: title })).toBeInTheDocument();
  }
  expect(
    screen.getByText(/1 incidentes pendientes de clasificar, el más antiguo de hace 2 días/),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Abrir cola de clasificación' })).toHaveAttribute(
    'href',
    '/incidentes/cola',
  );
  expect(screen.getByText('1 alertas escaladas')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Comparación por supervisor' })).toBeInTheDocument();
});
it('supervisor ve Tus tiempos sin comparación', async () => {
  role = 'supervisor';
  renderPage();
  expect(await screen.findByRole('table', { name: 'Tus tiempos' })).toBeInTheDocument();
  expect(
    screen.queryByRole('table', { name: 'Comparación por supervisor' }),
  ).not.toBeInTheDocument();
});
it('selecciona un segmento con Enter y enlaza el incidente', async () => {
  const user = userEvent.setup();
  renderPage();
  const table = await screen.findByRole('table', { name: 'Incidentes por tipo' });
  within(table).getByRole('button', { name: 'Ver detalle: Intrusión' }).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('link', { name: /Depósito · Intrusión/ })).toHaveAttribute(
    'href',
    '/incidentes/i1',
  );
  expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('tipo=intrusion'), expect.anything());
});
it('filtros y períodos operan con teclado; período inválido muestra error sin consultar', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('table', { name: 'Incidentes por tipo' });
  await user.selectOptions(screen.getByLabelText('Predio'), 'p');
  await user.selectOptions(screen.getByLabelText('Cliente'), 'c');
  screen.getByRole('button', { name: 'Consultar reportes' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith(
      expect.stringContaining('predio=p&cliente=c'),
      expect.anything(),
    );
  });
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2027-01-01' } });
  screen.getByRole('button', { name: 'Consultar reportes' }).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Ingresá un período válido');
  screen.getByRole('button', { name: '7 días' }).focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
});
it('recupera un error de consulta con Reintentar', async () => {
  jest.mocked(apiGet).mockRejectedValueOnce(new Error('Sin red'));
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('table', { name: 'Incidentes por tipo' })).toBeInTheDocument();
});
