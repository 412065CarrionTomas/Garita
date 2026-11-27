import { createHmac } from 'node:crypto';
import { verifyMercadoPagoSignature } from './mercadopago-signature';

const secret = 'test-webhook-secret';
const sign = (manifest: string) => createHmac('sha256', secret).update(manifest).digest('hex');

describe('verifyMercadoPagoSignature', () => {
  const ts = '1704908010';
  const requestId = 'req-123';
  const dataId = 'ABC123';
  const valid = sign(`id:abc123;request-id:${requestId};ts:${ts};`);

  it('accepts a signature built from the official manifest (lowercased id)', () => {
    expect(
      verifyMercadoPagoSignature({ signature: `ts=${ts},v1=${valid}`, requestId, dataId, secret }),
    ).toEqual({ valid: true, ts });
  });

  it('omits missing parts from the manifest', () => {
    const v1 = sign(`id:abc123;ts:${ts};`);
    expect(
      verifyMercadoPagoSignature({
        signature: `ts=${ts},v1=${v1}`,
        requestId: undefined,
        dataId,
        secret,
      }).valid,
    ).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['malformed header', 'garbage'],
    ['tampered hash', `ts=${ts},v1=${'0'.repeat(64)}`],
    ['other timestamp', `ts=1704908011,v1=${valid}`],
  ])('rejects %s', (_label, signature) => {
    expect(verifyMercadoPagoSignature({ signature, requestId, dataId, secret }).valid).toBe(false);
  });

  it('rejects a different data id', () => {
    expect(
      verifyMercadoPagoSignature({
        signature: `ts=${ts},v1=${valid}`,
        requestId,
        dataId: 'other',
        secret,
      }).valid,
    ).toBe(false);
  });
});
