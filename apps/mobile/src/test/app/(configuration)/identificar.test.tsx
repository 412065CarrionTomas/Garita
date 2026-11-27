import { render, screen, userEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/ui';
import { ApiError, apiRequest } from '@/lib/api-client';
import { nfcAvailability, readNfcTag } from '@/lib/nfc';
import IdentifyTagRoute from '@/app/(configuration)/identificar';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: () => true,
    replace: (...a: unknown[]) => mockReplace(...a),
  },
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
  apiRequest: jest.fn(),
}));
jest.mock('@/lib/nfc', () => ({
  nfcAvailability: jest.fn(),
  openNfcSettings: jest.fn(),
  readNfcTag: jest.fn(),
  cancelNfcRead: jest.fn(),
}));

const tag = {
  status: 'active',
  kind: 'secure',
  associatedAt: '2026-11-20T13:00:00.000Z',
  endedAt: null,
  checkpoint: { id: 'p4', name: 'Galpón', position: 4 },
  site: { id: 'site-a', name: 'Barrio Norte' },
  lastReadAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(nfcAvailability).mockResolvedValue('ready');
  jest.mocked(readNfcTag).mockResolvedValue({ uid: '04:a1:b2:c3' });
});

const mount = () =>
  render(
    <ThemeProvider>
      <IdentifyTagRoute />
    </ThemeProvider>,
  );

it('dice de qué punto y predio es la etiqueta y lleva al predio', async () => {
  jest.mocked(apiRequest).mockResolvedValue(tag as never);
  const user = userEvent.setup();
  await mount();
  expect(await screen.findByText('Galpón')).toBeOnTheScreen();
  expect(screen.getByText('Barrio Norte')).toBeOnTheScreen();
  expect(screen.getByText('Ningún vigilador la marcó todavía.')).toBeOnTheScreen();
  expect(apiRequest).toHaveBeenCalledWith('POST', '/etiquetas-nfc/identificar', expect.anything(), {
    uid: '04A1B2C3',
  });
  await user.press(screen.getByRole('button', { name: 'Ir a Barrio Norte' }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/(configuration)/predio/[id]',
    params: { id: 'site-a', nombre: 'Barrio Norte' },
  });
});

it('avisa que una etiqueta reemplazada ya no está en uso', async () => {
  jest.mocked(apiRequest).mockResolvedValue({
    ...tag,
    status: 'replaced',
    endedAt: '2026-11-21T13:00:00.000Z',
  } as never);
  await mount();
  expect(await screen.findByText('Ya no está en uso')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Ir a/ })).toBeNull();
});

it('una etiqueta sin asociar se puede usar y se lee otra', async () => {
  jest.mocked(apiRequest).mockRejectedValueOnce(new ApiError('not found', 404));
  jest.mocked(apiRequest).mockResolvedValueOnce(tag as never);
  const user = userEvent.setup();
  await mount();
  expect(await screen.findByText('Etiqueta sin usar')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Leer otra' }));
  expect(await screen.findByText('Galpón')).toBeOnTheScreen();
  expect(readNfcTag).toHaveBeenCalledTimes(2);
});

it('si falla la lectura no culpa a la conexión', async () => {
  jest.mocked(readNfcTag).mockRejectedValueOnce(new Error('Tag lost'));
  await mount();
  expect(
    await screen.findByText('No se pudo leer la etiqueta. Acercala de nuevo y no la muevas.'),
  ).toBeOnTheScreen();
  expect(apiRequest).not.toHaveBeenCalled();
});
