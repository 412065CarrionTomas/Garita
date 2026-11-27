import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { ThemeProvider } from '@/ui';
import { ApiError, apiDelete, apiGet, apiRequest } from '@/lib/api-client';
import { nfcAvailability, readNfcTag } from '@/lib/nfc';
import { NotSecureNfcTag, withSecureNfcTag } from '@/lib/nfc-secure';
import SitePointsRoute from '@/app/(configuration)/predio/[id]';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'site-a', nombre: 'Barrio Norte' }),
}));
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
  readNfcTag: jest.fn(),
  cancelNfcRead: jest.fn(),
}));
jest.mock('@/lib/nfc-secure', () => ({
  NotSecureNfcTag: jest.requireActual('@/lib/nfc-secure').NotSecureNfcTag,
  withSecureNfcTag: jest.fn(),
}));
jest.mock('@/features/escaneo/feedback', () => ({ playSuccessFeedback: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));

type Point = { id: string; name: string; position: number; tagType: string };
const gate = { id: 'p1', name: 'Portón', position: 1, tagType: 'qr' };
const shed = { id: 'p2', name: 'Galpón', position: 2, tagType: 'qr' };
const tank = { id: 'p3', name: 'Tanque', position: 3, tagType: 'nfc_secure' };
let points: Point[];
const putMock = jest.mocked(apiRequest);

beforeEach(() => {
  jest.clearAllMocks();
  points = [gate, shed, tank];
  jest.mocked(apiGet).mockImplementation((() => Promise.resolve(points)) as never);
  jest.mocked(nfcAvailability).mockResolvedValue('ready');
  jest
    .mocked(Network.getNetworkStateAsync)
    .mockResolvedValue({ isConnected: true, isInternetReachable: true } as Network.NetworkState);
  // Etiqueta común: el relevo seguro la rechaza y se asocia por UID.
  jest.mocked(withSecureNfcTag).mockRejectedValue(new NotSecureNfcTag('04A1B2C3'));
  putMock.mockResolvedValue({ id: 'tag', status: 'active' } as never);
});

const mount = () =>
  render(
    <ThemeProvider>
      <SitePointsRoute />
    </ThemeProvider>,
  );

it('muestra el avance y abre en los pendientes, en orden', async () => {
  await mount();
  expect(await screen.findByText('1 de 3 puntos con etiqueta')).toBeOnTheScreen();
  expect(screen.getByLabelText('Punto 1, Portón. Sin etiqueta')).toBeOnTheScreen();
  expect(screen.getByLabelText('Punto 2, Galpón. Sin etiqueta')).toBeOnTheScreen();
  expect(screen.queryByLabelText(/Punto 3, Tanque/)).toBeNull();
});

it('asocia un punto y muestra en la hoja qué escribir en la etiqueta', async () => {
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(await screen.findByText('Etiqueta asociada')).toBeOnTheScreen();
  expect(screen.getByText('Escribí en la etiqueta')).toBeOnTheScreen();
  expect(screen.getByText('1 · Portón')).toBeOnTheScreen();
  expect(putMock).toHaveBeenCalledWith('PUT', '/puntos/p1/etiqueta-nfc', expect.anything(), {
    uid: '04A1B2C3',
    confirmMove: false,
  });
});

it('en serie pasa al siguiente con el botón', async () => {
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText(/Etiquetar en orden los 2 puntos pendientes/));
  expect(await screen.findByText('Quedan 2 pendientes')).toBeOnTheScreen();
  await user.press(await screen.findByLabelText('Siguiente punto: 2 · Galpón'));
  expect(await screen.findByText('Último pendiente')).toBeOnTheScreen();
  await waitFor(() =>
    expect(putMock).toHaveBeenLastCalledWith(
      'PUT',
      '/puntos/p2/etiqueta-nfc',
      expect.anything(),
      expect.anything(),
    ),
  );
});

