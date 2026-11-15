import { ResendInvitationMailer } from './email.service';

describe('correo de recordatorio de prueba', () => {
  const input = {
    name: '<Ana>',
    email: 'ana@example.invalid',
    companyId: 'company',
    userId: 'admin',
    daysLeft: 1,
  };
  const config = {
    get: (key: string) =>
      (
        ({
          RESEND_API_KEY: 'fake-key',
          RESEND_FROM: 'Garita <test@example.invalid>',
          WEB_APP_URL: 'https://panel.example.invalid',
        }) as Record<string, string>
      )[key],
  };
  afterEach(() => jest.restoreAllMocks());

  it('envía texto singular, escapa HTML y usa la misma clave idempotente al reintentar', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ id: 'mail' }), { status: 200 })),
      );
    const mailer = new ResendInvitationMailer(config as never);
    await mailer.sendTrialReminder(input);
    await mailer.sendTrialReminder(input);
    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== 'string') throw new Error('Falta el cuerpo del correo');
    const body = JSON.parse(request.body) as { text: string; html: string };
    expect(body.text).toContain('Te queda 1 día de prueba');
    expect(body.text).toContain('https://panel.example.invalid/suscripcion');
    expect(body.html).toContain('&lt;Ana&gt;');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(request.headers);
  });
  it('propaga error del proveedor para no marcar el recordatorio enviado', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(
      new ResendInvitationMailer(config as never).sendTrialReminder(input),
    ).rejects.toThrow('Resend respondió 503');
  });
});
