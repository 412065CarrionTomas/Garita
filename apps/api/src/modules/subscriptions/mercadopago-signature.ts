import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MercadoPagoSignatureInput {
  /** Header `x-signature`: `ts=<timestamp>,v1=<hmac hex>`. */
  signature: string | undefined;
  /** Header `x-request-id`. */
  requestId: string | undefined;
  /** Query param `data.id` of the notification URL. */
  dataId: string | undefined;
  secret: string;
}

export interface MercadoPagoSignatureResult {
  valid: boolean;
  ts?: string;
}

/**
 * Verifies a Mercado Pago webhook per the official manifest
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, omitting the parts that are missing.
 */
export function verifyMercadoPagoSignature(
  input: MercadoPagoSignatureInput,
): MercadoPagoSignatureResult {
  if (!input.signature) return { valid: false };
  const parts = Object.fromEntries(
    input.signature.split(',').map((part) => {
      const [key = '', ...rest] = part.split('=');
      return [key.trim(), rest.join('=').trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return { valid: false };

  // Mercado Pago signs alphanumeric ids in lowercase.
  const dataId =
    input.dataId && /^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
  const manifest =
    (dataId ? `id:${dataId};` : '') +
    (input.requestId ? `request-id:${input.requestId};` : '') +
    `ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest();
  const received = Buffer.from(v1, 'hex');
  return { valid: received.length === expected.length && timingSafeEqual(received, expected), ts };
}
