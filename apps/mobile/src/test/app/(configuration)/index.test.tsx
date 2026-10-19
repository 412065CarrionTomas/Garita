import { Alert } from 'react-native';
import { ThemeProvider } from '@/ui';
import { render, userEvent, waitFor } from '@testing-library/react-native';
import type { AuthMeResponse } from '@garita/shared';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError, apiDelete, apiGet, apiRequest } from '@/lib/api-client';
import { nfcAvailability, openNfcSettings, readFactoryUid } from '@/lib/nfc';
import * as Network from 'expo-network';
import ConfigurationHome from '@/app/(configuration)/index';

jest.mock('@/features/auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api-client', () => ({
  ApiError: class extends Error {
    status: number;
    payload: unknown;
    constructor(message: string, status: number, payload?: unknown) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  },
  apiGet: jest.fn(),
  apiRequest: jest.fn(),
  apiDelete: jest.fn(),
}));
jest.mock('@/lib/nfc', () => ({
  nfcAvailability: jest.fn(),
  openNfcSettings: jest.fn(),
  readFactoryUid: jest.fn(),
  cancelNfcRead: jest.fn(),
}));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({ play: jest.fn(), seekTo: jest.fn() }) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));

const authMock = jest.mocked(useAuth);
const getMock = jest.mocked(apiGet);
const putMock = jest.mocked(apiRequest);
const deleteMock = jest.mocked(apiDelete);
const availabilityMock = jest.mocked(nfcAvailability);
const readMock = jest.mocked(readFactoryUid);
const networkMock = jest.mocked(Network.getNetworkStateAsync);
const site = { id: 'site-a', name: 'Predio A' };
const point = { id: 'point-a', name: 'Portón trasero', etiquetaNfc: null };

function setUser(role: 'admin' | 'supervisor' = 'supervisor') {
  const user: AuthMeResponse = {
    id: 'u1',
    firstName: 'Ana',
    lastName: 'García',
    email: 'ana@example.com',
    role,
    status: 'active',
    company: { id: 'c1', name: 'Seguridad Norte' },
    allowedChannels: ['web', 'mobile'],
  };
  authMock.mockReturnValue({
    user,
    loading: false,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    error: '',
  });
}

async function mount(
  points: { id: string; name: string; etiquetaNfc: { status: string } | null }[] = [point],
) {
  getMock.mockImplementation(((path: string) =>
    Promise.resolve(path.includes('configuracion') ? [site] : points)) as never);
  return await render(
    <ThemeProvider>
      <ConfigurationHome />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser();
  availabilityMock.mockResolvedValue('ready');
  networkMock.mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  } as Network.NetworkState);
  readMock.mockResolvedValue('04A1B2C3');
  putMock.mockResolvedValue({ id: 'tag-a', status: 'active' } as never);
});

it('informa cuando el celular no tiene NFC y no ofrece asociar', async () => {
  availabilityMock.mockResolvedValue('unsupported');
  const view = await mount();
  expect(await view.findByText('Tu celular no puede leer etiquetas NFC')).toBeTruthy();
  expect(view.queryByLabelText('Asociar etiqueta NFC a Portón trasero')).toBeNull();
}, 30000);

it('informa que NFC está apagado y permite abrir ajustes', async () => {
  availabilityMock.mockResolvedValue('disabled');
  const user = userEvent.setup();
  const view = await mount();
  await user.press(await view.findByLabelText('Abrir ajustes de NFC'));
  expect(openNfcSettings).toHaveBeenCalled();
});

it('confirma una asociación exitosa con el mensaje visible', async () => {
  const user = userEvent.setup();
  const view = await mount();
  await user.press(await view.findByLabelText('Asociar etiqueta NFC a Portón trasero'));
  expect(await view.findByText('Etiqueta asociada a Portón trasero')).toBeTruthy();
  expect(putMock).toHaveBeenCalledWith('PUT', '/puntos/point-a/etiqueta-nfc', expect.anything(), {
    uid: '04A1B2C3',
    confirmMove: false,
  });
});

