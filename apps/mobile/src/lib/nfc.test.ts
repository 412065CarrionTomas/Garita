import { Platform } from 'react-native';
import NfcManager, { NfcTech, NfcEvents } from 'react-native-nfc-manager';
import type * as Nfc from './nfc';
import { readFactoryUid, cancelNfcRead, nfcAvailability, openNfcSettings } from './nfc';

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn(async () => true),
    isEnabled: jest.fn(async () => true),
    start: jest.fn(async () => undefined),
    goToNfcSetting: jest.fn(async () => undefined),
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
    registerTagEvent: jest.fn(async () => undefined),
    unregisterTagEvent: jest.fn(async () => undefined),
    setEventListener: jest.fn(),
  },
  NfcEvents: { DiscoverTag: 'discover' },
  NfcTech: {
    NfcA: 'NfcA',
    NfcV: 'NfcV',
    MifareIOS: 'mifare',
    Iso15693IOS: 'iso15693',
  },
}));

const requestTechnology = jest.mocked(NfcManager.requestTechnology);
const getTag = jest.mocked(NfcManager.getTag);
const cancelTechnologyRequest = jest.mocked(NfcManager.cancelTechnologyRequest);

describe('lectura del UID NFC', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    getTag.mockResolvedValue({ id: 'E004015012345678' } as never);
    cancelTechnologyRequest.mockResolvedValue();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('usa una sesión de etiquetas iOS para MIFARE e ISO 15693 y la libera', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });

    await expect(readFactoryUid()).resolves.toBe('E004015012345678');

    expect(requestTechnology).toHaveBeenCalledWith([NfcTech.MifareIOS, NfcTech.Iso15693IOS], {
      alertMessage: 'Acercá la etiqueta NFC al iPhone.',
    });
    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });

  it('usa NFC-A e NFC-V en Android', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });

    await expect(readFactoryUid()).resolves.toBe('E004015012345678');

    expect(requestTechnology).toHaveBeenCalledWith([NfcTech.NfcA, NfcTech.NfcV], {});
    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });

  it('detecta NFC apagado y ofrece los ajustes del adaptador en Android', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    jest.mocked(NfcManager.isEnabled).mockResolvedValueOnce(false);
    await expect(nfcAvailability()).resolves.toBe('disabled');
    await openNfcSettings();
    expect(NfcManager.goToNfcSetting).toHaveBeenCalled();
  });

  it('sin hardware NFC no inicia sesión', async () => {
    jest.mocked(NfcManager.isSupported).mockResolvedValueOnce(false);
    await expect(nfcAvailability()).resolves.toBe('unsupported');
    expect(NfcManager.start).not.toHaveBeenCalled();
  });

  it('Android mantiene la lectura de UID hasta cancelar al salir', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    const onTag = jest.fn();
    await readFactoryUid(onTag);
    expect(NfcManager.registerTagEvent).toHaveBeenCalledWith({ isReaderModeEnabled: true });
    const listener = jest.mocked(NfcManager.setEventListener).mock.calls[0]?.[1];
    (listener as (tag: unknown) => void)({ id: '04:aa:bb:cc' });
    (listener as (tag: unknown) => void)({ id: 'invalid' });
    expect(onTag).toHaveBeenCalledTimes(1);
    expect(onTag).toHaveBeenCalledWith('04AABBCC');
    await cancelNfcRead();
    expect(NfcManager.setEventListener).toHaveBeenLastCalledWith(NfcEvents.DiscoverTag, null);
    expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
  });

  it('libera la sesión si falla la solicitud de tecnología', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    requestTechnology.mockRejectedValueOnce(new Error('lectura cancelada'));

    await expect(readFactoryUid()).rejects.toThrow('lectura cancelada');

    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });
});

describe('sin módulo nativo de NFC (Expo Go y web)', () => {
  afterEach(() => {
    jest.dontMock('react-native-nfc-manager');
    jest.resetModules();
  });

  it('informa NFC como no soportado en vez de fallar al cargar', async () => {
    jest.resetModules();
    jest.doMock('react-native-nfc-manager', () => {
      throw new Error('The NfcManager native module is unavailable.');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- hay que recargar el módulo con el mock que lanza
    const nfc: typeof Nfc = require('./nfc');

    await expect(nfc.nfcAvailability()).resolves.toBe('unsupported');
    await expect(nfc.cancelNfcRead()).resolves.toBeUndefined();
  });
});
