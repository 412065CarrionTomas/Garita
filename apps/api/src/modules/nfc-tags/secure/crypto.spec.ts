import { performance } from 'node:perf_hooks';
import { aesCbc, aesCmac, deriveTagKey, truncateMac, verifySun } from './crypto';

describe('NTAG 424 DNA crypto', () => {
  const zero = Buffer.alloc(16);

  it('reproduce AN10922 section 2.2.1 CMAC diversification vector', () => {
    const key = Buffer.from('00112233445566778899AABBCCDDEEFF', 'hex');
    const diversificationInput = Buffer.from('0104782E21801D803042F54E585020416275', 'hex');
    expect(aesCmac(key, diversificationInput).toString('hex').toUpperCase()).toBe(
      'A8DD63A3B89D54B37CA802473FDA9175',
    );
  });

  it('binds NIST SP 800-108 derived keys to UID, slot and version', () => {
    const uid = Buffer.from('04DE5F1EACC040', 'hex');
    const key = deriveTagKey(zero, uid, 2, 1);
    expect(key).toHaveLength(16);
    expect(key).toEqual(deriveTagKey(zero, uid, 2, 1));
    expect(key).not.toEqual(deriveTagKey(zero, uid, 1, 1));
    expect(key).not.toEqual(deriveTagKey(zero, uid, 2, 2));
    expect(key).not.toEqual(deriveTagKey(zero, Buffer.from('04DE5F1EACC041', 'hex'), 2, 1));
  });

  it('reproduce AN12196 sections 3.4.2.2 and 3.4.4.2 PICCData, session key and truncated CMAC', () => {
    const encrypted = Buffer.from('EF963FF7828658A599F3041510671E88', 'hex');
    expect(aesCbc(zero, zero, encrypted, true).toString('hex').toUpperCase()).toBe(
      'C704DE5F1EACC0403D0000DA5CF60941',
    );
    const sessionKey = aesCmac(zero, Buffer.from('3CC30001008004DE5F1EACC0403D0000', 'hex'));
    expect(sessionKey.toString('hex').toUpperCase()).toBe('3FB5F6E3A807A03D5E3570ACE393776F');
    expect(
      truncateMac(aesCmac(sessionKey, Buffer.alloc(0)))
        .toString('hex')
        .toUpperCase(),
    ).toBe('94EED9EE65337086');
  });

  it('accepts a SUN, rejects altered signature and identifies replay within 50 ms', () => {
    const message = 'garita:nfc?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086';
    const start = performance.now();
    expect(verifySun(message, '04DE5F1EACC040', zero, zero, null)).toEqual({
      result: 'valid',
      counter: 61,
    });
    expect(performance.now() - start).toBeLessThan(50);
    expect(verifySun(message, '04DE5F1EACC040', zero, zero, 61).result).toBe('replayed');
    expect(
      verifySun(message.replace('94EED9EE', '04EED9EE'), '04DE5F1EACC040', zero, zero, null).result,
    ).toBe('invalid_signature');
    expect(verifySun(message, '04DE5F1EACC041', zero, zero, null).result).toBe('invalid_signature');
    expect(verifySun(undefined, '04DE5F1EACC040', zero, zero, null).result).toBe('missing');
  });
});
