import { getQueueToken } from '@nestjs/bullmq';
import { Logger, type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import { subscriptionResponseSchema, guardSelectionRequiredSchema } from '@garita/shared';
import { setupApp } from '../src/setup-app';
import { AccountTrialProcessor } from '../src/modules/account/account-trial.processor';
import { CLOCK } from '../src/common/clock';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';
import {
  MercadoPagoWebhookService,
  MP_NOTIFICATIONS_QUEUE,
} from '../src/modules/subscriptions/mercadopago-webhook.service';
import { MercadoPagoNotificationsProcessor } from '../src/modules/subscriptions/mercadopago-notifications.processor';
import {
  MercadoPagoReconciliationProcessor,
  MP_RECONCILIATION_QUEUE,
} from '../src/modules/subscriptions/mercadopago-reconciliation.processor';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { GuardSelectionService } from '../src/modules/subscriptions/guard-selection';
import { SUBSCRIPTION_EFFECTS_PORT } from '../src/modules/subscriptions/subscription-effects.port';
import { FcmMessaging } from '../src/modules/notifications/fcm-messaging';

describe('HU-29 por HTTP (Mercado Pago simulado)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService['systemPrisma'];
  const prefix = `hu29-${randomUUID()}`;
  const companyId = prefix;
  const southId = `${prefix}-other`;
  const adminId = `${prefix}-admin`;
  const guards = Array.from({ length: 14 }, (_, i) => `${prefix}-guard-${i}`);
  const now = new Date('2030-01-01T12:00:00Z');
  const secret = 'hu29-test-secret';
  const queue = { add: jest.fn().mockResolvedValue({}), upsertJobScheduler: jest.fn() };
  const effects = {
    onChargeApproved: jest.fn(),
    onChargeRejected: jest.fn(),
    onOneTimePayment: jest.fn(),
  };
  const mp = {
    createPreapproval: jest.fn(),
    getPreapproval: jest.fn(),
    searchAuthorizedPayments: jest.fn(),
    getAuthorizedPayment: jest.fn(),
    getPayment: jest.fn(),
    cancelPreapproval: jest.fn(),
    setPreapprovalStatus: jest.fn(),
  };
  let previousSecret: string | undefined;
  let siteId: string;
  let planId: string;
  const notificationIds: string[] = [];

  beforeAll(async () => {
    previousSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    const appModulePath = '../src/app.module';
    const appModule: unknown = await import(appModulePath);
    const AppModule = (appModule as { AppModule: Type<unknown> }).AppModule;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoClient)
      .useValue(mp)
      .overrideProvider(MercadoPagoNotificationsProcessor)
      .useValue({})
      .overrideProvider(MercadoPagoReconciliationProcessor)
      .useValue({})
      .overrideProvider(AccountTrialProcessor)
      .useValue({})
      .overrideProvider(getQueueToken(MP_NOTIFICATIONS_QUEUE))
      .useValue(queue)
      .overrideProvider(getQueueToken(MP_RECONCILIATION_QUEUE))
      .useValue(queue)
      .overrideProvider(SUBSCRIPTION_EFFECTS_PORT)
      .useValue(effects)
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(FcmMessaging)
      .useValue({ sendEachForMulticast: jest.fn() })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
        setDisabled: jest.fn(),
        revokeRefreshTokens: jest.fn(),
      })
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService).systemPrisma;
    await prisma.company.createMany({
      data: [
        {
          id: companyId,
          name: 'HU29',
          accountStatus: 'trial',
          trialEndsAt: new Date('2030-01-15T23:59:00Z'),
          timezone: 'America/Argentina/Buenos_Aires',
        },
        { id: southId, name: 'Otra empresa HU29', accountStatus: 'trial' },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          companyId,
          firebaseUid: adminId,
          email: `${adminId}@example.invalid`,
          firstName: 'Admin',
          lastName: 'HU29',
          role: 'admin',
          status: 'active',
        },
        {
          id: `${prefix}-supervisor`,
          companyId,
          firebaseUid: `${prefix}-supervisor`,
          email: `${prefix}-supervisor@example.invalid`,
          firstName: 'Supervisor',
          lastName: 'HU29',
          role: 'supervisor',
          status: 'active',
        },
        {
          id: `${prefix}-south-admin`,
          companyId: southId,
          firebaseUid: `${prefix}-south-admin`,
          email: `${prefix}-south@example.invalid`,
          firstName: 'Otro',
          lastName: 'Admin',
          role: 'admin',
          status: 'active',
        },
        ...guards.map((id, i) => ({
          id,
          companyId,
          firebaseUid: id,
          email: `${id}@example.invalid`,
          firstName: `Vigilador ${i}`,
          lastName: 'HU29',
          role: 'guard' as const,
          status: i === 13 ? ('invitation_pending' as const) : ('active' as const),
        })),
      ],
    });
    const client = await prisma.client.create({
      data: {
        companyId,
        name: 'HU29',
        contactName: 'Contacto',
        phone: '+541112345678',
        email: `${prefix}@example.invalid`,
      },
    });
    siteId = (
      await prisma.site.create({
        data: {
          companyId,
          clientId: client.id,
          name: 'Predio HU29',
          address: 'Dirección',
          latitude: '-34.6',
          longitude: '-58.4',
        },
      })
    ).id;
    planId = (
      await prisma.plan.create({
        data: { code: prefix, name: 'HU29 hasta 10', monthlyPrice: '45000.00', maxGuards: 10 },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.mercadoPagoNotification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.subscriptionCharge.deleteMany({ where: { companyId } });
    await prisma.subscription.deleteMany({ where: { companyId } });
    await prisma.shift.deleteMany({ where: { companyId } });
    await prisma.site.deleteMany({ where: { companyId } });
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId: { in: [companyId, southId] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, southId] } } });
    await prisma.plan.deleteMany({ where: { code: prefix } });
    await app.close();
    if (previousSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previousSecret;
  });
  const auth = () => ({ Authorization: `Bearer ${adminId}` });
  async function notify(type: string, resourceId: string, id = randomUUID()) {
    notificationIds.push(id);
    const ts = '1704908010';
    const signedId = /^[a-z0-9]+$/i.test(resourceId) ? resourceId.toLowerCase() : resourceId;
    const signature = createHmac('sha256', secret)
      .update(`id:${signedId};request-id:hu29;ts:${ts};`)
      .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/mercadopago')
      .query({ 'data.id': resourceId })
      .set({ 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'hu29' })
      .send({ id, type, data: { id: resourceId } })
      .expect(200);
    await app.get(MercadoPagoWebhookService).process(id);
    return id;
  }
  function reconciliation() {
    return new MercadoPagoReconciliationProcessor(
      app.get(PrismaService),
      app.get(SubscriptionsService),
      app.get(GuardSelectionService),
      app.get(MercadoPagoWebhookService),
      queue as unknown as Queue,
    );
  }

  it('rechaza falta de sesión, supervisor y firma inválida, con log de error', async () => {
    const http = request(app.getHttpServer());
    for (const [method, path] of [
      ['get', '/suscripcion'],
      ['get', '/planes'],
      ['post', '/suscripcion'],
    ] as const) {
      await http[method](`/api/v1${path}`).expect(401);
      await http[method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${prefix}-supervisor`)
        .expect(403);
    }
    const log = jest.spyOn(Logger.prototype, 'error');
    await http
      .post('/api/v1/webhooks/mercadopago')
      .send({ id: 'invalid', type: 'subscription_preapproval', data: { id: 'mp' } })
      .expect(401);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ result: 'invalid_signature' }));
    log.mockRestore();
  });

  it('CA8: exige elegir 10 de 14, deriva/desasigna al confirmar y espera el cierre del turno', async () => {
    mp.createPreapproval.mockResolvedValue({
      id: prefix,
      status: 'pending',
      init_point: 'https://example.invalid/checkout',
    });
    mp.getPreapproval.mockResolvedValue({
      id: prefix,
      status: 'authorized',
      next_payment_date: '2030-02-01T12:00:00Z',
    });
    mp.searchAuthorizedPayments.mockResolvedValue([]);
    const http = request(app.getHttpServer());
    const body = { planId, payerEmail: 'buyer@example.invalid', keepTrial: false };
    const required = guardSelectionRequiredSchema.parse(
      (await http.post('/api/v1/suscripcion').set(auth()).send(body).expect(409)).body,
    );
    expect(required.guards).toHaveLength(14);
    const ongoing = await prisma.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-01-01T10:00:00Z'),
        endsAt: new Date('2030-01-01T18:00:00Z'),
        serviceDate: now,
        status: 'in_progress',
        assignments: {
          create: {
            guardId: guards[10],
            startsAt: new Date('2030-01-01T10:00:00Z'),
            endsAt: new Date('2030-01-01T18:00:00Z'),
            assignedById: adminId,
            result: 'started',
          },
        },
      },
    });
    const futures = [];
    for (const i of [11, 12])
      futures.push(
        await prisma.shift.create({
          data: {
            companyId,
            siteId,
            createdById: adminId,
            startsAt: new Date(`2030-01-${i}T10:00:00Z`),
            endsAt: new Date(`2030-01-${i}T18:00:00Z`),
            serviceDate: new Date(`2030-01-${i}`),
            assignments: {
              create: {
                guardId: guards[i],
                startsAt: new Date(`2030-01-${i}T10:00:00Z`),
                endsAt: new Date(`2030-01-${i}T18:00:00Z`),
                assignedById: adminId,
              },
            },
          },
        }),
      );
    const guardSelection = {
      guardsToKeep: guards.slice(0, 10),
      shiftDecisions: guards
        .slice(10)
        .map((guardId, index) =>
          index === 1
            ? { guardId, shiftAction: 'derive', deriveToUserId: guards[0] }
            : { guardId, shiftAction: 'unassign', confirmUnassignedCount: index === 2 ? 1 : 0 },
        ),
    };
    await http
      .post('/api/v1/suscripcion')
      .set(auth())
      .send({ ...body, guardSelection })
      .expect(201);
    expect(await prisma.user.count({ where: { companyId, status: 'deactivated' } })).toBe(0);
    const id = await notify('subscription_preapproval', prefix);
    await notify('subscription_preapproval', prefix, id);
    expect(await prisma.user.count({ where: { companyId, status: 'deactivated' } })).toBe(3);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guards[10] } })).status).toBe(
      'active',
    );
    expect(
      await prisma.shiftAssignment.findFirst({
        where: { shiftId: futures[0]?.id, isCurrent: true },
      }),
    ).toMatchObject({ guardId: guards[0] });
    expect(
      await prisma.shiftAssignment.findFirst({
        where: { shiftId: futures[1]?.id, isCurrent: true },
      }),
    ).toMatchObject({ guardId: null });
    await prisma.shift.update({
      where: { id: ongoing.id },
      data: { status: 'closed', closedAt: now },
    });
    await reconciliation().process({ id: 'pending', data: { kind: 'pending' } } as Job);
    await reconciliation().process({ id: 'pending', data: { kind: 'pending' } } as Job);
    expect(await prisma.user.count({ where: { companyId, status: 'deactivated' } })).toBe(4);
    await http.post('/api/v1/suscripcion').set(auth()).send(body).expect(409);
    await expect(
      prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { accountStatus: true },
      }),
    ).resolves.toEqual({ accountStatus: 'active' });
  });

  it('BDD3: un cobro perdido se recupera en la comparación diaria, se pagina y queda aislado por empresa', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({ where: { companyId } });
    const payment = {
      id: `${prefix}-charge`,
      preapproval_id: prefix,
      transaction_amount: '45000.00',
      date_created: now.toISOString(),
      retry_attempt: 1,
      payment: { id: 'p1', status: 'approved', status_detail: 'accredited' },
    };
    mp.searchAuthorizedPayments.mockResolvedValue([payment]);
    const log = jest.spyOn(Logger.prototype, 'error');
    await reconciliation().process({
      id: 'daily',
      data: { kind: 'subscription', id: sub.id },
    } as Job);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'subscription.reconciliation_diff', corrected: 'approved' }),
    );
    log.mockRestore();
    await reconciliation().process({
      id: 'daily',
      data: { kind: 'subscription', id: sub.id },
    } as Job);
    expect(await prisma.subscriptionCharge.count({ where: { subscriptionId: sub.id } })).toBe(1);
    expect(effects.onChargeApproved).toHaveBeenCalledTimes(1);
    await prisma.subscriptionCharge.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({
        companyId,
        subscriptionId: sub.id,
        mpAuthorizedPaymentId: `${prefix}-history-${i}`,
        amount: '45000.00',
        status: 'approved' as const,
      })),
    });
    const get = async (token: string, suffix = '') =>
      subscriptionResponseSchema.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/suscripcion${suffix}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        ).body,
      );
    const first = await get(adminId);
    expect(first.subscription).toMatchObject({ status: 'authorized', hasMoreCharges: true });
    expect(first.subscription?.charges).toHaveLength(24);
    expect((await get(adminId, '?chargePage=2')).subscription?.charges).toHaveLength(1);
    expect((await get(`${prefix}-south-admin`)).subscription).toBeNull();
  });

  it('refleja rechazo, reintento aprobado y aviso desordenado consultando el recurso actual', async () => {
    const payment = {
      id: `${prefix}-retry`,
      preapproval_id: prefix,
      transaction_amount: '45000.00',
      retry_attempt: 0,
      payment: { id: 'p2', status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' },
    };
    mp.getAuthorizedPayment.mockImplementation(() => Promise.resolve(payment));
    mp.searchAuthorizedPayments.mockImplementation(() => Promise.resolve([payment]));
    await notify('subscription_authorized_payment', 'retry');
    expect(effects.onChargeRejected).toHaveBeenCalledTimes(1);
    payment.payment.status = 'approved';
    payment.payment.status_detail = 'accredited';
    payment.retry_attempt = 1;
    await notify('subscription_authorized_payment', 'retry');
    await notify('subscription_authorized_payment', 'retry');
    expect(
      (
        await prisma.subscriptionCharge.findUniqueOrThrow({
          where: { mpAuthorizedPaymentId: payment.id },
        })
      ).status,
    ).toBe('approved');
    expect(effects.onChargeApproved).toHaveBeenCalledTimes(2);
  });
});
