import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { NotSecureNfcTag, withSecureNfcTag } from './nfc-secure';

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
    isoDepHandler: {
      transceive: jest.fn(),
    },
  },
  NfcTech: {
    IsoDep: 'IsoDep',
    NfcA: 'NfcA',
    NfcV: 'NfcV',
    MifareIOS: 'mifare',
    Iso15693IOS: 'iso15693',
  },
}));

const requestTechnology = jest.mocked(NfcManager.requestTechnology);
const getTag = jest.mocked(NfcManager.getTag);
const cancelTechnologyRequest = jest.mocked(NfcManager.cancelTechnologyRequest);
const transceive = jest.mocked(NfcManager.isoDepHandler.transceive);

describe('withSecureNfcTag', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    cancelTechnologyRequest.mockResolvedValue();
    getTag.mockResolvedValue({ id: '04DE5F1EACC040' } as never);
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('detecta una etiqueta NTAG 424 DNA y pasa el transceptor al callback', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    requestTechnology.mockResolvedValueOnce(NfcTech.IsoDep as never);

    // 1. Select AID -> 9000
    // 2. GetVersion frame 1 (9060000000) -> 0404083000110591AF (7 bytes data + 91AF)
    // 3. GetVersion frame 2 (90AF000000) -> 0404020101110591AF (7 bytes data + 91AF)
    // 4. GetVersion frame 3 (90AF000000) -> 04DE5F1EACC040000000000000009100 (14 bytes data + 9100)
    // Total version = 28 bytes = 56 hex chars.
    const hexToBytes = (hex: string) => hex.match(/../g)!.map((b) => Number.parseInt(b, 16));

    transceive
      .mockResolvedValueOnce(hexToBytes('9000'))
      .mockResolvedValueOnce(hexToBytes('0404083000110591AF'))
      .mockResolvedValueOnce(hexToBytes('0404020101110591AF'))
      .mockResolvedValueOnce(hexToBytes('04DE5F1EACC040000000000000009100'));

    const result = await withSecureNfcTag(async (tag) => {
      expect(tag.uid).toBe('04DE5F1EACC040');
      expect(tag.version).toBe('040408300011050404020101110504DE5F1EACC04000000000000000');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(requestTechnology).toHaveBeenCalledWith(
      [NfcTech.IsoDep, NfcTech.NfcA, NfcTech.NfcV],
      {},
    );
    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });

  it('lanza NotSecureNfcTag si la tecnología leída no es IsoDep', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    requestTechnology.mockResolvedValueOnce(NfcTech.NfcA as never);

    await expect(withSecureNfcTag(async () => 'ok')).rejects.toThrow(NotSecureNfcTag);
    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });

  it('lanza NotSecureNfcTag si la etiqueta no responde al AID de NTAG 424 DNA', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    requestTechnology.mockResolvedValueOnce(NfcTech.IsoDep as never);
    transceive.mockResolvedValueOnce([0x6a, 0x82]); // File not found

    await expect(withSecureNfcTag(async () => 'ok')).rejects.toThrow(NotSecureNfcTag);
    expect(cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  });

  it('lanza NotSecureNfcTag si la versión no corresponde a NTAG 424 DNA', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    requestTechnology.mockResolvedValueOnce(NfcTech.IsoDep as never);
    const hexToBytes = (hex: string) => hex.match(/../g)!.map((b) => Number.parseInt(b, 16));

    transceive
      .mockResolvedValueOnce(hexToBytes('9000'))
      .mockResolvedValueOnce(hexToBytes('0102030405060791AF'))
      .mockResolvedValueOnce(hexToBytes('0102030405060791AF'))
      .mockResolvedValueOnce(hexToBytes('0102030405060708090a0b0c0d0e9100'));

    await expect(withSecureNfcTag(async () => 'ok')).rejects.toThrow(NotSecureNfcTag);
  });
});
