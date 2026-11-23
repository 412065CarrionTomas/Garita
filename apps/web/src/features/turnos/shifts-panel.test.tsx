import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ShiftsPanel } from './shifts-panel';

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

const site = {
  id: 'site-1',
  name: 'Predio A',
  status: 'active',
  company: { timezone: 'America/Argentina/Buenos_Aires' },
};
const round = {
  id: 'round-1',
  name: 'Perimetral',
  status: 'active',
  currentVersion: { windowStartLocal: '22:00', windowEndLocal: '06:00', frequencyMinutes: 120 },
};
function mockQueries(shifts: unknown[] = []) {
  jest.mocked(apiPost).mockResolvedValue({ id: 'created' });
  jest.mocked(apiGet).mockImplementation((path: string) => {
    if (path.startsWith('/turnos')) return Promise.resolve(shifts as never);
    if (path.startsWith('/predios?')) return Promise.resolve([site] as never);
    if (path.startsWith('/predios/site-1/rondas')) return Promise.resolve([round] as never);
    if (path.startsWith('/usuarios'))
      return Promise.resolve({
        items: [{ id: 'guard-1', firstName: 'Pedro', lastName: 'Díaz', status: 'active' }],
      } as never);
    return Promise.resolve([] as never);
  });
}

describe('<ShiftsPanel />', () => {
  it.each(['light', 'dark'])('usa superficies semánticas en tema %s', async (theme) => {
    mockQueries();
    const { container } = renderWithQueryClient(
      <div className={theme}>
        <ShiftsPanel />
      </div>,
    );
    expect(await screen.findByRole('heading', { name: 'Turnos' })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(
      /(?:bg|text|border)-(?:white|black|red|amber|gray|slate|zinc|blue|green)(?:-|\b)|#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i,
    );
  });

  // La forma del sello (variante) distingue el estado además del color.
  it.each([
    ['scheduled', 'Programado', 'dashed'],
    ['unassigned', 'Sin asignar', 'late'],
    ['in_progress', 'En curso', 'normal'],
    ['closed', 'Cerrado', 'normal'],
    ['auto_closed', 'Cerrado por el sistema', 'late'],
    ['cancelled', 'Cancelado', 'dashed'],
    ['no_show', 'No presentado', 'late'],
    ['uncovered', 'Sin cobertura', 'late'],
    ['future_status', 'Estado desconocido', 'dashed'],
  ])('valida y muestra el estado %s con sello %s', async (status, label, variant) => {
    mockQueries();
    const fallback = jest.mocked(apiGet).getMockImplementation();
    jest.mocked(apiGet).mockImplementation((path, schema) => {
      if (path.startsWith('/turnos'))
        return Promise.resolve(
          schema.parse([
            {
              id: 'shift-status',
              siteId: site.id,
              startsAt: '2030-10-14T23:00:00.000Z',
              endsAt: '2030-10-15T11:00:00.000Z',
              serviceDate: '2030-10-14T00:00:00.000Z',
              status,
              site,
              assignments: [],
              rounds: [],
            },
          ]) as never,
        );
      if (!fallback) throw new Error('Falta el mock de consultas');
      return fallback(path, schema);
    });
    renderWithQueryClient(<ShiftsPanel />);
    const table = await screen.findByRole('table', { name: 'Turnos' });
    expect(within(table).getByText(label)).toHaveAttribute('data-variant', variant);
  });

  it('muestra turnos en hora local e indica una invitación pendiente', async () => {
    jest.mocked(apiGet).mockImplementation((path: string) => {
      if (path.startsWith('/turnos'))
        return Promise.resolve([
          {
            id: 'shift-1',
            siteId: 'site-1',
            startsAt: '2030-10-14T23:00:00.000Z',
            endsAt: '2030-10-15T11:00:00.000Z',
            serviceDate: '2030-10-14T00:00:00.000Z',
            status: 'scheduled',
            site: { name: 'Predio A', company: { timezone: 'America/Argentina/Buenos_Aires' } },
            assignments: [
              { guard: { firstName: 'Pedro', lastName: 'Díaz', status: 'invitation_pending' } },
            ],
            rounds: [{ round: { name: 'Perimetral' } }],
          },
        ] as never);
      if (path.startsWith('/predios')) return Promise.resolve([] as never);
      return Promise.resolve({ items: [] } as never);
    });
    renderWithQueryClient(<ShiftsPanel />);
    expect(await screen.findByText('Predio A')).toBeInTheDocument();
    expect(screen.getByText('14/10/2030')).toBeInTheDocument();
    expect(screen.getByText('20:00–08:00')).toBeInTheDocument();
    expect(screen.getByText('Pedro Díaz · invitación pendiente')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Perimetral' })).toBeInTheDocument();
  });

  it('crea un turno válido y muestra sus cuatro ventanas esperadas', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderWithQueryClient(<ShiftsPanel />);
    await user.click(screen.getByRole('button', { name: 'Nuevo turno' }));
    await user.selectOptions(screen.getByLabelText('Predio del turno'), 'site-1');
    await user.click(await screen.findByLabelText('Perimetral'));
    await user.type(screen.getByLabelText('Fecha de inicio'), '2030-10-14');
    await user.clear(screen.getByLabelText('Hora de inicio (24 h)'));
    await user.type(screen.getByLabelText('Hora de inicio (24 h)'), '20:00');
    await user.type(screen.getByLabelText('Fecha de fin'), '2030-10-15');
    await user.clear(screen.getByLabelText('Hora de fin (24 h)'));
    await user.type(screen.getByLabelText('Hora de fin (24 h)'), '08:00');
    expect(screen.getByText('Ventanas esperadas del turno').parentElement).toHaveTextContent(
      '22:00–00:00',
    );
    expect(screen.getByText('Ventanas esperadas del turno').parentElement).toHaveTextContent(
      '00:00–02:00',
    );
    expect(screen.getByText('Ventanas esperadas del turno').parentElement).toHaveTextContent(
      '02:00–04:00',
    );
    expect(screen.getByText('Ventanas esperadas del turno').parentElement).toHaveTextContent(
      '04:00–06:00',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar turno' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/turnos',
        expect.objectContaining({ siteId: 'site-1', roundIds: ['round-1'] }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('advierte una ventana sin cobertura y deja guardar el turno', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderWithQueryClient(<ShiftsPanel />);
    await user.click(screen.getByRole('button', { name: 'Nuevo turno' }));
    await user.selectOptions(screen.getByLabelText('Predio del turno'), 'site-1');
    await user.click(await screen.findByLabelText('Perimetral'));
    await user.type(screen.getByLabelText('Fecha de inicio'), '2030-10-14');
    await user.clear(screen.getByLabelText('Hora de inicio (24 h)'));
    await user.type(screen.getByLabelText('Hora de inicio (24 h)'), '21:00');
    await user.type(screen.getByLabelText('Fecha de fin'), '2030-10-15');
    await user.clear(screen.getByLabelText('Hora de fin (24 h)'));
    await user.type(screen.getByLabelText('Hora de fin (24 h)'), '01:00');
    expect(screen.getByRole('status')).toHaveTextContent('00:00–02:00');
    expect(screen.getByRole('status')).toHaveTextContent('Podés guardar igual');
    await user.click(screen.getByRole('button', { name: 'Guardar turno' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalled();
    });
  });

  it.each(['in_progress', 'closed', 'auto_closed', 'cancelled'])(
    'conserva la cobertura de ventanas para %s',
    async (status) => {
      mockQueries([
        {
          id: 'covering',
          siteId: site.id,
          startsAt: '2030-10-15T04:00:00.000Z',
          endsAt: '2030-10-15T09:00:00.000Z',
          serviceDate: '2030-10-15T00:00:00.000Z',
          status,
          site,
          assignments: [],
          rounds: [{ roundId: round.id, round }],
        },
      ]);
      const user = userEvent.setup();
      renderWithQueryClient(<ShiftsPanel />);
      await user.click(screen.getByRole('button', { name: 'Nuevo turno' }));
      await user.selectOptions(screen.getByLabelText('Predio del turno'), site.id);
      await user.click(await screen.findByLabelText('Perimetral'));
      fireEvent.change(screen.getByLabelText('Fecha de inicio'), {
        target: { value: '2030-10-14' },
      });
      fireEvent.change(screen.getByLabelText('Hora de inicio (24 h)'), {
        target: { value: '21:00' },
      });
      fireEvent.change(screen.getByLabelText('Fecha de fin'), { target: { value: '2030-10-15' } });
      fireEvent.change(screen.getByLabelText('Hora de fin (24 h)'), { target: { value: '01:00' } });
      if (status === 'cancelled')
        expect(screen.getByRole('status')).toHaveTextContent('00:00–02:00');
      else expect(screen.queryByText(/Advertencia: estas ventanas/)).not.toBeInTheDocument();
    },
  );

  it('muestra el turno que causa una superposición', async () => {
    mockQueries();
    jest.mocked(apiPost).mockRejectedValueOnce(
      new ApiError('conflicto', 409, {
        code: 'SHIFT_OVERLAP',
        shift: { site: { name: 'Predio ocupado' } },
      }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<ShiftsPanel />);
    await user.click(screen.getByRole('button', { name: 'Nuevo turno' }));
    await user.selectOptions(screen.getByLabelText('Predio del turno'), 'site-1');
    await user.click(await screen.findByLabelText('Perimetral'));
    await user.type(screen.getByLabelText('Fecha de inicio'), '2030-10-14');
    await user.clear(screen.getByLabelText('Hora de inicio (24 h)'));
    await user.type(screen.getByLabelText('Hora de inicio (24 h)'), '20:00');
    await user.type(screen.getByLabelText('Fecha de fin'), '2030-10-15');
    await user.clear(screen.getByLabelText('Hora de fin (24 h)'));
    await user.type(screen.getByLabelText('Hora de fin (24 h)'), '08:00');
    await user.selectOptions(screen.getByLabelText('Vigilador del turno'), 'guard-1');
    await user.click(screen.getByRole('button', { name: 'Guardar turno' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Turno en conflicto: Predio ocupado',
    );
  });

  it('indica que un turno iniciado solo se puede reasignar', async () => {
    mockQueries([
      {
        id: 'shift-old',
        siteId: 'site-1',
        startsAt: '2020-10-14T23:00:00.000Z',
        endsAt: '2020-10-15T11:00:00.000Z',
        serviceDate: '2020-10-14T00:00:00.000Z',
        status: 'scheduled',
        site: { name: 'Predio A', company: { timezone: 'America/Argentina/Buenos_Aires' } },
        assignments: [],
        rounds: [],
      },
    ]);
    renderWithQueryClient(<ShiftsPanel />);
    expect(await screen.findByText('El turno ya comenzó.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar turno' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).not.toBeInTheDocument();
  });

  it('destaca y permite asignar un turno sin vigilador', async () => {
    mockQueries([
      {
        id: 'shift-unassigned',
        siteId: 'site-1',
        startsAt: '2030-10-14T23:00:00.000Z',
        endsAt: '2030-10-15T11:00:00.000Z',
        serviceDate: '2030-10-14T00:00:00.000Z',
        status: 'unassigned',
        site: { name: 'Predio A', company: { timezone: 'America/Argentina/Buenos_Aires' } },
        assignments: [],
        rounds: [],
      },
    ]);
    const user = userEvent.setup();
    renderWithQueryClient(<ShiftsPanel />);
    const unassigned = await screen.findByText('Sin vigilador');
    expect(unassigned.closest('tr')).toHaveClass('bg-warning-soft');
    await user.click(screen.getByRole('button', { name: 'Asignar vigilador' }));
    expect(screen.getByRole('dialog', { name: 'Editar turno' })).toBeInTheDocument();
  });
});

describe('<ShiftsPanel /> filtros y estados', () => {
  const shift = (id: string, status: string) => ({
    id,
    siteId: 'site-1',
    startsAt: '2030-10-14T23:00:00.000Z',
    endsAt: '2030-10-15T11:00:00.000Z',
    serviceDate: '2030-10-14T00:00:00.000Z',
    status,
    site: { name: `Predio ${id}`, company: { timezone: 'America/Argentina/Buenos_Aires' } },
    assignments: [],
    rounds: [],
  });

  it('filtra por estado y avisa cuando no hay turnos', async () => {
    mockQueries([shift('uno', 'in_progress'), shift('dos', 'cancelled')]);
    const user = userEvent.setup();
    renderWithQueryClient(<ShiftsPanel />);
    expect(await screen.findByText('Predio uno')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelados' }));
    expect(screen.queryByText('Predio uno')).not.toBeInTheDocument();
    expect(screen.getByText('Predio dos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finalizados' }));
    expect(screen.getByText('Sin turnos en este estado')).toBeInTheDocument();
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
    renderWithQueryClient(<ShiftsPanel />);
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
