import { render, userEvent } from '@testing-library/react-native';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { getSyncSnapshot, processSyncQueue } from '@/lib/cola';
import { SendScreen } from './send-screen';

jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('@/lib/cola', () => ({
  getSyncSnapshot: jest.fn(),
  processSyncQueue: jest.fn(),
  subscribeSyncState: jest.fn(() => () => undefined),
}));

const event = {
  id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
  type: 'checkpoint_record',
  payload: {},
  occurredAtDevice: '2026-10-13T21:03:00.000Z',
  createdAt: '2026-10-13T21:03:01.000Z',
};
const snapshot = { isSyncing: false, isOffline: false, pendingCount: 1, lastSyncAt: null };

function givenQueue(events: unknown[]) {
  jest
    .mocked(createDefaultFieldRepository)
    .mockResolvedValue({ listPendingEvents: async () => events } as never);
  jest.mocked(getSyncSnapshot).mockResolvedValue(snapshot);
}

it('lista los registros pendientes como sellos "en el celular"', async () => {
  givenQueue([event]);
  const screen = await render(<SendScreen />);
  expect(await screen.findByText('Escaneo de punto')).toBeTruthy();
  expect(screen.getByText('En el celular')).toBeTruthy();
});

it('sin pendientes dice que todo está enviado y no deja enviar', async () => {
  givenQueue([]);
  const screen = await render(<SendScreen />);
  expect(await screen.findByText('Todo enviado')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Enviar ahora' })).toBeDisabled();
});

it('"Enviar ahora" sin señal avisa que se reintenta solo', async () => {
  givenQueue([event]);
  jest.mocked(getSyncSnapshot).mockResolvedValue({ ...snapshot, isOffline: true });
  jest.mocked(processSyncQueue).mockResolvedValue({ processed: 0, batchesSent: 0, success: false });
  const screen = await render(<SendScreen />);
  await screen.findByText('Escaneo de punto');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Enviar ahora' }));
  expect(await screen.findByText(/no se pudo enviar/)).toBeTruthy();
});

it.each([
  [true, 'Ya hay un envío en curso.'],
  [false, 'No se pudo enviar. Se reintenta solo.'],
])('distinguishes busy or HTTP failure from no signal: %s', async (isSyncing, message) => {
  givenQueue([event]);
  jest.mocked(getSyncSnapshot).mockResolvedValue({ ...snapshot, isSyncing });
  jest.mocked(processSyncQueue).mockResolvedValue({ processed: 0, batchesSent: 0, success: false });
  const screen = await render(<SendScreen />);
  await screen.findByText('Escaneo de punto');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Enviar ahora' }));
  expect(await screen.findByText(message)).toBeOnTheScreen();
  expect(screen.queryByText(/Sin señal:/)).toBeNull();
});