it('con Pasar solo al siguiente avanza sin tocar nada', async () => {
  jest.useFakeTimers();
  try {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await mount();
    await user.press(await screen.findByLabelText(/Etiquetar en orden/));
    await fireEvent(
      await screen.findByRole('switch', { name: 'Pasar solo al siguiente' }),
      'valueChange',
      true,
    );
    await screen.findByText('Etiqueta asociada');
    await act(() => jest.advanceTimersByTime(1500));
    expect(await screen.findByText('Último pendiente')).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

it('si la etiqueta es de otro punto pide moverla en la misma hoja', async () => {
  putMock.mockRejectedValueOnce(
    new ApiError('conflict', 409, {
      code: 'NFC_TAG_MOVE_CONFIRMATION_REQUIRED',
      checkpointName: 'Tanque',
    }),
  );
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(await screen.findByText('Esta etiqueta es de Tanque')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Mover a Portón' }));
  expect(await screen.findByText('Etiqueta asociada')).toBeOnTheScreen();
  expect(putMock).toHaveBeenLastCalledWith('PUT', '/puntos/p1/etiqueta-nfc', expect.anything(), {
    uid: '04A1B2C3',
    confirmMove: true,
  });
});

it.each([
  [new ApiError('unavailable', 422), 'Esta etiqueta no está disponible para tu empresa.'],
  [new Error('offline'), 'No se pudo guardar la etiqueta. Revisá la conexión.'],
])('muestra el error en la hoja y deja reintentar', async (error, message) => {
  putMock.mockRejectedValueOnce(error);
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(await screen.findByText(message)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Etiqueta asociada')).toBeOnTheScreen();
});

it('sin conexión no empieza la lectura', async () => {
  jest
    .mocked(Network.getNetworkStateAsync)
    .mockResolvedValue({ isConnected: false, isInternetReachable: false } as Network.NetworkState);
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(
    await screen.findByText('Se necesita conexión para asociar una etiqueta.'),
  ).toBeOnTheScreen();
  expect(withSecureNfcTag).not.toHaveBeenCalled();
});

it('configura una etiqueta segura con la lectura de prueba', async () => {
  jest.mocked(withSecureNfcTag).mockResolvedValueOnce('session-1');
  jest.mocked(readNfcTag).mockResolvedValueOnce({ uid: '04DE5F', sdmMessage: 'garita:nfc?e=1' });
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(await screen.findByText('Etiqueta segura asociada')).toBeOnTheScreen();
  expect(putMock).toHaveBeenCalledWith(
    'POST',
    '/etiquetas-seguras/configuracion/session-1/confirmar',
    expect.anything(),
    { sdmMessage: 'garita:nfc?e=1' },
  );
});

it('quita una etiqueta solo después de confirmar en la misma hoja', async () => {
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByRole('button', { name: /Todos/ }));
  await user.press(screen.getByLabelText('Punto 3, Tanque. Etiqueta segura'));
  await user.press(screen.getByRole('button', { name: 'Quitar etiqueta' }));
  expect(screen.getByText('¿Quitar la etiqueta de Tanque?')).toBeOnTheScreen();
  expect(apiDelete).not.toHaveBeenCalled();
  await user.press(screen.getByRole('button', { name: 'Sí, quitar' }));
  expect(apiDelete).toHaveBeenCalledWith('/puntos/p3/etiqueta-nfc', expect.anything());
  expect(await screen.findByText('Etiqueta quitada')).toBeOnTheScreen();
});

it('con NFC apagado deja quitar pero no reemplazar ni leer', async () => {
  jest.mocked(nfcAvailability).mockResolvedValue('disabled');
  const user = userEvent.setup();
  await mount();
  expect(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta')).toBeDisabled();
  await user.press(screen.getByRole('button', { name: /Todos/ }));
  await user.press(screen.getByLabelText('Punto 3, Tanque. Etiqueta segura'));
  expect(screen.getByRole('button', { name: 'Quitar etiqueta' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Reemplazar etiqueta' })).toBeNull();
  // El aviso de NFC no tapa la confirmación ni el resultado de quitar.
  await user.press(screen.getByRole('button', { name: 'Quitar etiqueta' }));
  expect(screen.getByText('¿Quitar la etiqueta de Tanque?')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Sí, quitar' }));
  expect(await screen.findByText('Etiqueta quitada')).toBeOnTheScreen();
  expect(withSecureNfcTag).not.toHaveBeenCalled();
});

it('asocia aunque no se sepa si hay internet', async () => {
  jest
    .mocked(Network.getNetworkStateAsync)
    .mockResolvedValue({ isConnected: true, isInternetReachable: null } as never);
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(await screen.findByText('Etiqueta asociada')).toBeOnTheScreen();
});

it('un conflicto de carrera muestra lo que explica la API, no la opción de mover', async () => {
  putMock.mockRejectedValueOnce(
    new ApiError('La etiqueta cambió de asociación. Actualizá el punto e intentá de nuevo.', 409, {
      code: 'NFC_TAG_CONCURRENT_ASSOCIATION',
    }),
  );
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Punto 1, Portón. Sin etiqueta'));
  expect(await screen.findByText(/La etiqueta cambió de asociación/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Mover a/ })).toBeNull();
});
