import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ShiftsPage } from './shifts-page';

jest.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    body: unknown;
    constructor(message: string, status?: number, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
    status?: number;
  },
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiPatch: jest.fn(),
}));

const timezone = 'America/Argentina/Buenos_Aires';
const site = { id: 'site-1', name: 'Predio A', status: 'active', company: { timezone } };
const round = {
  id: 'round-1',
  name: 'Perimetral',
  status: 'active',
  currentVersion: { windowStartLocal: '22:00', windowEndLocal: '06:00', frequencyMinutes: 120 },
};
const days = [
  '2030-10-14',
  '2030-10-15',
  '2030-10-16',
  '2030-10-17',
  '2030-10-18',
  '2030-10-19',
  '2030-10-20',
];
const cell = (overrides: Record<string, unknown> = {}) => ({
  id: 'shift-1',
  status: 'scheduled',
  startsAt: '2030-10-14T23:00:00.000Z',
  endsAt: '2030-10-15T07:00:00.000Z',
  guard: { id: 'guard-1', name: 'Pedro Díaz' },
  origin: 'schedule',
  rounds: ['Perimetral'],
  ...overrides,
});
const boardWith = (cells: ReturnType<typeof cell>[][] = days.map(() => [])) => ({
  timezone,
  today: '2030-10-14',
  days,
  sites: [{ id: 'site-1', name: 'Predio A', days: cells }],
  summary: { total: 0, unassigned: 0, noShow: 0, uncovered: 0 },
});
const listRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'shift-1',
  siteId: 'site-1',
  startsAt: '2030-10-14T23:00:00.000Z',
  endsAt: '2030-10-15T11:00:00.000Z',
  serviceDate: '2030-10-14T00:00:00.000Z',
  status: 'scheduled',
  site,
  assignments: [
    { guard: { id: 'guard-1', firstName: 'Pedro', lastName: 'Díaz', status: 'active' } },
  ],
  rounds: [{ roundId: round.id, round }],
  ...overrides,
});

function mockQueries({
  board = boardWith(),
  list = [] as unknown[],
  neighbours = [] as unknown[],
  detail = listRow(),
} = {}) {
  jest.mocked(apiPost).mockResolvedValue({ id: 'created' });
  jest.mocked(apiGet).mockImplementation((path: string) => {
    if (path.startsWith('/turnos/planilla')) return Promise.resolve(board as never);
    if (path.startsWith('/turnos?predio=site-1&desde'))
      return Promise.resolve({ items: neighbours, total: neighbours.length } as never);
    if (path.startsWith('/turnos?'))
      return Promise.resolve({ items: list, total: list.length } as never);
    if (path.startsWith('/turnos/')) return Promise.resolve(detail as never);
    if (path.startsWith('/predios?')) return Promise.resolve([site] as never);
    if (path.startsWith('/predios/site-1/rondas')) return Promise.resolve([round] as never);
    if (path.startsWith('/usuarios'))
      return Promise.resolve({
        items: [{ id: 'guard-1', firstName: 'Pedro', lastName: 'Díaz', status: 'active' }],
      } as never);
    return Promise.resolve([] as never);
  });
}

function renderPage(url = '/turnos') {
  window.history.replaceState({}, '', url);
  return renderWithQueryClient(<ShiftsPage />);
}

async function fillNewShift(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  await user.selectOptions(screen.getByLabelText('Predio del turno'), 'site-1');
  await user.click(await screen.findByLabelText('Perimetral'));
  fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: '2030-10-14' } });
  fireEvent.change(screen.getByLabelText('Hora de inicio (24 h)'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Fecha de fin'), { target: { value: '2030-10-15' } });
  fireEvent.change(screen.getByLabelText('Hora de fin (24 h)'), { target: { value: end } });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', '/turnos');
  // Los menús de Radix miden su tamaño; jsdom no trae ResizeObserver.
  globalThis.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
});

