import { screen, waitFor } from '@testing-library/react';
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
    expect(await screen.findByText('Predio A · 14/10/2030')).toBeInTheDocument();
    expect(screen.getByText('20:00–08:00')).toBeInTheDocument();
    expect(screen.getByText('Pedro Díaz · invitación pendiente')).toBeInTheDocument();
    expect(screen.getByText('Rondas: Perimetral')).toBeInTheDocument();
  });

  it('crea un turno válido y muestra sus cuatro ventanas esperadas', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderWithQueryClient(<ShiftsPanel />);
    await user.click(screen.getByRole('button', { name: 'Crear turno' }));
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
    await user.click(screen.getByRole('button', { name: 'Crear turno' }));
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
    await user.click(screen.getByRole('button', { name: 'Crear turno' }));
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
    expect(await screen.findByText('Solo se puede reasignar (HU-44).')).toBeInTheDocument();
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
    expect(unassigned.closest('article')).toHaveClass('bg-amber-50');
    await user.click(screen.getByRole('button', { name: 'Asignar vigilador' }));
    expect(screen.getByRole('dialog', { name: 'Editar turno' })).toBeInTheDocument();
  });
});
