import { associateNfcTagSchema, normalizeNfcUid } from './nfc-tags';

describe('UID NFC', () => {
  it('normaliza minúsculas y separadores', () => {
    expect(normalizeNfcUid('04:a1-02 0b')).toBe('04A1020B');
    expect(associateNfcTagSchema.parse({ uid: '04:a1-02 0b' }).uid).toBe('04A1020B');
  });

  it('acepta UID de 8 bytes ISO 15693', () => {
    expect(normalizeNfcUid('E004015012345678')).toBe('E004015012345678');
  });

  it.each(['g4a1020b', '04A102', '04A1020B0C0D0E0F123456', '04A1020'])(
    'rechaza UID inválido %s',
    (uid) => {
      expect(() => normalizeNfcUid(uid)).toThrow('El identificador NFC no es válido');
    },
  );
});
