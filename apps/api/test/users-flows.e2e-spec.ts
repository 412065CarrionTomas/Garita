import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ResendInvitationMailer } from '../src/modules/users/email.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('Flujos de gestión de personal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService['systemPrisma'];
  const suffix = randomUUID();
  const uidPrefix = `e2e-hu03-${suffix}-`;
  const emailPrefix = `hu03-${suffix}-`;
  const identity = {
    verifyIdToken: jest.fn((token: string) => Promise.resolve({ uid: token.replace('user:', '') })),
    createDisabledUser: jest.fn((email: string) =>
      Promise.resolve({ uid: `${uidPrefix}${email}` }),
    ),
    deleteUser: jest.fn(() => Promise.resolve()),
    setDisabled: jest.fn(() => Promise.resolve()),
    revokeRefreshTokens: jest.fn(() => Promise.resolve()),
    generatePasswordResetLink: jest.fn((email: string) =>
      Promise.resolve(`https://reset.invalid/?email=${email}`),
    ),
  };
  const mailer = {
    sendInvitation: jest.fn((_input: { name: string; email: string; link: string }) =>
      Promise.resolve({ id: `mail-${suffix}` }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue(identity)
      .overrideProvider(ResendInvitationMailer)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService).systemPrisma;
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany({
      where: { user: { firebaseUid: { startsWith: uidPrefix } } },
    });
    await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: uidPrefix } } });
    await app.close();
  });

  const admin = { Authorization: 'Bearer user:seed-norte-admin' };
  const payload = (tag: string, role = 'guard') => ({
    firstName: 'E2E',
    lastName: tag,
    email: `${emailPrefix}${tag}@example.invalid`,
    role,
    phone: '+5491123456789',
    employeeNumber: tag,
  });
  const create = async (tag: string, role = 'guard') => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/usuarios')
      .set(admin)
      .send(payload(tag, role))
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload(tag, role).email },
    });
    return { response, user };
  };
  const tokenFromMail = (callIndex: number) => {
    const link = mailer.sendInvitation.mock.calls[callIndex]?.[0]?.link;
    if (!link) throw new Error('El fake de correo no recibió el enlace de invitación');
    return new URL(link).searchParams.get('token') ?? '';
  };

  it('limita el canje: el intento 11 por IP en el minuto da 429', async () => {
    const expressApp = app.getHttpAdapter().getInstance() as unknown as Express;
    expressApp.set('trust proxy', true);
    for (let attempt = 1; attempt <= 10; attempt++) {
      await request(app.getHttpServer())
        .post('/api/v1/invitaciones/canjear')
        .set('x-forwarded-for', '203.0.113.77')
        .send({ token: `invalid-${suffix}-${attempt}` })
        .expect(410);
    }
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .set('x-forwarded-for', '203.0.113.77')
      .send({ token: `invalid-${suffix}-11` })
      .expect(429);
  });

  it('crea pending, persiste solo el hash y envía una invitación', async () => {
    const start = mailer.sendInvitation.mock.calls.length;
    const { response, user } = await create('create');
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    const token = tokenFromMail(start);
    expect(isRecord(response.body) && response.body.status).toBe('invitation_pending');
    expect(invitation.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(invitation)).not.toContain(token);
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(start + 1);
  });

  it('rechaza el correo duplicado con 409', async () => {
    await create('duplicate');
    const response = await request(app.getHttpServer())
      .post('/api/v1/usuarios')
      .set(admin)
      .send(payload('duplicate'))
      .expect(409);
    expect(JSON.stringify(response.body)).toContain('Ese correo ya está en uso');
  });

  it('rechaza role y email en PATCH sin cambiar los datos', async () => {
    const { user } = await create('patch');
    await request(app.getHttpServer())
      .patch(`/api/v1/usuarios/${user.id}`)
      .set(admin)
      .send({ firstName: 'Changed', role: 'admin', email: 'changed@example.invalid' })
      .expect(200);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      role: 'guard',
      email: payload('patch').email,
    });
  });

  it('desactivar deniega el siguiente request y deshabilita y revoca Firebase', async () => {
    const { user } = await create('deactivate');
    const uid = user.firebaseUid;
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/desactivar`)
      .set(admin)
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer user:${uid}` })
      .expect(403);
    expect(identity.setDisabled).toHaveBeenCalledWith(uid, true);
    expect(identity.revokeRefreshTokens).toHaveBeenCalledWith(uid);
  });

  it('reactivar devuelve el acceso al usuario', async () => {
    const { user } = await create('reactivate');
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/desactivar`)
      .set(admin)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/reactivar`)
      .set(admin)
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer user:${user.firebaseUid}` })
      .expect(200);
  });

  it('canje válido devuelve URL de contraseña y rol; expirado, usado y reemplazado dan 410', async () => {
    const { user } = await create('redeem', 'supervisor');
    const token = tokenFromMail(mailer.sendInvitation.mock.calls.length - 1);
    const valid = await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token })
      .expect(201);
    expect(isRecord(valid.body) && valid.body.role).toBe('supervisor');
    expect(
      isRecord(valid.body) && typeof valid.body.passwordSetupUrl === 'string'
        ? valid.body.passwordSetupUrl
        : '',
    ).toContain('https://reset.invalid/');
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token })
      .expect(410);
    const expired = await create('expired');
    const expiredToken = tokenFromMail(mailer.sendInvitation.mock.calls.length - 1);
    await prisma.invitation.updateMany({
      where: { userId: expired.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token: expiredToken })
      .expect(410);
    const used = await create('used');
    const usedToken = tokenFromMail(mailer.sendInvitation.mock.calls.length - 1);
    await prisma.invitation.updateMany({
      where: { userId: used.user.id },
      data: { usedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token: usedToken })
      .expect(410);
    const replaced = await create('replaced');
    const replacedToken = tokenFromMail(mailer.sendInvitation.mock.calls.length - 1);
    await prisma.invitation.updateMany({
      where: { userId: replaced.user.id },
      data: { replacedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token: replacedToken })
      .expect(410);
  });

  it('reenviar invalida la invitación anterior', async () => {
    const { user } = await create('resend');
    const oldToken = tokenFromMail(mailer.sendInvitation.mock.calls.length - 1);
    const callCount = mailer.sendInvitation.mock.calls.length;
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/reenviar-invitacion`)
      .set(admin)
      .expect(201);
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(callCount + 1);
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token: oldToken })
      .expect(410);
  });

  it('primer /auth/me activa al usuario y marca usada la invitación', async () => {
    const { user } = await create('first-me');
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer user:${user.firebaseUid}` })
      .expect(200);
    expect(isRecord(response.body) && response.body.status).toBe('active');
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    expect(invitation.usedAt).toBeInstanceOf(Date);
  });

  it('registra sendStatus failed y conserva el usuario si falla el correo', async () => {
    const failEmail = `${emailPrefix}mail-failure@example.invalid`;
    mailer.sendInvitation.mockRejectedValueOnce(new Error('mail unavailable'));
    const response = await request(app.getHttpServer())
      .post('/api/v1/usuarios')
      .set(admin)
      .send({ ...payload('mail-failure'), email: failEmail })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: failEmail } });
    expect(isRecord(response.body) && response.body.id).toBe(user.id);
    await expect(
      prisma.invitation.findFirstOrThrow({ where: { userId: user.id } }),
    ).resolves.toMatchObject({ sendStatus: 'failed' });
  });
});
