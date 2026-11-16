import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySmsSignature(input: {
  rawBody?: Buffer;
  timestamp?: string;
  signature?: string;
  secret?: string;
  now: Date;
}): boolean {
  const { rawBody, timestamp, signature, secret, now } = input;
  if (
    !secret ||
    !rawBody ||
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    !signature ||
    !/^sha256=[0-9a-f]{64}$/i.test(signature) ||
    Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
