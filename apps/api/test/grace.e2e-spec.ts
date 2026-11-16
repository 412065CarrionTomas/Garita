import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { accountStateResponseSchema } from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { CLOCK } from '../src/common/clock';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ResendInvitationMailer } from '../src/modules/users/email.service';
import { AccountTrialProcessor } from '../src/modules/account/account-trial.processor';
import { GraceProcessor } from '../src/modules/subscriptions/grace.processor';
import { GraceService } from '../src/modules/subscriptions/grace.service';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';
import { MercadoPagoNotificationsProcessor } from '../src/modules/subscriptions/mercadopago-notifications.processor';
import { MercadoPagoReconciliationProcessor } from '../src/modules/subscriptions/mercadopago-reconciliation.processor';
import { MercadoPagoWebhookService } from '../src/modules/subscriptions/mercadopago-webhook.service';

describe('HU-30 HTTP, reloj simulado y Mercado Pago mockeado', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const companyId = `hu30-${randomUUID()}`;
  const otherId = `${companyId}-other`;
  let now = new Date('2030-12-01T15:00:00Z');
  let planId: string;
  let subId: string;
  let status = 'rejected';
  const mailer = {
    sendGraceReminder: jest.fn().mockResolvedValue({ id: 'email' }),
    sendTrialReminder: jest.fn(),
    sendInvitation: jest.fn(),
  };
  const invoice = () => ({
    id: `${companyId}-invoice`,
    preapproval_id: companyId,
    transaction_amount: '45000.00',
    date_created: '2030-12-01T15:00:00Z',
    payment: { id: `${companyId}-debit`, status },
    status: status === 'pending' ? 'waiting for gateway' : 'recycling',
  });
  const mp = {
    getPreapproval: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ id: companyId, status: 'authorized' })),
    searchAuthorizedPayments: jest.fn().mockImplementation(() => Promise.resolve([invoice()])),
    getAuthorizedPayment: jest.fn().mockImplementation(() => Promise.resolve(invoice())),
    searchGracePayments: jest.fn().mockResolvedValue([]),
    createPreference: jest
      .fn()
      .mockResolvedValue({ id: 'preference', initPoint: 'https://mp.test/grace' }),
    expirePreference: jest.fn().mockResolvedValue(undefined),
    getPayment: jest.fn(),
  };
  const auth = (role = 'admin') => ({ Authorization: `Bearer ${companyId}-${role}` });
  const read = () =>
    request(app.getHttpServer()).get('/api/v1/cuenta/estado').set(auth()).expect(200);
  const sync = () =>
    request(app.getHttpServer()).get('/api/v1/suscripcion').set(auth()).expect(200);
  const retry = () =>
    request(app.getHttpServer()).post('/api/v1/suscripcion/reintentar-cobro').set(auth()).send({});
  const notificationIds: string[] = [];

  async function paymentWebhook(paymentStatus = 'approved') {
    const charge = await db.subscriptionCharge.findFirstOrThrow({
      where: { subscriptionId: subId },
    });
    mp.getPayment.mockResolvedValue({
      id: `${companyId}-one-time`,
      external_reference: `grace:${charge.id}`,
      status: paymentStatus,
      transaction_amount: '45000.00',
      currency_id: 'ARS',
    });
    const id = `${companyId}-${randomUUID()}`;
    notificationIds.push(id);
    await app
      .get(MercadoPagoWebhookService)
      .receive({ id, type: 'payment', resourceId: `${companyId}-one-time` });
    await app.get(MercadoPagoWebhookService).process(id);
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (uid: string) => Promise.resolve({ uid }) })
      .overrideProvider(MercadoPagoClient)
      .useValue(mp)
      .overrideProvider(ResendInvitationMailer)
      .useValue(mailer)
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(AccountTrialProcessor)
      .useValue({})
      .overrideProvider(GraceProcessor)
      .useValue({})
      .overrideProvider(MercadoPagoNotificationsProcessor)
      .useValue({})
      .overrideProvider(MercadoPagoReconciliationProcessor)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.createMany({
      data: [
        { id: companyId, name: 'HU30', accountStatus: 'active' },
        { id: otherId, name: 'Otra HU30', accountStatus: 'active' },
      ],
    });
    for (const role of ['admin', 'supervisor', 'guard', 'client'] as const)
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
    await db.user.create({
      data: {
        companyId: otherId,
        firebaseUid: `${companyId}-other-admin`,
        email: `${companyId}-other@example.invalid`,
        firstName: 'Otra',
        lastName: 'Admin',
        role: 'admin',
        status: 'active',
      },
    });
    planId = (
      await db.plan.create({
        data: { code: companyId, name: 'HU30', monthlyPrice: '45000.00', maxGuards: 10 },
      })
    ).id;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    status = 'rejected';
    now = new Date('2030-12-01T15:00:00Z');
    mp.searchGracePayments.mockResolvedValue([]);
    await db.subscriptionCharge.deleteMany({ where: { companyId } });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.company.update({
      where: { id: companyId },
      data: {
        accountStatus: 'active',
        graceChargeId: null,
        graceEndsAt: null,
        graceRemindersSent: [],
        suspensionReason: null,
        suspendedAt: null,
      },
    });
    subId = (
      await db.subscription.create({
        data: {
          companyId,
          planId,
          status: 'authorized',
          startsAt: now,
          mpPreapprovalId: companyId,
          payerEmail: 'payer@example.invalid',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.mercadoPagoNotification.deleteMany({ where: { id: { in: notificationIds } } });
    await db.subscriptionCharge.deleteMany({ where: { companyId } });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
    await db.company.deleteMany({ where: { id: { in: [companyId, otherId] } } });
    await db.plan.delete({ where: { id: planId } });
    await app.close();
  });
  it('CA1/CA2: dos sync concurrentes y notificación repetida generan una gracia y un correo', async () => {
    await Promise.all([sync(), sync()]);
    await sync();
    expect((await read()).body).toMatchObject({
      status: 'grace',
      amountDue: '45000.00',
      graceEndsAt: '2030-12-09T02:59:00.000Z',
    });
    expect(mailer.sendGraceReminder).toHaveBeenCalledTimes(1);
    expect(await db.subscriptionCharge.count({ where: { companyId } })).toBe(1);
    expect(await db.notice.count({ where: { companyId } })).toBe(0);
    expect(
      (await db.subscriptionCharge.findFirstOrThrow({ where: { companyId } })).effectsAppliedStatus,
    ).toBe('rejected');
  });
  it('CA2/CA4: recordatorios 3 y 1 una vez; suspensión después de 23:59 conserva datos', async () => {
    await sync();
    const grace = app.get(GraceService);
    for (const date of ['2030-12-06T15:00:00Z', '2030-12-08T15:00:00Z']) {
      now = new Date(date);
      await grace.sweep();
      await grace.sweep();
    }
    expect(
      mailer.sendGraceReminder.mock.calls.map(([input]: [{ daysLeft: number }]) => input.daysLeft),
    ).toEqual([0, 3, 1]);
    now = new Date('2030-12-09T02:58:59Z');
    await grace.sweep();
    expect(accountStateResponseSchema.parse((await read()).body).status).toBe('grace');
    now = new Date('2030-12-09T02:59:00Z');
    await grace.sweep();
    expect((await read()).body).toMatchObject({
      status: 'suspended',
      suspensionReason: 'grace_expired',
      amountDue: null,
    });
    expect(await db.user.count({ where: { companyId } })).toBe(4);
  });
  it('CA3: aprobación automática termina gracia; amountDue null', async () => {
    await sync();
    status = 'approved';
    await sync();
    await sync();
    expect((await read()).body).toMatchObject({
      status: 'active',
      amountDue: null,
      graceEndsAt: null,
    });
    expect(mailer.sendGraceReminder).toHaveBeenCalledTimes(1);
  });
  it('pago único por webhook, enlace reutilizado, duplicación y rechazo sin efecto', async () => {
    await sync();
    const first = await retry().expect(200);
    expect((await retry().expect(200)).body).toEqual(first.body);
    expect(mp.createPreference).toHaveBeenCalledTimes(1);
    await paymentWebhook('rejected');
    expect(accountStateResponseSchema.parse((await read()).body).status).toBe('grace');
    await paymentWebhook();
    await paymentWebhook();
    expect((await read()).body).toMatchObject({ status: 'active', amountDue: null });
    expect(
      (await db.subscriptionCharge.findFirstOrThrow({ where: { companyId } })).gracePaidPaymentId,
    ).toBe(`${companyId}-one-time`);
  });
  it('reintento simultáneo al automático: solo una activación y alerta del doble cobro', async () => {
    await sync();
    await retry().expect(200);
    status = 'approved';
    const log = jest.spyOn(Logger.prototype, 'error');
    try {
      await Promise.all([sync(), paymentWebhook()]);
      expect(accountStateResponseSchema.parse((await read()).body).status).toBe('active');
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'subscription.double_charge', companyId }),
      );
    } finally {
      log.mockRestore();
    }
  });
  it('409 usa el estado actual remoto y bloquea pagos únicos pendientes', async () => {
    await sync();
    status = 'pending';
    await retry().expect(409);
    expect(mp.createPreference).not.toHaveBeenCalled();
    status = 'rejected';
    mp.searchGracePayments.mockResolvedValueOnce([{ id: 'pending', status: 'pending' }]);
    await retry().expect(409);
  });
  it('CA5: 401 sin sesión, 403 para todos los roles ajenos; aislamiento de otra empresa', async () => {
    await sync();
    for (const [method, path] of [
      ['get', 'suscripcion/medio-de-pago'],
      ['post', 'suscripcion/reintentar-cobro'],
      ['get', 'cuenta/estado'],
    ] as const) {
      await request(app.getHttpServer())[method](`/api/v1/${path}`).expect(401);
      for (const role of ['supervisor', 'guard', 'client'])
        await request(app.getHttpServer())[method](`/api/v1/${path}`).set(auth(role)).expect(403);
    }
    await request(app.getHttpServer())
      .get('/api/v1/suscripcion/medio-de-pago')
      .set(auth('other-admin'))
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/suscripcion/reintentar-cobro')
      .set(auth('other-admin'))
      .send({ companyId })
      .expect(400);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/cuenta/estado?companyId=${companyId}`)
          .set(auth('other-admin'))
          .expect(200)
      ).body,
    ).toMatchObject({ status: 'active', amountDue: null });
    expect(await db.notice.count({ where: { companyId } })).toBe(0);
  });
});
