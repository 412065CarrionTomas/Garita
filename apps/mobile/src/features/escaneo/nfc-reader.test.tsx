import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type * as ReactType from 'react';
import { AppState, Platform } from 'react-native';
import { cancelNfcRead, nfcAvailability, openNfcSettings, readNfcTag } from '@/lib/nfc';
import type { ShiftOfflineData } from '@garita/shared';
import { processScan } from './scan-action';
import { NfcReader } from './nfc-reader';

jest.mock('@/lib/nfc', () => ({
  nfcAvailability: jest.fn(),
  cancelNfcRead: jest.fn(async () => undefined),
  openNfcSettings: jest.fn(async () => undefined),
  readNfcTag: jest.fn(),
}));
jest.mock('./scan-action', () => ({ processScan: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react') as typeof ReactType;
    React.useEffect(callback, [callback]);
  },
}));
const data = { checkpoints: [{ nfcUid: '04AABBCC' }] } as ShiftOfflineData;
const originalOS = Platform.OS;
const originalState = AppState.currentState;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  AppState.currentState = 'active';
  jest.mocked(nfcAvailability).mockResolvedValue('ready');
  jest.mocked(processScan).mockResolvedValue({
    status: 'invalid_attempt',
    reason: 'tag_not_associated',
    recordId: 'id',
    message: 'Etiqueta no válida. Intento guardado.',
  });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  AppState.currentState = originalState;
});

it('CA1 / BDD1: Android escucha sin botón y cancela al salir', async () => {
  const view = await render(<NfcReader shiftData={data} />);
  await waitFor(() => expect(readNfcTag).toHaveBeenCalledWith(expect.any(Function)));
  const callback = (
    jest.mocked(readNfcTag).mock.calls[0] as unknown as [
      (tag: { uid: string; sdmMessage?: string }) => void,
    ]
  )[0];
  await act(async () => callback({ uid: '04AABBCC', sdmMessage: 'garita:nfc?e=aa&c=bb' }));
  expect(processScan).toHaveBeenCalledWith(
    '04AABBCC',
    data,
    'nfc',
    expect.any(Function),
    'garita:nfc?e=aa&c=bb',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Etiqueta no válida. Intento guardado.');
  expect(screen.queryByRole('button', { name: 'Leer etiqueta' })).toBeNull();
  await view.unmount();
  await waitFor(() => expect(cancelNfcRead).toHaveBeenCalledTimes(2));
});

it('CA2 / BDD2: iPhone lee solamente al tocar Leer etiqueta', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.mocked(readNfcTag).mockResolvedValue({ uid: '04AABBCC' });
  await render(<NfcReader shiftData={data} />);
  const button = await screen.findByRole('button', { name: 'Leer etiqueta' });
  expect(readNfcTag).not.toHaveBeenCalled();
  await fireEvent.press(button);
  expect(readNfcTag).toHaveBeenCalledWith();
  expect(processScan).toHaveBeenCalled();
});

it('BDD4: apagado informa y abre ajustes', async () => {
  jest.mocked(nfcAvailability).mockResolvedValue('disabled');
  await render(<NfcReader shiftData={data} />);
  expect(await screen.findByText('El NFC está apagado')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Abrir ajustes' }));
  expect(openNfcSettings).toHaveBeenCalled();
  expect(readNfcTag).not.toHaveBeenCalled();
});

it('CA4: sin NFC no muestra ninguna mención ni acción NFC', async () => {
  jest.mocked(nfcAvailability).mockResolvedValue('unsupported');
  await render(<NfcReader shiftData={data} />);
  await waitFor(() => expect(nfcAvailability).toHaveBeenCalled());
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByText(/NFC|etiqueta/)).toBeNull();
});

it('BDD3: muestra el motivo de etiqueta reemplazada validado por el servidor', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.mocked(readNfcTag).mockResolvedValue({ uid: '04AABBCC' });
  jest.mocked(processScan).mockResolvedValue({
    status: 'invalid_attempt',
    reason: 'tag_replaced',
    recordId: 'id',
    message: 'Etiqueta reemplazada. Intento guardado.',
  });
  await render(<NfcReader shiftData={data} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Leer etiqueta' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Etiqueta reemplazada. Intento guardado.');
});