describe('<ShiftsPage /> planilla', () => {
  it.each(['light', 'dark'])('usa superficies semánticas en tema %s', async (theme) => {
    mockQueries({ board: boardWith(days.map((_, i) => (i === 0 ? [cell()] : []))) });
    const { container } = renderWithQueryClient(
      <div className={theme}>
        <ShiftsPage />
      </div>,
    );
    const grid = await screen.findByRole('table', { name: 'Planilla semanal' });
    expect(within(grid).getByText('Pedro Díaz')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(
      /(?:bg|text|border)-(?:white|black|red|amber|gray|slate|zinc|blue|green)(?:-|\b)|#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i,
    );
  });

  it('muestra cada turno en su día, con horario local y su origen', async () => {
    mockQueries({ board: boardWith(days.map((_, i) => (i === 0 ? [cell()] : []))) });
    renderPage();
    const grid = await screen.findByRole('table', { name: 'Planilla semanal' });
    const row = within(grid).getByRole('row', { name: /Predio A/ });
    const [monday] = within(row).getAllByRole('cell');
    if (!monday) throw new Error('Falta la celda del lunes');
    expect(within(monday).getByText('Pedro Díaz')).toBeInTheDocument();
    expect(within(monday).getByText('20:00–04:00')).toBeInTheDocument();
    expect(
      within(monday).getByRole('img', { name: 'Generado por una programación' }),
    ).toBeVisible();
    expect(within(grid).getByRole('columnheader', { current: 'date' })).toHaveTextContent('lunes');
  });

  it('marca el hueco y lo cubre editando el turno si todavía no empezó', async () => {
    const gap = cell({ id: 'gap', status: 'unassigned', guard: null, origin: 'manual' });
    mockQueries({
      board: {
        ...boardWith(days.map((_, i) => (i === 1 ? [gap] : []))),
        summary: { total: 1, unassigned: 1, noShow: 0, uncovered: 0 },
      },
      detail: listRow({ id: 'gap', status: 'unassigned', assignments: [] }),
    });
    const user = userEvent.setup();
    renderPage();
    const grid = await screen.findByRole('table', { name: 'Planilla semanal' });
    expect(within(grid).getAllByText('Sin vigilador')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /1 huecos de 1 turnos/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cubrir' }));
    expect(await screen.findByRole('dialog', { name: 'Editar turno' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/turnos/gap', expect.anything());
  });

  it('agrega un turno en una celda vacía con predio y día ya elegidos', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole('button', {
        name: /Agregar turno en Predio A el martes,? 15 de octubre/,
      }),
    );
    expect(screen.getByLabelText('Predio del turno')).toHaveValue('site-1');
    expect(screen.getByLabelText('Fecha de inicio')).toHaveValue('2030-10-15');
  });

  it('guarda semana y filtros en la URL', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Semana siguiente' }));
    expect(window.location.search).toContain('semana=2030-10-21');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Predio' }), 'site-1');
    expect(window.location.search).toContain('predio=site-1');
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/turnos/planilla?semana=2030-10-21&predio=site-1',
        expect.anything(),
      );
    });
  });

  it('ofrece reintentar si falla la carga', async () => {
    mockQueries();
    const fallback = jest.mocked(apiGet).getMockImplementation();
    if (!fallback) throw new Error('Falta el mock de consultas');
    jest
      .mocked(apiGet)
      .mockImplementation((path, schema) =>
        path.startsWith('/turnos') ? Promise.reject(new Error('caído')) : fallback(path, schema),
      );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('<ShiftsPage /> lista', () => {
  it('muestra los turnos paginados con un solo sello de estado', async () => {
    mockQueries({
      list: [
        listRow({
          assignments: [
            {
              guard: {
                id: 'g',
                firstName: 'Pedro',
                lastName: 'Díaz',
                status: 'invitation_pending',
              },
            },
          ],
          scheduleId: 'schedule',
          individuallyModified: true,
        }),
      ],
    });
    renderPage('/turnos?vista=lista');
    const table = await screen.findByRole('table', { name: 'Turnos' });
    expect(within(table).getByText('Predio A')).toBeInTheDocument();
    expect(screen.getByText('20:00–08:00')).toBeInTheDocument();
    expect(screen.getByText('· invitación pendiente')).toBeInTheDocument();
    expect(screen.getByText('Programado')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'De una programación, editado a mano' }),
    ).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(
      '/turnos?pagina=1&porPagina=25&orden=inicio%3Adesc',
      expect.anything(),
    );
  });

  it('filtra por estado desde la barra única', async () => {
    mockQueries({ list: [listRow()] });
    const user = userEvent.setup();
    renderPage('/turnos?vista=lista');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Estado' }), 'problema');
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/turnos?pagina=1&porPagina=25&orden=inicio%3Adesc&estado=problema',
        expect.anything(),
      );
    });
  });

  it('cancela un turno futuro después de confirmar', async () => {
    mockQueries({ list: [listRow()] });
    const user = userEvent.setup();
    renderPage('/turnos?vista=lista');
    await user.click(await screen.findByRole('button', { name: 'Acciones del turno de Predio A' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cancelar turno' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/turnos/shift-1/cancelar',
        {},
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('un turno ya iniciado no se edita ni se cancela', async () => {
    mockQueries({
      list: [listRow({ startsAt: '2020-10-14T23:00:00.000Z', endsAt: '2020-10-15T11:00:00.000Z' })],
    });
    const user = userEvent.setup();
    renderPage('/turnos?vista=lista');
    await user.click(await screen.findByRole('button', { name: 'Acciones del turno de Predio A' }));
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancelar turno' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Ver detalle' })).toBeInTheDocument();
  });
});

