import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/ui';
import { GuardMenu } from './guard-menu';

const mockLogout = jest.fn();
const mockPush = jest.fn();
jest.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    logout: mockLogout,
    user: { firstName: 'Ana', lastName: 'Gómez', company: { name: 'Vigía SA' } },
  }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
let mockPending = 0;
jest.mock('@/lib/cola', () => ({
  getSyncSnapshot: jest.fn(async () => ({ pendingCount: mockPending })),
}));

const renderMenu = (pendingCount: number, onClose = jest.fn()) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider>
        <GuardMenu open pendingCount={pendingCount} onClose={onClose} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = 0;
});

it('muestra la cuenta y cambia el tema con el interruptor sol | luna', async () => {
  await renderMenu(0);
  expect(screen.getByText('Ana Gómez')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: 'Oscuro' }));
  expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Claro' })).not.toBeChecked();
});

it('cierra el menú y navega a envíos', async () => {
  const onClose = jest.fn();
  await renderMenu(2, onClose);
  await fireEvent.press(screen.getByText('2 pendientes'));
  expect(onClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/envio');
});

it('cierra sesión directo si no hay pendientes', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const onClose = jest.fn();
  await renderMenu(0, onClose);
  await act(() => fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' })));
  expect(onClose).toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(mockLogout).toHaveBeenCalledTimes(1);
});

it('cuenta los pendientes al tocar, aunque la cabecera diga cero, y solo sale si confirma', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockPending = 3;
  await renderMenu(0);
  await act(() => fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' })));
  expect(alert).toHaveBeenCalledWith(
    'Registros pendientes de envío',
    expect.stringContaining('Tenés 3 registros pendientes de envío.'),
    expect.any(Array),
  );
  expect(mockLogout).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]?.[2] ?? [];
  buttons.find((button) => button.text === 'Cerrar sesión')?.onPress?.();
  expect(mockLogout).toHaveBeenCalledTimes(1);
});

it('nombra un solo pendiente en singular', async () => {
  await renderMenu(1);
  expect(screen.getByText('1 pendiente')).toBeOnTheScreen();
});

it('abre las preguntas frecuentes desde el menú', async () => {
  const onClose = jest.fn();
  await renderMenu(0, onClose);
  await fireEvent.press(screen.getByText('Preguntas frecuentes'));
  expect(onClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/ayuda');
});
