import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { ResendInvitationMailer } from '../users/email.service';

it('correo de gracia lleva fecha, monto, idempotencia y escapa texto externo', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"email"}'));
  try {
    const config = {
      get: (key: string) =>
        (
          ({
            RESEND_API_KEY: 'test',
            RESEND_FROM: 'test@example.invalid',
            WEB_APP_URL: 'https://web.test',
          }) as Record<string, string>
        )[key],
    };
    const mailer = new ResendInvitationMailer(config as unknown as ConfigService<Env, true>);
    await mailer.sendGraceReminder({
      name: '<Ana>',
      email: 'ana@example.invalid',
      companyId: 'company',
      userId: 'admin',
      chargeId: 'charge',
      daysLeft: 3,
      endsAt: new Date('2030-12-09T02:59:00Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      amount: '45000.00',
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'grace-charge-3-admin',
    });
    if (typeof init?.body !== 'string') throw new Error('Missing request body');
    const body = z
      .object({ html: z.string(), text: z.string() })
      .parse(JSON.parse(init.body) as unknown);
    expect(body.html).toContain('&lt;Ana&gt;');
    expect(body.text).toContain('23:59');
    expect(body.text).toContain('8/12/30');
  } finally {
    fetch.mockRestore();
  }
});
