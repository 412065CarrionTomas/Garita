import { screen, within, waitFor, fireEvent } from '@testing-library/react';
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
  Rectangle: () => null,
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
  localStorage.clear();
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
  const user = userEvent.setup();
  renderWithQueryClient(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('2 rondas en revisión: el cliente las ve como en verificación'),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Gráficos' }));
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
  await user.click(await screen.findByRole('button', { name: 'Gráficos' }));
  const button = await screen.findByRole('button', { name: 'Ver ventanas: Completas sin demora' });
  button.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('link', { name: 'Ver turno' })).toHaveAttribute(
    'href',
    '/supervision/turnos/s1',
  );
  // La lista de no realizadas pide solo ese estado y enlaza a la foja del turno.
  expect(await screen.findByRole('link', { name: /Ver foja/ })).toHaveAttribute(
    'href',
    '/supervision/turnos/s1',
  );
  expect(apiGet).toHaveBeenCalledWith(
    expect.stringContaining('estado=complete'),
    expect.anything(),
  );
});
it('envía filtros nativos usando teclado', async () => {
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
it('rechaza un período invertido antes de consultar la API', async () => {
  const user = userEvent.setup();
  renderWithQueryClient(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>,
  );
  await screen.findByText(/18 completas de 20/);
  jest.mocked(apiGet).mockClear();
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-12-01' } });
  screen.getByRole('button', { name: 'Consultar cumplimiento' }).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Ingresá un período válido');
  expect(apiGet).not.toHaveBeenCalled();
});

describe('vistas del cumplimiento', () => {
  function renderPage() {
    return renderWithQueryClient(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );
  }
  beforeEach(() => {
    report.bySite = [
      { id: 'p1', name: 'Depósito Ruta 9', totals: report.totals },
      { id: 'p2', name: 'Torre Alvear', totals: { ...report.totals, percentage: 80 } },
    ];
  });

  it('muestra por defecto la tabla por predio y sella REVISAR bajo 90%', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Cumplimiento por predio' });
    const rows = within(table).getAllByRole('row');
    const row = (index: number) => {
      const found = rows[index];
      if (!found) throw new Error(`Falta la fila ${index}`);
      return found;
    };
    expect(within(row(1)).queryByText('REVISAR')).not.toBeInTheDocument();
    expect(within(row(2)).getByText('REVISAR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tabla' })).toHaveAttribute('aria-pressed', 'true');
    await user_clickVer(row(2));
  });

  async function user_clickVer(row: HTMLElement) {
    await userEvent.click(within(row).getByRole('button', { name: /Ver ventanas/ }));
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('predio=p2'), expect.anything());
  }

  it('muestra la grilla por día y recuerda la última vista', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Grilla' }));
    expect(screen.getByRole('list', { name: 'Ventanas por día' })).toBeInTheDocument();
    expect(localStorage.getItem('garita-cumplimiento-vista')).toBe('grilla');
    first.unmount();
    renderPage();
    expect(await screen.findByRole('list', { name: 'Ventanas por día' })).toBeInTheDocument();
  });

  it('sigue funcionando si el almacenamiento falla', async () => {
    const user = userEvent.setup();
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Grilla' }));
    expect(screen.getByRole('button', { name: 'Grilla' })).toHaveAttribute('aria-pressed', 'true');
    jest.restoreAllMocks();
  });

  it('el período rápido consulta el rango elegido', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Cumplimiento por predio' });
    jest.mocked(apiGet).mockClear();
    await user.click(screen.getByRole('button', { name: '7 días' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        expect.stringMatching(/\/reportes\/rondas\?desde=\d{4}-\d{2}-\d{2}&hasta=/),
        expect.anything(),
      );
    });
    expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
  });
});
