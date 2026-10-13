import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { readFactoryUid } from './nfc';

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
  },
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

  it('libera la sesión si falla la solicitud de tecnología', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    requestTechnology.mockRejectedValueOnce(new Error('lectura cancelada'));

    await expect(readFactoryUid()).rejects.toThrow('lectura cancelada');

    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });
});
