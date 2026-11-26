import { render, screen, userEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuardShift } from '@garita/shared';
import { apiGet, ApiError } from '@/lib/api-client';
import { ShiftsScreen } from './shifts-screen';
import { isoDay } from './shift-range';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return { ...actual, apiGet: jest.fn() };
});

const today = isoDay(new Date());
const yesterday = isoDay(new Date(Date.now() - 86_400_000));
const base: GuardShift = {
  id: 'next',
  status: 'scheduled',
  serviceDate: today,
  startsAt: `${today}T23:00:00.000Z`,
  endsAt: `${today}T23:59:00.000Z`,
  startedAt: null,
  closedAt: null,
  site: { id: 'a', name: 'Parque Ferreyra', timezone: 'UTC' },
  rounds: ['Perimetral'],
  summary: null,
};
const done: GuardShift = {
  ...base,
  id: 'done',
  status: 'closed',
  serviceDate: yesterday,
  startsAt: `${yesterday}T10:00:00.000Z`,
  endsAt: `${yesterday}T18:00:00.000Z`,
  startedAt: `${yesterday}T10:00:00.000Z`,
  closedAt: `${yesterday}T18:00:00.000Z`,
  site: { id: 'b', name: 'Depósito Sur', timezone: 'UTC' },
  summary: { windows: 4, windowsDone: 3, recorded: 14, expected: 16, incidents: 1 },
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('muestra lo que viene y lo hecho en una sola lista, con totales y filtro de predio', async () => {
  jest.mocked(apiGet).mockResolvedValue({ items: [done, base], nextCursor: null });
  await render(<ShiftsScreen />);
  expect(await screen.findByText('Próximos')).toBeOnTheScreen();
  expect(screen.getByText('Anteriores')).toBeOnTheScreen();
  expect(screen.getByText('Ventanas 3/4 · Puntos 14/16 · 1 incidente')).toBeOnTheScreen();
  expect(screen.getByText('Incompleto')).toBeOnTheScreen();
  expect(screen.getByText(/2 turnos · 8 h trabajadas/)).toBeOnTheScreen();

  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Depósito Sur' }));
  expect(screen.queryByText('Rondas: Perimetral')).toBeNull();
  expect(screen.getByText(/1 turno · 8 h trabajadas · 0 h por trabajar/)).toBeOnTheScreen();
});

it('abre los turnos por venir y pide el rango elegido, página por página', async () => {
  jest
    .mocked(apiGet)
    .mockResolvedValueOnce({ items: [base], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockResolvedValue({ items: [], nextCursor: null });
  await render(<ShiftsScreen />);
  const user = userEvent.setup();
  await user.press(await screen.findByText('Parque Ferreyra'));
  expect(mockPush).toHaveBeenCalledWith('/turno/next');
  expect(jest.mocked(apiGet).mock.calls[1]?.[0]).toContain('cursor=next');

  await user.press(screen.getByRole('button', { name: 'Próximos 30 días' }));
  expect(jest.mocked(apiGet).mock.lastCall?.[0]).toContain(`desde=${today}`);
});

it('avisa si la cuenta está suspendida', async () => {
  jest.mocked(apiGet).mockRejectedValue(
    new ApiError('x', 402, {
      code: 'ACCOUNT_SUSPENDED',
      accountStatus: 'suspended',
      message: 'x',
    }),
  );
  await render(<ShiftsScreen />);
  expect(await screen.findByText(/cuenta de tu empresa está suspendida/)).toBeOnTheScreen();
});

it('sin señal vuelve a mostrar el último rango cargado', async () => {
  jest.mocked(apiGet).mockResolvedValueOnce({ items: [base], nextCursor: null });
  const first = await render(<ShiftsScreen />);
  expect(await screen.findByText('Parque Ferreyra')).toBeOnTheScreen();
  await first.unmount();

  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  await render(<ShiftsScreen />);
  expect(await screen.findByText(/Sin conexión. Mostrando lo guardado/)).toBeOnTheScreen();
  expect(screen.getByText('Parque Ferreyra')).toBeOnTheScreen();
});

it('cada campo abre su calendario, resalta hoy y pide el rango nuevo', async () => {
  jest.mocked(apiGet).mockResolvedValue({ items: [], nextCursor: null });
  await render(<ShiftsScreen />);
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: /^Hasta:/ }));
  expect(screen.getByRole('button', { name: /, hoy$/ })).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: /, hoy$/ }));
  expect(screen.queryByRole('button', { name: /, hoy$/ })).toBeNull();
  expect(jest.mocked(apiGet).mock.lastCall?.[0]).toContain(`hasta=${today}`);
});
