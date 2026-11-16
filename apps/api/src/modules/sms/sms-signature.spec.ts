import { createHmac } from 'node:crypto';
import { verifySmsSignature } from './sms-signature';

describe('firma SMS', () => {
  const secret = 's'.repeat(32);
  const rawBody = Buffer.from('{ "id": "sms-1" }');
  const now = new Date('2035-01-01T12:00:00Z');
  const timestamp = String(now.getTime() / 1000);
  const signature = `sha256=${createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(rawBody)
    .digest('hex')}`;
  it('autentica los bytes originales', () => {
    expect(verifySmsSignature({ rawBody, timestamp, signature, secret, now })).toBe(true);
    expect(
      verifySmsSignature({ rawBody: Buffer.from('{}'), timestamp, signature, secret, now }),
    ).toBe(false);
  });
  it.each([undefined, 'sha256=no', `sha256=${'0'.repeat(64)}`])('rechaza firma %s', (invalid) => {
    expect(verifySmsSignature({ rawBody, timestamp, signature: invalid, secret, now })).toBe(false);
  });
  it('rechaza fechas viejas, futuras, cuerpo ausente y secreto ausente', () => {
    for (const offset of [-301000, 301000])
      expect(
        verifySmsSignature({
          rawBody,
          timestamp,
          signature,
          secret,
          now: new Date(now.getTime() + offset),
        }),
      ).toBe(false);
    expect(verifySmsSignature({ timestamp, signature, secret, now })).toBe(false);
    expect(verifySmsSignature({ rawBody, timestamp, signature, now })).toBe(false);
  });
});
