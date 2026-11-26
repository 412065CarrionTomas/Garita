import { render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GuardHeader } from './guard-header';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockPathname = '/turnos';
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: jest.fn(),
    canGoBack: () => mockCanGoBack,
  }),
}));
jest.mock('@/lib/cola', () => ({
  getSyncSnapshot: jest.fn(async () => ({ pendingCount: 0 })),
  subscribeSyncState: jest.fn(() => () => undefined),
}));
jest.mock('./guard-menu', () => ({ GuardMenu: () => null }));

const renderHeader = (shiftId: string | null = null) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <GuardHeader shiftId={shiftId} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

it('en los destinos de la barra abre el menú', async () => {
  for (const path of ['/', '/turnos', '/predios', '/turno/run']) {
    mockPathname = path;
    const view = await renderHeader('run');
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toBeOnTheScreen();
    await view.unmount();
  }
});

it('en una pantalla interna vuelve atrás, o a Hoy si no hay historial', async () => {
  mockPathname = '/turno/otro';
  await renderHeader();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Volver' }));
  expect(mockBack).toHaveBeenCalled();
  mockCanGoBack = false;
  await user.press(screen.getByRole('button', { name: 'Volver' }));
  expect(mockReplace).toHaveBeenCalledWith('/');
});