describe('<ShiftsPage /> formulario', () => {
  it('crea un turno válido y muestra sus cuatro ventanas esperadas', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    await fillNewShift(user, '20:00', '08:00');
    const windows = screen.getByText('Ventanas esperadas: 4').parentElement;
    for (const label of ['22:00–00:00', '00:00–02:00', '02:00–04:00', '04:00–06:00'])
      expect(windows).toHaveTextContent(label);
    await user.click(screen.getByRole('button', { name: 'Guardar turno' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/turnos',
        expect.objectContaining({ siteId: 'site-1', roundIds: ['round-1'] }),
        expect.anything(),
        expect.anything(),
      );
    });
    expect(await screen.findByText('Turno creado.')).toBeInTheDocument();
  });

  it('avisa cuando el predio no tiene rondas activas', async () => {
    mockQueries();
    const fallback = jest.mocked(apiGet).getMockImplementation();
    if (!fallback) throw new Error('Falta el mock de consultas');
    jest
      .mocked(apiGet)
      .mockImplementation((path, schema) =>
        path.startsWith('/predios/site-1/rondas')
          ? Promise.resolve([] as never)
          : fallback(path, schema),
      );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    await user.selectOptions(screen.getByLabelText('Predio del turno'), 'site-1');
    expect(await screen.findByText(/no tiene rondas activas/)).toBeInTheDocument();
  });

  it.each([
    ['in_progress', false],
    ['closed', false],
    ['cancelled', true],
  ])('con un turno vecino %s, avisar ventanas sin cubrir = %s', async (status, warns) => {
    mockQueries({
      neighbours: [
        listRow({
          id: 'covering',
          startsAt: '2030-10-15T04:00:00.000Z',
          endsAt: '2030-10-15T09:00:00.000Z',
          status,
        }),
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    await fillNewShift(user, '21:00', '01:00');
    if (warns)
      expect(await screen.findByText(/no quedan cubiertas/)).toHaveTextContent('00:00–02:00');
    else {
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledWith(
          expect.stringMatching(/^\/turnos\?predio=site-1&desde/),
          expect.anything(),
        );
      });
      expect(screen.queryByText(/no quedan cubiertas/)).not.toBeInTheDocument();
    }
  });

  it('muestra el turno que causa una superposición', async () => {
    mockQueries();
    jest.mocked(apiPost).mockRejectedValueOnce(
      new ApiError('conflicto', 409, {
        code: 'SHIFT_OVERLAP',
        shift: { site: { name: 'Predio ocupado' } },
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    await fillNewShift(user, '20:00', '08:00');
    await user.selectOptions(screen.getByLabelText('Vigilador del turno'), 'guard-1');
    await user.click(screen.getByRole('button', { name: 'Guardar turno' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Turno en conflicto: Predio ocupado',
    );
  });
});
