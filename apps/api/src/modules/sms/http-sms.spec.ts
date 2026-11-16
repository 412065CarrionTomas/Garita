import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NoopSms } from '../../common/ports/sms.port';
import { envSchema, type Env } from '../../config/env';
import { HttpSms, smsProvider } from './http-sms';

const config = (values: Record<string, unknown>) => new ConfigService<Env, true>(values);
describe('proveedor SMS apagado por defecto y adaptador HTTP', () => {
  afterEach(() => jest.restoreAllMocks());
  const settings = {
    SMS_PROVIDER: 'http',
    SMS_GATEWAY_URL: 'https://gateway.invalid/sms',
    SMS_GATEWAY_TOKEN: 'private-token',
  };
  const input = {
    phone: '+5493511234567',
    companyId: 'north',
    alertId: 'alert',
    message: 'mensaje sensible',
  };
  it('sin SMS_PROVIDER usa NoopSms y no entrega', async () => {
    const provider = smsProvider(config({}));
    expect(provider).toBeInstanceOf(NoopSms);
    await expect(provider.sendPanicAlert(input)).resolves.toEqual({ sent: false });
  });
  it('exige URL y token cuando se elige http', () => {
    const base = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/test',
      REDIS_URL: 'redis://localhost',
      SMS_PROVIDER: 'http',
    };
    expect(envSchema.safeParse(base).success).toBe(false);
    expect(envSchema.safeParse({ ...base, ...settings }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, ...settings, SMS_WEBHOOK_SECRET: 'short' }).success).toBe(
      false,
    );
  });
  it('2xx entrega el contrato genérico con timeout y sin redirecciones', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    const provider = smsProvider(config(settings));
    expect(provider).toBeInstanceOf(HttpSms);
    await expect(provider.sendPanicAlert(input)).resolves.toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledWith(
      settings.SMS_GATEWAY_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-token' },
        body: JSON.stringify({ to: input.phone, message: input.message }),
        redirect: 'error',
        signal: expect.any(AbortSignal) as unknown,
      }),
    );
    await provider.sendShiftClosed({
      phone: input.phone,
      message: input.message,
      shiftId: 'shift',
      guardId: 'guard',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(['http', 'timeout', 'network'])(
    'error %s devuelve false sin registrar datos sensibles',
    async (failure) => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      if (failure === 'http') fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
      else fetchMock.mockRejectedValue(new Error(`${failure} private-token mensaje sensible`));
      await expect(new HttpSms(config(settings)).sendPanicAlert(input)).resolves.toEqual({
        sent: false,
      });
      expect(error).toHaveBeenCalledWith({ event: 'sms.delivery_failed' });
      expect(JSON.stringify(error.mock.calls)).not.toMatch(
        /private-token|mensaje sensible|3511234567/,
      );
    },
  );
});