it('pide confirmación y reintenta el movimiento ante un 409', async () => {
  putMock.mockRejectedValueOnce(
    new ApiError('conflict', 409, { checkpointName: 'Punto anterior' }),
  );
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.text === 'Mover etiqueta')?.onPress?.();
  });
  const user = userEvent.setup();
  const view = await mount();
  await user.press(await view.findByLabelText('Asociar etiqueta NFC a Portón trasero'));
  await waitFor(() => expect(putMock).toHaveBeenCalledTimes(2));
  expect(alert).toHaveBeenCalledWith(
    'La etiqueta está asociada a Punto anterior. ¿Moverla a Portón trasero?',
    '',
    expect.any(Array),
  );
  expect(putMock).toHaveBeenLastCalledWith(
    'PUT',
    '/puntos/point-a/etiqueta-nfc',
    expect.anything(),
    { uid: '04A1B2C3', confirmMove: true },
  );
  alert.mockRestore();
});

it('muestra Etiqueta no disponible ante un 422', async () => {
  putMock.mockRejectedValue(new ApiError('unavailable', 422));
  const user = userEvent.setup();
  const view = await mount();
  await user.press(await view.findByLabelText('Asociar etiqueta NFC a Portón trasero'));
  expect(await view.findByText('Etiqueta no disponible')).toBeTruthy();
});

it('avisa si está sin conexión y no inicia la lectura NFC', async () => {
  networkMock.mockResolvedValue({
    isConnected: false,
    isInternetReachable: false,
  } as Network.NetworkState);
  const user = userEvent.setup();
  const view = await mount();
  await user.press(await view.findByLabelText('Asociar etiqueta NFC a Portón trasero'));
  expect(await view.findByText('Se necesita conexión para asociar una etiqueta.')).toBeTruthy();
  expect(readMock).not.toHaveBeenCalled();
});

it('muestra al supervisor solo los predios entregados por la API', async () => {
  const view = await mount();
  expect(await view.findByText('Predio A')).toBeTruthy();
  expect(view.queryByText('Predio B')).toBeNull();
});

it('mantiene disponible cerrar sesión en el modo de configuración', async () => {
  setUser('admin');
  const view = await mount();
  await waitFor(() => expect(view.getByText('Modo de configuración')).toBeTruthy());
  expect(view.getByLabelText('Cerrar sesión')).toBeTruthy();
  expect(deleteMock).not.toHaveBeenCalled();
});

it('muestra el predio seleccionado y permite cambiar la apariencia', async () => {
  const user = userEvent.setup();
  const view = await mount();
  expect(await view.findByText('Seleccionado')).toBeOnTheScreen();
  expect(
    view.getByRole('button', { name: 'Seleccionar predio Predio A', selected: true }),
  ).toBeOnTheScreen();
  await user.press(view.getByRole('radio', { name: 'Oscuro' }));
  expect(view.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
  await user.press(view.getByRole('radio', { name: 'Claro' }));
  expect(view.getByRole('radio', { name: 'Claro' })).toBeChecked();
});

it('conserva el estado y las acciones de una etiqueta asociada', async () => {
  const user = userEvent.setup();
  const view = await mount([{ ...point, etiquetaNfc: { status: 'active' } }]);
  expect(await view.findByText('Etiqueta NFC asociada')).toBeOnTheScreen();
  expect(view.getByLabelText('Reemplazar etiqueta NFC a Portón trasero')).toBeOnTheScreen();
  await user.press(view.getByLabelText('Quitar etiqueta NFC de Portón trasero'));
  expect(deleteMock).toHaveBeenCalledWith('/puntos/point-a/etiqueta-nfc', expect.anything());
  expect(await view.findByText('Etiqueta quitada de Portón trasero')).toBeOnTheScreen();
});
