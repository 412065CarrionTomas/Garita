import { associateNfcTagSchema, normalizeNfcUid } from './nfc-tags';

describe('UID NFC', () => {
  it('normaliza minúsculas y separadores', () => {
    expect(normalizeNfcUid('04:a1-02 0b')).toBe('04A1020B');
    expect(associateNfcTagSchema.parse({ uid: '04:a1-02 0b' }).uid).toBe('04A1020B');
  });

  it.each(['g4a1020b', '04A102', '04A1020B0C0D0E0F'])('rechaza UID inválido %s', (uid) => {
    expect(() => normalizeNfcUid(uid)).toThrow('El identificador NFC no es válido');
  });
});
