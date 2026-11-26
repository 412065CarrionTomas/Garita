import { render, screen, userEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { apiGet, ApiError } from '@/lib/api-client';
import { TodayScreen } from './today-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return { ...actual, apiGet: jest.fn() };
});

const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
const shift = (id: string, startsAt: string, status = 'scheduled') => ({
  id,
  status,
  startsAt,
  endsAt: startsAt,
  site: {
    name: `Predio ${id}`,
    address: 'Ruta 9 km 4',
    latitude: '-31.400000',
    longitude: '-64.100000',
    accessInstructions: 'Portón norte',
    company: { timezone: 'UTC' },
  },
  rounds: [{ round: { name: 'Perimetral' } }],
  assignments: [{ startsAt }],
});

// Como la API real: la respuesta pasa por el esquema (las coordenadas llegan como texto).
const respond = (data: unknown) =>
  jest.mocked(apiGet).mockImplementation(async (_path, schema) => schema.parse(data));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('sin turno hoy muestra el próximo con acceso y cómo llegar', async () => {
  respond([shift('b', at(72)), shift('c', at(96))]);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<TodayScreen />);
  expect(await screen.findByText('Próximo turno')).toBeOnTheScreen();
  expect(screen.getByText('Predio b')).toBeOnTheScreen();
  expect(screen.queryByText('Predio c')).toBeNull();
  expect(screen.getByText('Acceso: Portón norte')).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Cómo llegar' }));
  expect(open).toHaveBeenCalledWith(
    'https://www.google.com/maps/dir/?api=1&destination=-31.4,-64.1',
  );
  await user.press(screen.getByRole('button', { name: 'Ver turno' }));
  expect(mockPush).toHaveBeenCalledWith('/turno/b');
});

it('con turno en curso lo pone primero y lleva a la ronda', async () => {
  respond([shift('a', at(-30), 'in_progress'), shift('b', at(72))]);
  await render(<TodayScreen />);
  expect(await screen.findByText('Hoy')).toBeOnTheScreen();
  expect(screen.getByText('En curso')).toBeOnTheScreen();
  expect(screen.queryByText('Próximo turno')).toBeNull();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Ir a la ronda' }));
  expect(mockPush).toHaveBeenCalledWith('/turno/a');
});

it('el nocturno de anoche que sigue vigente aparece en Hoy', async () => {
  jest.useFakeTimers({ advanceTimers: true, now: new Date(2026, 10, 27, 3) });
  try {
    respond([
      {
        ...shift('n', new Date(2026, 10, 26, 22).toISOString()),
        endsAt: new Date(2026, 10, 27, 6).toISOString(),
      },
      shift('b', new Date(2026, 10, 29, 22).toISOString()),
    ]);
    await render(<TodayScreen />);
    expect(await screen.findByText('Predio n')).toBeOnTheScreen();
    expect(screen.queryByText('Próximo turno')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it('un turno de hoy que ya terminó deja ver el próximo', async () => {
  const ended = { ...shift('x', at(-3)), endsAt: at(-1) };
  respond([ended, shift('b', at(72))]);
  await render(<TodayScreen />);
  expect(await screen.findByText('Próximo turno')).toBeOnTheScreen();
  expect(screen.queryByText('Predio x')).toBeNull();
});

it('con la cuenta suspendida avisa aunque haya copia guardada', async () => {
  respond([shift('b', at(72))]);
  const first = await render(<TodayScreen />);
  expect(await screen.findByText('Predio b')).toBeOnTheScreen();
  await first.unmount();
  jest.mocked(apiGet).mockRejectedValue(
    new ApiError('x', 402, {
      code: 'ACCOUNT_SUSPENDED',
      accountStatus: 'suspended',
      message: 'x',
    }),
  );
  await render(<TodayScreen />);
  expect(await screen.findByText(/cuenta de tu empresa está suspendida/)).toBeOnTheScreen();
  expect(screen.queryByText('Predio b')).toBeNull();
  expect(screen.queryByText(/Sin conexión/)).toBeNull();
});
