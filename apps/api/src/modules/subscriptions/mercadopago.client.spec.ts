import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { MercadoPagoClient, MercadoPagoRetryableError } from './mercadopago.client';

describe('MercadoPagoClient (HTTP simulado)', () => {
  const client = new MercadoPagoClient({ get: () => 'test-token' } as unknown as ConfigService<
    Env,
    true
  >);
  afterEach(() => jest.restoreAllMocks());
  it('reads all invoice pages and preserves exact decimal strings', async () => {
    const payment = (id: number) => ({ id, preapproval_id: 'mp', transaction_amount: '123.45' });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ paging: { total: 2, offset: 0, limit: 1 }, results: [payment(1)] }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ paging: { total: 2, offset: 1, limit: 1 }, results: [payment(2)] }),
        ),
      );
    expect(await client.searchAuthorizedPayments('mp')).toMatchObject([
      { id: '1', transaction_amount: '123.45' },
      { id: '2', transaction_amount: '123.45' },
    ]);
    expect(fetch.mock.calls[1]?.[0]).toEqual(expect.stringContaining('offset=1'));
  });
  it('propagates a 429 with Retry-After to the queue backoff', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    await expect(client.getPreapproval('mp')).rejects.toMatchObject({ retryAfterMs: 60_000 });
  });
  it('rejects malformed remote amounts and lets network failures reach the retrying worker', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 1, preapproval_id: 'mp', transaction_amount: 'garbage' }),
        ),
      )
      .mockRejectedValueOnce(new TypeError('network'));
    await expect(client.getAuthorizedPayment('1')).rejects.toThrow('Respuesta inesperada');
    await expect(client.getAuthorizedPayment('1')).rejects.toThrow('network');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new MercadoPagoRetryableError(1000, '429').retryAfterMs).toBe(1000);
  });
});
