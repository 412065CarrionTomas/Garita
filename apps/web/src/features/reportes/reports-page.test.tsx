import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { computeCompliance, type ComplianceReport } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ReportsPage } from './reports-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
// La geometría SVG depende del layout del navegador; las tablas y acciones se prueban completas.
jest.mock('recharts', () => ({
  ResponsiveContainer: () => null,
  Bar: () => null,
  BarChart: () => null,
  Line: () => null,
  LineChart: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));
const report: ComplianceReport = {
  ...computeCompliance([], 'UTC'),
  desde: '2026-10-01',
  hasta: '2026-11-01',
  timezone: 'UTC',
  filters: {
    sites: [{ id: 'p1', name: 'Depósito Ruta 9' }],
    clients: [{ id: 'c1', name: 'Cliente norte' }],
    guards: [{ id: 'g1', name: 'Pedro' }],
  },
};
report.totals = {
  ...report.totals,
  complete: 18,
  incomplete: 1,
  not_done: 1,
  evaluated: 20,
  percentage: 90,
  in_review: 2,
};
report.daily = [{ id: '2026-10-01', name: '2026-10-01', totals: report.totals }];
report.bySite = [{ id: 'p1', name: 'Depósito Ruta 9', totals: report.totals }];
report.byGuard = [{ id: 'g1', name: 'Pedro', deactivated: true, totals: report.totals }];
beforeEach(() => {
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path.includes('/rondas/detalle'))
      return Promise.resolve({
        total: 1,
        page: 1,
        pageSize: 25,
        items: [
          {
            id: 'w1',
            shiftId: 's1',
            roundName: 'Perimetral',
            site: { id: 'p1', name: 'Depósito Ruta 9' },
            guard: null,
            startsAt: '2026-10-01T10:00:00Z',
            endsAt: '2026-10-01T12:00:00Z',
            status: 'complete',
          },
        ],
      });
    if (path.includes('/pendientes'))
      return Promise.resolve({
        inReview: { count: 2, oldestAt: null },
        incidents: { count: 0, oldestAt: null },
        unsynced: { count: 1, oldestAt: '2026-10-01T00:00:00Z' },
        unassigned: { count: 1, nextAt: '2026-12-01T00:00:00Z' },
        message: 'El cliente ve las rondas en revisión como en verificación',
      });
    if (path.includes('/puntos-marcas'))
      return Promise.resolve({
        items: [
          {
            id: 'cp1',
            name: 'Galpón 3',
            site: { id: 'p1', name: 'Depósito Ruta 9' },
            validRecords: 4,
            markedRecords: 4,
            proportion: 1,
            guardCount: 4,
            distribution: 'distributed',
          },
        ],
      });
    return Promise.resolve(report);
  });
});
it('cada gráfico tiene título y tabla equivalente, aviso y pendientes con accesos', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('2 rondas en revisión: el cliente las ve como en verificación'),
  ).toBeInTheDocument();
  for (const title of [
    'Porcentaje de cumplimiento',
    'Rondas por estado',
    'Evolución diaria del cumplimiento',
    'Comparación de cumplimiento por predio',
    'Comparación de cumplimiento por vigilador',
  ]) {
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: title })).toBeInTheDocument();
  }
  expect(
    within(screen.getByRole('table', { name: 'Porcentaje de cumplimiento' })).getByText('90 %'),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Repartidas entre 4 vigiladores/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '1 turnos sin sincronizar' })).toHaveAttribute(
    'href',
    '/avisos?tipo=shift_unsynced',
  );
});
it('selecciona un segmento con teclado y muestra las ventanas y el enlace al turno', async () => {
  const user = userEvent.setup();
  renderWithQueryClient(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>,
  );
  const button = await screen.findByRole('button', { name: 'Ver ventanas: Completas sin demora' });
  button.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('link', { name: 'Ver turno' })).toHaveAttribute(
    'href',
    '/supervision/turnos/s1',
  );
  expect(apiGet).toHaveBeenCalledWith(
    expect.stringContaining('estado=complete'),
    expect.anything(),
  );
});
it('envía filtros nativos usando teclado y rechaza períodos inválidos', async () => {
  const user = userEvent.setup();
  renderWithQueryClient(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>,
  );
  await screen.findByText(/18 completas de 20/);
  screen.getByLabelText('Predio').focus();
  await user.selectOptions(screen.getByLabelText('Predio'), 'p1');
  await user.selectOptions(screen.getByLabelText('Cliente'), 'c1');
  await user.selectOptions(screen.getByLabelText('Vigilador'), 'g1');
  screen.getByRole('button', { name: 'Consultar cumplimiento' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith(
      expect.stringContaining('predio=p1&cliente=c1&vigilador=g1'),
      expect.anything(),
    );
  });
});
