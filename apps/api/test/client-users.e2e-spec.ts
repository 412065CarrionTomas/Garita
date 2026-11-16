import { PlanChangeProcessor } from '../src/modules/subscriptions/plan-change.processor';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import { BadRequestException, type INestApplication, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ResendInvitationMailer } from '../src/modules/users/email.service';
import { UsersService } from '../src/modules/users/users.service';
import {
  clientUserSchema,
  clientUsersSchema,
  authMeResponseSchema,
  invitationRedeemResponseSchema,
  type CreateUserRequest,
} from '@garita/shared';

describe('HU-27 usuarios del portal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService['systemPrisma'];
  let clientId: string;
  let otherClientId: string;
  let southClientId: string;
  const suffix = randomUUID();
  const prefix = `hu27-${suffix}`;
  const admin = { Authorization: 'Bearer user:seed-norte-admin' };
  const identity = {
    verifyIdToken: jest.fn((token: string) => Promise.resolve({ uid: token.replace('user:', '') })),
    createDisabledUser: jest.fn((email: string) => Promise.resolve({ uid: `${prefix}-${email}` })),
    deleteUser: jest.fn(() => Promise.resolve()),
    setDisabled: jest.fn(() => Promise.resolve()),
    revokeRefreshTokens: jest.fn(() => Promise.resolve()),
    generatePasswordResetLink: jest.fn(() => Promise.resolve('https://reset.invalid/password')),
  };
  const mailer = {
    sendInvitation: jest.fn((_input: { name: string; email: string; link: string }) =>
      Promise.resolve({ id: prefix }),
    ),
  };
  const payload = (tag: string) => ({
    firstName: 'Marta',
    lastName: 'Ruiz',
    email: `${prefix}-${tag}@example.invalid`,
    position: 'Jefa de seguridad',
  });
  const auth = (uid: string) => ({ Authorization: `Bearer user:${uid}` });
  const create = async (tag: string) => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/clientes/${clientId}/usuarios`)
      .set(admin)
      .send(payload(tag))
      .expect(201);
    const user = clientUserSchema.parse(response.body);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { user, row };
  };
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue(identity)
      .overrideProvider(ResendInvitationMailer)
      .useValue(mailer)
      .overrideProvider(PlanChangeProcessor)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService).systemPrisma;
    for (const [tag, companyId] of [
      ['a', 'norte-company'],
      ['b', 'norte-company'],
      ['south', 'sur-company'],
    ] as const) {
      const client = await prisma.client.create({
        data: {
          companyId,
          name: `${prefix}-${tag}`,
          contactName: 'Ana',
          phone: '+541112345678',
          email: `${prefix}-${tag}@example.invalid`,
        },
      });
      if (tag === 'a') clientId = client.id;
      else if (tag === 'b') otherClientId = client.id;
      else southClientId = client.id;
      await prisma.site.createMany({
        data: ['active', 'inactive'].map((status) => ({
          companyId,
          clientId: client.id,
          name: `${prefix}-${tag}-${status}`,
          address: 'Calle 123',
          latitude: -34.6,
          longitude: -58.4,
          status: status as 'active' | 'inactive',
        })),
      });
    }
    await prisma.site.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        companyId: 'norte-company',
        clientId,
        name: `${prefix}-extra-${index}`,
        address: 'Calle 456',
        latitude: -34.6,
        longitude: -58.4,
      })),
    });
  });
  afterAll(async () => {
    await prisma.invitation.deleteMany({ where: { user: { email: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await prisma.site.deleteMany({ where: { name: { startsWith: prefix } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: prefix } } });
    await app.close();
  });
  it('CA1 alta pending, correo una vez, hash y vigencia 72 h; listado con cargo y ultimo ingreso', async () => {
    const logger = jest.spyOn(Logger.prototype, 'log');
    const before = mailer.sendInvitation.mock.calls.length;
    const { user } = await create('invite');
    expect(user).toMatchObject({
      role: 'client',
      status: 'invitation_pending',
      clientId,
      position: 'Jefa de seguridad',
      lastLoginAt: null,
      invitationStatus: 'sent',
    });
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(before + 1);
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    expect(invitation.expiresAt.getTime() - invitation.createdAt.getTime()).toBeGreaterThan(
      71 * 3600_000,
    );
    expect(invitation.expiresAt.getTime() - invitation.createdAt.getTime()).toBeLessThanOrEqual(
      72 * 3600_000,
    );
    const response = await request(app.getHttpServer())
      .get(`/api/v1/clientes/${clientId}/usuarios`)
      .set(admin)
      .expect(200);
    expect(clientUsersSchema.parse(response.body)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: user.id })]),
    );
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'personnel_created',
        actorUserId: (
          await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-admin' } })
        ).id,
        userId: user.id,
      }),
    );
    logger.mockRestore();
  });
  it('correo repetido 409 sin otro envio; validacion estricta y relacion inmutable', async () => {
    const { user } = await create('duplicate');
    const before = mailer.sendInvitation.mock.calls.length;
    await request(app.getHttpServer())
      .post(`/api/v1/clientes/${clientId}/usuarios`)
      .set(admin)
      .send(payload('duplicate'))
      .expect(409);
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(before);
    for (const invalid of [
      { firstName: 'A' },
      { lastName: 'B' },
      { firstName: 'A'.repeat(61) },
      { email: 'bad' },
      { position: 'A'.repeat(81) },
      { clientId: otherClientId },
      { role: 'admin' },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/clientes/${clientId}/usuarios`)
        .set(admin)
        .send({ ...payload(randomUUID()), ...invalid })
        .expect(400);
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/usuarios/${user.id}`)
      .set(admin)
      .send({ firstName: 'Maria', clientId: otherClientId })
      .expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).clientId).toBe(
      clientId,
    );
  });
  it('CA2 activa invitacion una vez, canal web y todos y solo los predios activos propios', async () => {
    const before = mailer.sendInvitation.mock.calls.length;
    const { user, row } = await create('activate');
    const token = new URL(
      mailer.sendInvitation.mock.calls[before]?.[0].link ?? '',
    ).searchParams.get('token');
    const redeemed = await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token })
      .expect(201);
    expect(invitationRedeemResponseSchema.parse(redeemed.body).role).toBe('client');
    const profile = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(row.firebaseUid))
      .expect(200);
    expect(authMeResponseSchema.parse(profile.body)).toMatchObject({
      status: 'active',
      allowedChannels: ['web'],
    });
    await request(app.getHttpServer())
      .post('/api/v1/invitaciones/canjear')
      .send({ token })
      .expect(410);
    const sites = await request(app.getHttpServer())
      .get('/api/v1/predios')
      .set(auth(row.firebaseUid))
      .expect(200);
    const expected = await prisma.site.findMany({
      where: { clientId, status: 'active' },
      orderBy: { name: 'asc' },
    });
    const actualSites = z
      .array(z.object({ id: z.string(), clientId: z.string(), status: z.string() }))
      .parse(sites.body);
    expect(actualSites).toHaveLength(201);
    expect(actualSites).toEqual(
      expected.map((site) => ({ id: site.id, clientId, status: 'active' })),
    );
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/predios?cliente=${otherClientId}`)
      .set(auth(row.firebaseUid))
      .expect(200);
    expect(filtered.body).toEqual([]);
    const inactive = await request(app.getHttpServer())
      .get('/api/v1/predios?estado=inactive')
      .set(auth(row.firebaseUid))
      .expect(200);
    expect(inactive.body).toEqual([]);
    const firstLogin = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .lastLoginAt;
    expect(firstLogin).not.toBeNull();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(row.firebaseUid))
      .expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).toEqual(
      firstLogin,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date('2020-01-01') },
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(row.firebaseUid))
      .expect(200);
    expect(
      (
        await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      ).lastLoginAt?.getUTCFullYear(),
    ).toBeGreaterThan(2020);
  });
  it('CA3 desactiva, revoca Firebase, bloquea acceso y permite reactivar y reenviar', async () => {
    const { user, row } = await create('manage');
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/desactivar`)
      .set(admin)
      .send({})
      .expect(201);
    expect(identity.revokeRefreshTokens).toHaveBeenCalledWith(row.firebaseUid);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(row.firebaseUid))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/predios')
      .set(auth(row.firebaseUid))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/reactivar`)
      .set(admin)
      .send({})
      .expect(201);
    // Nunca ingresó: vuelve a invitación pendiente y necesita una invitación nueva.
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { status: true } }),
    ).resolves.toEqual({ status: 'invitation_pending' });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(row.firebaseUid))
      .expect(403);
    const before = mailer.sendInvitation.mock.calls.length;
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${user.id}/reenviar-invitacion`)
      .set(admin)
      .send({})
      .expect(201);
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(before + 1);
  });
  it('regla de servicio role=client si y solo si hay clientId', async () => {
    const service = app.get(UsersService);
    for (const input of [
      { ...payload('invalid-role'), role: 'guard', clientId },
      { ...payload('invalid-id'), role: 'client' },
    ]) {
      await expect(
        service.create(input as unknown as CreateUserRequest, 'admin', 'norte-company'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
  it('CA4 baja atomica desactiva todos y reemplaza invitaciones; impide altas y reactivaciones', async () => {
    const a = await create('cascade-a');
    const b = await create('cascade-b');
    await prisma.user.update({ where: { id: a.user.id }, data: { status: 'active' } });
    const impact = await request(app.getHttpServer())
      .get(`/api/v1/clientes/${clientId}/impacto-baja`)
      .set(admin)
      .expect(200);
    expect(JSON.stringify(impact.body)).toContain('usersToDeactivate');
    await request(app.getHttpServer())
      .post(`/api/v1/clientes/${clientId}/baja`)
      .set(admin)
      .send({ confirm: true })
      .expect(201);
    for (const id of [a.user.id, b.user.id])
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('deactivated');
    expect(
      await prisma.invitation.count({
        where: { user: { clientId }, replacedAt: null, usedAt: null },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(a.row.firebaseUid))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/clientes/${clientId}/usuarios`)
      .set(admin)
      .send(payload('inactive'))
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${a.user.id}/reactivar`)
      .set(admin)
      .send({})
      .expect(409);
  });
  it('CA5 nuevos endpoints sin token 401, supervisor 403, otra empresa 404', async () => {
    for (const method of ['get', 'post'] as const) {
      const path = `/api/v1/clientes/${otherClientId}/usuarios`;
      await request(app.getHttpServer())[method](path).send(payload('permissions')).expect(401);
      await request(app.getHttpServer())
        [method](path)
        .set(auth('seed-norte-supervisor'))
        .send(payload('permissions'))
        .expect(403);
      await request(app.getHttpServer())
        [method](`/api/v1/clientes/${southClientId}/usuarios`)
        .set(admin)
        .send(payload('permissions'))
        .expect(404);
    }
  });
});
