import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MyShiftsScreen } from './my-shifts-screen';
import { apiGet } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const fetchShifts = jest.mocked(apiGet);

describe('<MyShiftsScreen />', () => {
  beforeEach(() => fetchShifts.mockClear());
  it('muestra los próximos turnos y permite actualizar', async () => {
    const shifts = [
      {
        id: 'shift-1',
        startsAt: '2030-10-14T23:00:00.000Z',
        endsAt: '2030-10-15T11:00:00.000Z',
        serviceDate: '2030-10-14T00:00:00.000Z',
        site: { name: 'Predio A', company: { timezone: 'America/Argentina/Buenos_Aires' } },
        rounds: [{ round: { name: 'Perimetral' } }],
      },
    ];
    const resolveRequests: (() => void)[] = [];
    fetchShifts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequests.push(() => resolve(shifts as never));
        }),
    );
    await render(<MyShiftsScreen />);
    await waitFor(() => expect(resolveRequests).toHaveLength(1));
    await act(async () => resolveRequests[0]?.());
    expect(await screen.findByText(/^Predio A/)).toBeOnTheScreen();
    expect(screen.getByText(/Perimetral/)).toBeOnTheScreen();
    expect(screen.getByText('Programado')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Ver turno en Predio A' }));
    });
    expect(mockPush).toHaveBeenCalledWith('/turno/shift-1');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Actualizar turnos' }));
      await waitFor(() => expect(resolveRequests).toHaveLength(2));
      resolveRequests[1]?.();
    });
    expect(fetchShifts).toHaveBeenCalledTimes(2);
  });

  it('informa si la consulta falla', async () => {
    let rejectInitial: (() => void) | undefined;
    fetchShifts.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectInitial = () => reject(new Error('sin conexión'));
        }),
    );
    await render(<MyShiftsScreen />);
    await waitFor(() => expect(rejectInitial).toBeDefined());
    await act(async () => {
      rejectInitial?.();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar los turnos/);
  });
});

it('distingue un turno en curso y conserva sus datos', async () => {
  fetchShifts.mockResolvedValue([
    {
      id: 'ongoing',
      status: 'in_progress',
      startsAt: '2030-10-14T23:00:00.000Z',
      endsAt: '2030-10-15T11:00:00.000Z',
      serviceDate: '2030-10-14',
      site: { name: 'Predio B', company: { timezone: 'America/Argentina/Buenos_Aires' } },
      rounds: [],
    },
  ] as never);
  await render(<MyShiftsScreen />);
  expect(await screen.findByText('En curso')).toBeOnTheScreen();
  expect(screen.getByText('20:00–08:00')).toBeOnTheScreen();
  expect(screen.getByText(/Día del turno:/)).toBeOnTheScreen();
});

it('conserva los estados de carga y vacío', async () => {
  let resolveRequest: ((value: never) => void) | undefined;
  fetchShifts.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );
  await render(<MyShiftsScreen />);
  expect(screen.getByRole('progressbar')).toHaveTextContent('Cargando turnos…');
  await act(async () => resolveRequest?.([] as never));
  expect(await screen.findByText('No tenés turnos próximos.')).toBeOnTheScreen();
});
