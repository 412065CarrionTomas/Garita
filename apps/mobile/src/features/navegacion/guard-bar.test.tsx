import { render, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GuardBar } from './guard-bar';

const renderBar = (shiftId: string | null = 'abc') =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <GuardBar shiftId={shiftId} />
    </SafeAreaProvider>,
  );

const mockReplace = jest.fn();
let mockPathname = '/turno/abc';
jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPathname = '/turno/abc';
});

it('con turno iniciado el primer destino es la Ronda', async () => {
  const screen = await renderBar();
  expect(screen.getByRole('tab', { name: 'Ronda' })).toBeSelected();
  expect(screen.getByRole('tab', { name: 'Turnos' })).not.toBeSelected();
  await userEvent.setup().press(screen.getByRole('tab', { name: 'Turnos' }));
  expect(mockReplace).toHaveBeenCalledWith('/turnos');
});

it('sin turno el primer destino es Hoy', async () => {
  mockPathname = '/';
  const screen = await renderBar(null);
  expect(screen.queryByRole('tab', { name: 'Ronda' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'Hoy' })).toBeSelected();
});

it('se oculta en el visor de la cámara', async () => {
  mockPathname = '/escaneo';
  const screen = await renderBar();
  expect(screen.queryByRole('tab', { name: 'Ronda' })).toBeNull();
});
