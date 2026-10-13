import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MyShiftsScreen } from './my-shifts-screen';
import { apiGet } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));

const fetchShifts = jest.mocked(apiGet);

describe('<MyShiftsScreen />', () => {
  it('muestra los próximos turnos y permite actualizar', async () => {
    fetchShifts.mockResolvedValue([
      {
        id: 'shift-1',
        startsAt: '2030-10-14T23:00:00.000Z',
        endsAt: '2030-10-15T11:00:00.000Z',
        serviceDate: '2030-10-14T00:00:00.000Z',
        site: { name: 'Predio A', company: { timezone: 'America/Argentina/Buenos_Aires' } },
        rounds: [{ round: { name: 'Perimetral' } }],
      },
    ]);
    await render(<MyShiftsScreen />);
    expect(await screen.findByText('Predio A')).toBeOnTheScreen();
    expect(screen.getByText(/Perimetral/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Actualizar turnos' }));
    await waitFor(() => expect(fetchShifts).toHaveBeenCalledTimes(2));
  });

  it('informa si la consulta falla', async () => {
    fetchShifts.mockRejectedValue(new Error('sin conexión'));
    await render(<MyShiftsScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar los turnos/);
  });
});
