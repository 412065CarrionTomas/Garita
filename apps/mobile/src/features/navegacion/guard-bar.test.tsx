import { render, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GuardBar } from './guard-bar';

const renderBar = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <GuardBar shiftId="abc" />
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

it('marca el destino activo y navega a otro', async () => {
  const screen = await renderBar();
  expect(screen.getByRole('tab', { name: 'Ronda' })).toBeSelected();
  expect(screen.getByRole('tab', { name: 'Envío' })).not.toBeSelected();
  await userEvent.setup().press(screen.getByRole('tab', { name: 'Envío' }));
  expect(mockReplace).toHaveBeenCalledWith('/envio');
});

it('se oculta en el visor de la cámara', async () => {
  mockPathname = '/escaneo';
  const screen = await renderBar();
  expect(screen.queryByRole('tab', { name: 'Ronda' })).toBeNull();
});
