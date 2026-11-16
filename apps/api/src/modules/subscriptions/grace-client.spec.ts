import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { MercadoPagoClient } from './mercadopago.client';

describe('Checkout Pro para gracia (HTTP mockeado)', () => {
  const client = new MercadoPagoClient({ get: () => 'test-token' } as unknown as ConfigService<
    Env,
    true
  >);
  afterEach(() => jest.restoreAllMocks());
  it('crea la preferencia con referencia, monto decimal exacto y URLs de retorno', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'pref', init_point: 'https://mp.test/pay' })),
      );
    expect(
      await client.createPreference({
        externalReference: 'grace:charge',
        amount: '9999999999.99',
        title: 'Garita',
        backUrl: 'https://web.test/suscripcion',
      }),
    ).toEqual({ id: 'pref', initPoint: 'https://mp.test/pay' });
    const body = fetch.mock.calls[0]?.[1]?.body;
    expect(body).toEqual(expect.stringContaining('"unit_price":9999999999.99'));
    expect(body).toEqual(expect.stringContaining('"external_reference":"grace:charge"'));
    expect(body).toEqual(expect.stringContaining('"currency_id":"ARS"'));
  });
  it('rechaza decimales inválidos antes de HTTP y ajusta el vencimiento por API', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"pref"}'));
    await expect(
      client.createPreference({
        externalReference: 'grace:c',
        amount: 'NaN',
        title: 'Garita',
        backUrl: 'https://web.test',
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await client.expireGracePreference('pref', new Date('2030-12-02T15:00:00Z'));
    expect(fetch).toHaveBeenCalledWith(
      'https://api.mercadopago.com/checkout/preferences/pref',
      expect.objectContaining({
        method: 'PUT',
        body: '{"expires":true,"expiration_date_to":"2030-12-02T15:00:00.000Z"}',
      }),
    );
  });
  it('pagina pagos por referencia y conserva su moneda', async () => {
    const page = (id: string) => ({
      paging: { total: 2 },
      results: [
        {
          id,
          status: 'pending',
          external_reference: 'grace:charge',
          transaction_amount: '10.00',
          currency_id: 'ARS',
        },
      ],
    });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(page('1'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page('2'))));
    expect(await client.searchGracePayments('grace:charge')).toHaveLength(2);
    expect(fetch.mock.calls[1]?.[0]).toEqual(expect.stringContaining('offset=1'));
  });
});
