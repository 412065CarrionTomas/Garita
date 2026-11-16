import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { MercadoPagoClient, MercadoPagoRetryableError } from './mercadopago.client';

describe('MercadoPagoClient (HTTP simulado)', () => {
  const client = new MercadoPagoClient({ get: () => 'test-token' } as unknown as ConfigService<
    Env,
    true
  >);
  afterEach(() => jest.restoreAllMocks());
  it('crea preferencia y actualiza importe/expiraci�n con decimales JSON exactos', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pref', init_point: 'https://mp.example.invalid/pay' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'pref' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'mp', status: 'authorized' })));
    await expect(
      client.createPreference({
        externalReference: 'plan-change:p',
        title: 'Diferencia',
        amount: '26666.67',
        backUrl: 'https://garita.example.invalid/suscripcion',
      }),
    ).resolves.toEqual({ id: 'pref', initPoint: 'https://mp.example.invalid/pay' });
    expect(fetch.mock.calls[0]?.[1]?.body).toEqual(
      expect.stringContaining('"unit_price":26666.67'),
    );
    await client.setPreferenceExpiration('pref', new Date('2030-11-12T12:00:00Z'));
    expect(fetch.mock.calls[1]?.[1]?.body).toEqual(
      expect.stringContaining('"expiration_date_to":"2030-11-12T12:00:00.000Z"'),
    );
    await client.updatePreapprovalAmount('mp', '90000.00');
    expect(fetch.mock.calls[2]?.[1]?.body).toBe(
      '{"auto_recurring":{"transaction_amount":90000.00,"currency_id":"ARS"}}',
    );
    expect(fetch.mock.calls[2]?.[1]?.method).toBe('PUT');
  });
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
