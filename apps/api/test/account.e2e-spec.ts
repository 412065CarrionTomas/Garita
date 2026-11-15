import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { accountStateResponseSchema, trialEndsAt } from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { CLOCK } from '../src/common/clock';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ResendInvitationMailer } from '../src/modules/users/email.service';
import { AccountService } from '../src/modules/account/account.service';
import { AccountTrialProcessor } from '../src/modules/account/account-trial.processor';

describe('HU-41 cuenta y cupo por HTTP', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const companyId = `hu41-${randomUUID()}`;
  const createdAt = new Date('2030-11-01T15:00:00Z');
  let now = createdAt;
  let limit: number;
  let planId: string;
  const auth = (role = 'admin') => ({ Authorization: `Bearer ${companyId}-${role}` });
  const mailer = {
    sendInvitation: jest.fn().mockResolvedValue({ id: 'mail' }),
    sendTrialReminder: jest.fn().mockResolvedValue({ id: 'reminder' }),
  };
  const identity = {
    verifyIdToken: (uid: string) => Promise.resolve({ uid }),
    createDisabledUser: (email: string) => Promise.resolve({ uid: email }),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    setDisabled: jest.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
    generatePasswordResetLink: jest.fn().mockResolvedValue('https://reset.example.invalid'),
  };
  const payload = (role = 'guard') => ({
    role,
    firstName: 'Ana',
    lastName: 'Prueba',
    phone: '+5491123456789',
    email: `${randomUUID()}@example.invalid`,
  });

  async function fillSlots(count: number) {
    for (let i = 0; i < count; i++)
      await db.user.create({
        data: {
          companyId,
          firebaseUid: randomUUID(),
          email: `${randomUUID()}@example.invalid`,
          firstName: 'Cupo',
          lastName: 'Prueba',
          role: 'guard',
          status: i % 2 ? 'invitation_pending' : 'active',
        },
      });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue(identity)
      .overrideProvider(ResendInvitationMailer)
      .useValue(mailer)
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(AccountTrialProcessor)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.create({ data: { id: companyId, name: 'HU-41', createdAt } });
    await app.get(AccountService).startTrial(companyId);
    for (const role of ['admin', 'supervisor'] as const)
      await db.user.create({
        data: {
          companyId,
          firebaseUid: `${companyId}-${role}`,
          email: `${companyId}-${role}@example.invalid`,
          firstName: 'Prueba',
          lastName: role,
          role,
          status: 'active',
        },
      });
    const plan = await db.plan.findFirstOrThrow({
      where: { active: true },
      orderBy: { maxGuards: 'asc' },
    });
    limit = plan.maxGuards;
    planId = plan.id;
  });
  beforeEach(async () => {
    now = createdAt;
    await db.invitation.deleteMany({ where: { user: { companyId } } });
    await db.user.deleteMany({
      where: {
        companyId,
        firebaseUid: { notIn: [`${companyId}-admin`, `${companyId}-supervisor`] },
      },
    });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.company.update({
      where: { id: companyId },
      data: {
        accountStatus: 'trial',
        suspensionReason: null,
        suspendedAt: null,
        trialEndsAt: trialEndsAt(createdAt, 'America/Argentina/Buenos_Aires'),
        trialRemindersSent: [],
      },
    });
  });
  afterAll(async () => {
    await db.invitation.deleteMany({ where: { user: { companyId } } });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });
  it('CA1: administrador ve 14 días desde creación; query ajena no altera el tenant', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cuenta/estado?companyId=sur-company')
      .set(auth())
      .expect(200);
    expect(accountStateResponseSchema.parse(response.body)).toMatchObject({
      status: 'trial',
      trialDaysLeft: 14,
      guardsCounted: 0,
      guardLimit: limit,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/cuenta/${companyId}/estado`)
      .set(auth())
      .expect(404);
  });
  it('CA5: alta y reactivación rechazan cupo completo; supervisor no consume cupo', async () => {
    await fillSlots(limit);
    const response = await request(app.getHttpServer())
      .post('/api/v1/usuarios')
      .set(auth())
      .send(payload())
      .expect(409);
    expect(response.body).toMatchObject({
      code: 'guard_limit_reached',
      guardLimit: limit,
      guardsCounted: limit,
    });
    const inactive = await db.user.create({
      data: {
        companyId,
        firebaseUid: randomUUID(),
        email: `${randomUUID()}@example.invalid`,
        firstName: 'Baja',
        lastName: 'Prueba',
        role: 'guard',
        status: 'deactivated',
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/usuarios/${inactive.id}/reactivar`)
      .set(auth())
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/usuarios')
      .set(auth())
      .send(payload('supervisor'))
      .expect(201);
    expect(
      await db.user.count({
        where: { companyId, role: 'guard', status: { in: ['active', 'invitation_pending'] } },
      }),
    ).toBe(limit);
  });
  it('dos altas concurrentes con un cupo libre producen una 201 y una 409', async () => {
    await fillSlots(limit - 1);
    const responses = await Promise.all(
      [payload(), payload()].map((body) =>
        request(app.getHttpServer()).post('/api/v1/usuarios').set(auth()).send(body),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.user.count({
        where: { companyId, role: 'guard', status: { in: ['active', 'invitation_pending'] } },
      }),
    ).toBe(limit);
  });
  it('CA4: al vencer pasa a suspended con trial_expired y conserva los datos', async () => {
    now = new Date('2030-11-15T03:00:00Z');
    await app.get(AccountService).finishTrial(companyId);
    const response = await request(app.getHttpServer())
      .get('/api/v1/cuenta/estado')
      .set(auth())
      .expect(200);
    expect(accountStateResponseSchema.parse(response.body)).toMatchObject({
      status: 'suspended',
      suspensionReason: 'trial_expired',
      trialDaysLeft: 0,
    });
    await expect(app.get(AccountService).startTrial(companyId)).rejects.toThrow();
    expect(await db.user.count({ where: { companyId } })).toBe(2);
  });
  it('CA3: suscripción diferida en día 5 conserva prueba hasta 23:59 y luego activa', async () => {
    const ends = trialEndsAt(createdAt, 'America/Argentina/Buenos_Aires');
    await db.subscription.create({
      data: {
        companyId,
        planId,
        status: 'authorized',
        startsAt: ends,
        payerEmail: 'payer@example.invalid',
      },
    });
    now = new Date('2030-11-05T15:00:00Z');
    await app.get(AccountService).finishTrial(companyId);
    let response = await request(app.getHttpServer())
      .get('/api/v1/cuenta/estado')
      .set(auth())
      .expect(200);
    expect(accountStateResponseSchema.parse(response.body).status).toBe('trial');
    now = new Date(ends.getTime() - 1);
    await app.get(AccountService).finishTrial(companyId);
    expect((await db.company.findUniqueOrThrow({ where: { id: companyId } })).accountStatus).toBe(
      'trial',
    );
    now = ends;
    await app.get(AccountService).finishTrial(companyId);
    response = await request(app.getHttpServer())
      .get('/api/v1/cuenta/estado')
      .set(auth())
      .expect(200);
    expect(accountStateResponseSchema.parse(response.body).status).toBe('active');
  });
});
