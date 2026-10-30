import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ShiftDetailPage } from '@/features/supervision/shift-detail-page';

jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock('react-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/test/react-router'),
  useParams: () => ({ id: 's1' }),
}));
const detail = {
  id: 's1',
  site: {
    id: 'p1',
    name: 'Campo Los Álamos',
    connectivityType: 'without_signal',
    minutesToSignal: 200,
  },
  status: 'auto_closed',
  scheduled: { startsAt: '2030-01-01T13:00:00Z', endsAt: '2030-01-01T15:00:00Z' },
  actual: {
    startedAt: '2030-01-01T13:00:00Z',
    closedAt: null,
    closedEarly: false,
    closeReason: null,
    closedBy: null,
  },
  phoneWithoutNfc: false,
  assignments: [],
  rounds: [],
  windows: [],
  points: [],
  route: [],
  records: [],
  rejectedAttempts: [],
  canCover: false,
};

it.each([
  ['shift_unsynced', 'open', 's1', true],
  ['shift_unsynced', 'resolved', 's1', false],
  ['round_missed', 'open', 's1', false],
  ['shift_unsynced', 'open', 's2', false],
])(
  'muestra cierre solo con aviso sin sincronizar abierto del turno (%s, %s, %s)',
  async (kind, status, shiftId, visible) => {
    let notices = [{ id: 'n1', kind, status, shiftId }];
    jest
      .mocked(apiGet)
      .mockImplementation((path) =>
        Promise.resolve(
          (path.startsWith('/avisos')
            ? { items: notices, openCount: 1, unseenOpenCount: 1 }
            : detail) as never,
        ),
      );
    jest.mocked(apiPost).mockImplementation(() => {
      notices = [];
      return Promise.resolve({
        shiftId: 's1',
        closedWithoutDataAt: '2030-01-01T18:20:00Z',
        closedWithoutDataById: 'u1',
        reason: 'Celular roto',
      });
    });
    renderWithQueryClient(
      <MemoryRouter>
        <ShiftDetailPage />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Turno en Campo Los Álamos' });
    if (!visible) {
      expect(screen.queryByRole('button', { name: 'Cerrar sin datos' })).not.toBeInTheDocument();
      return;
    }
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sin datos' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(screen.getByLabelText('Motivo del cierre'), 'Celular roto');
    await userEvent.click(screen.getByLabelText('Confirmo el cierre sin datos de este turno'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar sin datos' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Cerrar sin datos' })).not.toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith(
      '/turnos/s1/cerrar-sin-datos',
      { reason: 'Celular roto' },
      expect.anything(),
      expect.anything(),
    );
  },
);
