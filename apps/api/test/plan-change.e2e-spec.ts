import { getQueueToken } from '@nestjs/bullmq';
import { Logger, type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import { planChangeHistorySchema, planChangeSimulationSchema } from '@garita/shared';
import { setupApp } from '../src/setup-app';
import { CLOCK } from '../src/common/clock';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { AccountTrialProcessor } from '../src/modules/account/account-trial.processor';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';
import {
  MercadoPagoWebhookService,
  MP_NOTIFICATIONS_QUEUE,
} from '../src/modules/subscriptions/mercadopago-webhook.service';
import { MercadoPagoNotificationsProcessor } from '../src/modules/subscriptions/mercadopago-notifications.processor';
import { MercadoPagoReconciliationProcessor } from '../src/modules/subscriptions/mercadopago-reconciliation.processor';
import {
  PlanChangeProcessor,
  PLAN_CHANGE_QUEUE,
} from '../src/modules/subscriptions/plan-change.processor';
import { PlanChangeService } from '../src/modules/subscriptions/plan-change.service';
import { ResendInvitationMailer } from '../src/modules/users/email.service';
import { FcmMessaging } from '../src/modules/notifications/fcm-messaging';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';

describe('HU-42 por HTTP, sin servicios externos', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const prefix = `hu42-${randomUUID()}`;
  const companyId = prefix;
  const otherId = `${prefix}-other`;
  const adminId = `${prefix}-admin`;
  const guards = Array.from({ length: 14 }, (_, i) => `${prefix}-guard-${i}`);
  let now = new Date('2030-11-11T12:00:00Z');
  const end = new Date('2030-12-01T12:00:00Z');
  let subId: string;
  let basic: string;
  let premium: string;
  let middle: string;
  const secret = 'hu42-test-secret';
  let previousSecret: string | undefined;
  const notices: string[] = [];
  const queue = { add: jest.fn().mockResolvedValue({}), upsertJobScheduler: jest.fn() };
  const mp = {
    createPreference: jest.fn(),
    setPreferenceExpiration: jest.fn(),
    updatePreapprovalAmount: jest.fn(),
    getPreapproval: jest.fn(),
    searchAuthorizedPayments: jest.fn(),
    getPayment: jest.fn(),
    setPreapprovalStatus: jest.fn(),
    cancelPreapproval: jest.fn(),
  };
  const auth = (id = adminId) => ({ Authorization: `Bearer ${id}` });
  const url = '/api/v1/suscripcion';

  beforeAll(async () => {
    previousSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    // Loaded after the secret is set: the config is read when the module is imported.
    const appModulePath = '../src/app.module';
    const appModule: unknown = await import(appModulePath);
    const AppModule = (appModule as { AppModule: Type<unknown> }).AppModule;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoClient)
      .useValue(mp)
      .overrideProvider(PlanChangeProcessor)
      .useValue({})
      .overrideProvider(MercadoPagoNotificationsProcessor)
      .useValue({})
      .overrideProvider(MercadoPagoReconciliationProcessor)
      .useValue({})
      .overrideProvider(AccountTrialProcessor)
      .useValue({})
      .overrideProvider(getQueueToken(MP_NOTIFICATIONS_QUEUE))
      .useValue(queue)
      .overrideProvider(getQueueToken(PLAN_CHANGE_QUEUE))
      .useValue(queue)
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(FcmMessaging)
      .useValue({ sendEachForMulticast: jest.fn() })
      .overrideProvider(ResendInvitationMailer)
      .useValue({ sendInvitation: jest.fn() })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (uid: string) => Promise.resolve({ uid }),
        createDisabledUser: (email: string) => Promise.resolve({ uid: email }),
        deleteUser: jest.fn().mockResolvedValue(undefined),
        setDisabled: jest.fn().mockResolvedValue(undefined),
        revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.createMany({
      data: [
        {
          id: companyId,
          name: 'HU42',
          accountStatus: 'active',
          timezone: 'America/Argentina/Buenos_Aires',
        },
        { id: otherId, name: 'Otra HU42', accountStatus: 'active' },
      ],
    });
    for (const [id, role, company] of [
      [adminId, 'admin', companyId],
      [`${prefix}-supervisor`, 'supervisor', companyId],
      [`${prefix}-client`, 'client', companyId],
      [`${prefix}-other-admin`, 'admin', otherId],
      ...guards.map((id) => [id, 'guard', companyId]),
    ] as [string, 'admin' | 'supervisor' | 'client' | 'guard', string][])
      await db.user.create({
        data: {
          id,
          companyId: company,
          firebaseUid: id,
          email: `${id}@example.invalid`,
          firstName: 'Ana',
          lastName: role,
          role,
          status: 'active',
        },
      });
    basic = (
      await db.plan.create({
        data: { code: `${prefix}-basic`, name: 'HU42 10', monthlyPrice: '50000', maxGuards: 10 },
      })
    ).id;
    premium = (
      await db.plan.create({
        data: { code: `${prefix}-premium`, name: 'HU42 25', monthlyPrice: '90000', maxGuards: 25 },
      })
    ).id;
    middle = (
      await db.plan.create({
        data: { code: `${prefix}-middle`, name: 'HU42 12', monthlyPrice: '70000', maxGuards: 12 },
      })
    ).id;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    now = new Date('2030-11-11T12:00:00Z');
    await db.subscriptionChange.deleteMany({ where: { companyId } });
    await db.planChangePayment.deleteMany({ where: { companyId } });
    await db.subscriptionCharge.deleteMany({ where: { companyId } });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.company.update({
      where: { id: companyId },
      data: { accountStatus: 'active', suspensionReason: null },
    });
    await db.user.updateMany({ where: { id: { in: guards } }, data: { status: 'active' } });
    subId = (
      await db.subscription.create({
        data: {
          companyId,
          planId: basic,
          status: 'authorized',
          startsAt: new Date('2030-11-01T12:00:00Z'),
          nextChargeAt: end,
          mpPreapprovalId: prefix,
          payerEmail: 'test@example.invalid',
        },
      })
    ).id;
    await db.subscriptionCharge.create({
      data: {
        companyId,
        subscriptionId: subId,
        mpAuthorizedPaymentId: randomUUID(),
        amount: '50000',
        status: 'approved',
        chargedAt: new Date('2030-11-01T12:00:00Z'),
      },
    });
    mp.createPreference.mockImplementation(() =>
      Promise.resolve({ id: randomUUID(), initPoint: 'https://mp.example.invalid/pay' }),
    );
    mp.setPreferenceExpiration.mockResolvedValue(undefined);
    mp.updatePreapprovalAmount.mockResolvedValue({ id: prefix, status: 'authorized' });
    mp.getPreapproval.mockResolvedValue({
      id: prefix,
      status: 'authorized',
      next_payment_date: end.toISOString(),
      auto_recurring: { transaction_amount: '50000.00' },
    });
    mp.searchAuthorizedPayments.mockResolvedValue([]);
    mp.setPreapprovalStatus.mockResolvedValue({ id: prefix, status: 'paused' });
    mp.cancelPreapproval.mockResolvedValue({ id: prefix, status: 'cancelled' });
  });
  afterAll(async () => {
    await db.mercadoPagoNotification.deleteMany({ where: { id: { in: notices } } });
    await db.subscriptionChange.deleteMany({ where: { companyId } });
    await db.planChangePayment.deleteMany({ where: { companyId } });
    await db.subscriptionCharge.deleteMany({ where: { companyId } });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
    await db.company.deleteMany({ where: { id: { in: [companyId, otherId] } } });
    await db.plan.deleteMany({ where: { code: { startsWith: prefix } } });
    await app.close();
    if (previousSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previousSecret;
  });
  const current = () => db.subscription.findUniqueOrThrow({ where: { id: subId } });
  const change = (planId: string, guardSelection?: object) =>
    request(app.getHttpServer())
      .post(`${url}/cambio-plan`)
      .set(auth())
      .send({ planId, ...(guardSelection ? { guardSelection } : {}) });
  async function history() {
    return planChangeHistorySchema.parse(
      (await request(app.getHttpServer()).get(`${url}/historial`).set(auth()).expect(200)).body,
    );
  }
  async function notify(status: string, amount = '26666.67', paymentId = randomUUID()) {
    const row = await db.planChangePayment.findFirstOrThrow({
      where: { subscriptionId: subId },
      orderBy: { createdAt: 'desc' },
    });
    mp.getPayment.mockResolvedValue({
      id: paymentId,
      status,
      transaction_amount: amount,
      external_reference: `plan-change:${row.id}`,
      status_detail: 'cc_rejected_insufficient_amount',
    });
    const id = randomUUID();
    notices.push(id);
    const signature = createHmac('sha256', secret)
      .update(`id:${paymentId};request-id:hu42;ts:1704908010;`)
      .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/mercadopago')
      .query({ 'data.id': paymentId })
      .set({ 'x-signature': `ts=1704908010,v1=${signature}`, 'x-request-id': 'hu42' })
      .send({ id, type: 'payment', data: { id: paymentId } })
      .expect(200);
    await app.get(MercadoPagoWebhookService).process(id);
    return paymentId;
  }
  const selection = (keep = 10) => ({
    guardsToKeep: guards.slice(0, keep),
    shiftDecisions: guards
      .slice(keep)
      .map((guardId) => ({ guardId, shiftAction: 'unassign', confirmUnassignedCount: 0 })),
  });
  function processor() {
    return new PlanChangeProcessor(
      app.get(PrismaService),
      app.get(PlanChangeService),
      { now: () => now },
      queue as never,
    );
  }

  it('aislamiento: otra empresa no ve cambios ni puede seleccionar vigiladores ajenos', async () => {
    await change(premium).expect(200);
    const other = await request(app.getHttpServer())
      .get(`${url}/historial`)
      .set(auth(`${prefix}-other-admin`))
      .expect(200);
    expect(planChangeHistorySchema.parse(other.body)).toMatchObject({ payments: [], changes: [] });
    await db.planChangePayment.deleteMany({ where: { companyId } });
    await db.subscription.update({ where: { id: subId }, data: { planId: premium } });
    await change(basic, { guardsToKeep: [`${prefix}-other-admin`], shiftDecisions: [] }).expect(
      409,
    );
  });
  it('CA1: simula 26666.67 con 20/30 días, sin Mercado Pago; mismo plan 400', async () => {
    const response = await request(app.getHttpServer())
      .get(`${url}/cambio-plan/simular`)
      .query({ plan: premium })
      .set(auth())
      .expect(200);
    expect(planChangeSimulationSchema.parse(response.body)).toMatchObject({
      amount: '26666.67',
      remainingDays: 20,
      cycleDays: 30,
      type: 'upgrade',
    });
    expect(mp.getPreapproval).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get(`${url}/cambio-plan/simular`)
      .query({ plan: basic })
      .set(auth())
      .expect(400);
  });
  it('CA2: aprobado cambia cupo antes del PUT, historial con actor y aviso repetido idempotente', async () => {
    await change(premium).expect(200);
    expect((await current()).planId).toBe(basic);
    mp.updatePreapprovalAmount.mockImplementation(async () => {
      expect((await current()).planId).toBe(premium);
      expect(
        await db.planChangePayment.count({ where: { subscriptionId: subId, status: 'approved' } }),
      ).toBe(1);
      return { id: prefix, status: 'authorized' };
    });
    const paymentId = await notify('approved');
    await notify('approved', '26666.67', paymentId);
    expect(mp.updatePreapprovalAmount).toHaveBeenCalledTimes(1);
    expect((await history()).changes).toEqual([
      expect.objectContaining({ type: 'upgrade', adminName: 'Ana admin' }),
    ]);
    const account = await request(app.getHttpServer())
      .get('/api/v1/cuenta/estado')
      .set(auth())
      .expect(200);
    expect(account.body).toMatchObject({ guardLimit: 25 });
  });
  it('CA3: rechazado conserva plan/cupo y muestra motivo; pendiente bloquea y es único', async () => {
    await change(premium).expect(200);
    await change(middle).expect(409);
    await expect(
      db.planChangePayment.create({
        data: {
          companyId,
          subscriptionId: subId,
          previousPlanId: basic,
          newPlanId: middle,
          adminId,
          amount: '1',
          remainingDays: 1,
          cycleDays: 30,
          expiresAt: end,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await notify('rejected');
    expect((await current()).planId).toBe(basic);
    expect((await history()).payments[0]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'cc_rejected_insufficient_amount',
    });
    expect(mp.updatePreapprovalAmount).not.toHaveBeenCalled();
  });
  it('recupera un PUT fallido después de aprobar, y la pasada diaria corrige diferencias', async () => {
    await change(premium).expect(200);
    mp.updatePreapprovalAmount.mockRejectedValueOnce(new Error('sin red'));
    await notify('approved');
    expect((await history()).payments[0]?.amountUpdatePending).toBe(true);
    await app.get(PlanChangeService).repairAmount(subId, false);
    expect((await history()).payments[0]?.amountUpdatePending).toBe(false);
    const log = jest.spyOn(Logger.prototype, 'error');
    await app.get(PlanChangeService).repairAmount(subId, true);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'subscription.amount_diff',
        before: '50000.00',
        corrected: '90000.00',
      }),
    );
    log.mockRestore();
  });
  it('no corrige monto durante pending; vence el enlace y permite otro cambio', async () => {
    await change(premium).expect(200);
    await app.get(PlanChangeService).repairAmount(subId, true);
    expect(mp.getPreapproval).not.toHaveBeenCalled();
    now = new Date('2030-11-13T12:00:00Z');
    await processor().process({ data: { kind: 'sweep' } } as Job);
    expect((await history()).payments[0]?.rejectionReason).toContain('venció');
    await change(premium).expect(200);
  });
  it('CA4/CA7: 14 vigiladores exigen elegir 10, cupo menor al pedir y bajas al próximo ciclo', async () => {
    await db.subscription.update({ where: { id: subId }, data: { planId: premium } });
    const response = await change(basic).expect(409);
    expect(response.body).toMatchObject({ code: 'guard_selection_required', maxGuards: 10 });
    expect((response.body as { guards: unknown[] }).guards).toHaveLength(14);
    await change(basic, selection()).expect(200);
    expect(mp.updatePreapprovalAmount).toHaveBeenCalledWith(prefix, '50000.00');
    expect((await current()).planId).toBe(premium);
    const create = await request(app.getHttpServer())
      .post('/api/v1/usuarios')
      .set(auth())
      .send({
        role: 'guard',
        firstName: 'Nuevo',
        lastName: 'Guardia',
        email: `${randomUUID()}@example.invalid`,
        phone: '+5491123456789',
      });
    expect(create.status).toBe(409);
    expect(create.body).toMatchObject({ code: 'guard_limit_reached' });
    now = end;
    await app.get(PlanChangeService).applyDowngrade(subId);
    await app.get(PlanChangeService).applyDowngrade(subId);
    expect((await current()).planId).toBe(basic);
    expect(await db.user.count({ where: { companyId, status: 'deactivated' } })).toBe(4);
    expect((await history()).changes.filter((c) => c.type === 'downgrade_applied')).toHaveLength(1);
  });
  it('reemplazar/anular baja ajusta/restaura monto y PUT fallido no programa nada', async () => {
    await db.subscription.update({ where: { id: subId }, data: { planId: premium } });
    mp.updatePreapprovalAmount.mockRejectedValueOnce(new Error('fallo PUT'));
    await change(basic, selection()).expect(500);
    expect((await current()).pendingPlanId).toBeNull();
    await change(basic, selection()).expect(200);
    await change(middle, selection(12)).expect(200);
    expect(mp.updatePreapprovalAmount).toHaveBeenLastCalledWith(prefix, '70000.00');
    await change(premium).expect(200);
    expect((await current()).pendingPlanId).toBeNull();
    expect(mp.updatePreapprovalAmount).toHaveBeenLastCalledWith(prefix, '90000.00');
  });
  it('prueba con suscripción diferida cambia plan sin crear preferencia', async () => {
    await db.company.update({ where: { id: companyId }, data: { accountStatus: 'trial' } });
    await db.subscription.update({ where: { id: subId }, data: { startsAt: end } });
    await change(premium).expect(200);
    expect((await current()).planId).toBe(premium);
    expect(mp.createPreference).not.toHaveBeenCalled();
    expect(mp.updatePreapprovalAmount).toHaveBeenCalledWith(prefix, '90000.00');
    await db.subscriptionChange.deleteMany({ where: { companyId } });
    await db.subscriptionCharge.deleteMany({ where: { companyId } });
    await db.subscription.deleteMany({ where: { companyId } });
    const missing = await change(basic).expect(409);
    expect(JSON.stringify(missing.body)).toContain('elegí el plan al suscribirte');
  });
  it('CA5: cancelar anula baja, restaura monto, conserva servicio; revertir e historial con actor', async () => {
    await db.subscription.update({ where: { id: subId }, data: { planId: premium } });
    await change(basic, selection()).expect(200);
    // Read sync sees the pause that was sent to Mercado Pago.
    mp.getPreapproval
      .mockResolvedValueOnce({
        id: prefix,
        status: 'authorized',
        next_payment_date: end.toISOString(),
      })
      .mockResolvedValue({ id: prefix, status: 'paused', next_payment_date: end.toISOString() });
    await request(app.getHttpServer())
      .post(`${url}/cancelar`)
      .set(auth())
      .send({ reason: 'Cierre' })
      .expect(200);
    expect(mp.updatePreapprovalAmount).toHaveBeenLastCalledWith(prefix, '90000.00');
    expect((await current()).pendingPlanId).toBeNull();
    expect((await db.company.findUniqueOrThrow({ where: { id: companyId } })).accountStatus).toBe(
      'active',
    );
    mp.getPreapproval.mockResolvedValue({
      id: prefix,
      status: 'authorized',
      next_payment_date: end.toISOString(),
    });
    await request(app.getHttpServer()).post(`${url}/revertir-cancelacion`).set(auth()).expect(200);
    expect((await history()).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cancellation', adminName: 'Ana admin', reason: 'Cierre' }),
        expect.objectContaining({ type: 'cancellation_reverted', adminName: 'Ana admin' }),
      ]),
    );
    now = end;
    await app.get(SubscriptionsService).finishDueCancellation(await current());
    expect((await db.company.findUniqueOrThrow({ where: { id: companyId } })).accountStatus).toBe(
      'active',
    );
  });
  it('CA5: terminado el ciclo cancelado, queda suspended/cancelled', async () => {
    await db.subscription.update({
      where: { id: subId },
      data: { status: 'paused', cancelAt: end },
    });
    now = new Date('2030-12-01T11:59:00Z');
    await app.get(SubscriptionsService).finishDueCancellation(await current());
    expect((await current()).status).toBe('paused');
    now = end;
    await app.get(SubscriptionsService).finishDueCancellation(await current());
    expect(await db.company.findUniqueOrThrow({ where: { id: companyId } })).toMatchObject({
      accountStatus: 'suspended',
      suspensionReason: 'cancelled',
    });
    expect((await current()).status).toBe('cancelled');
  });
  it('cancelación vencida durante la prueba: cancela la suscripción sin suspender la cuenta', async () => {
    await db.company.update({ where: { id: companyId }, data: { accountStatus: 'trial' } });
    await db.subscription.update({
      where: { id: subId },
      data: { status: 'paused', cancelAt: end },
    });
    now = end;
    await app.get(SubscriptionsService).finishDueCancellation(await current());
    expect((await current()).status).toBe('cancelled');
    expect((await db.company.findUniqueOrThrow({ where: { id: companyId } })).accountStatus).toBe(
      'trial',
    );
  });
  it('una suscripción todavía sin autorizar no puede simular ni cambiar de plan', async () => {
    await db.subscription.update({ where: { id: subId }, data: { status: 'pending' } });
    await request(app.getHttpServer())
      .get(`${url}/cambio-plan/simular`)
      .query({ plan: premium })
      .set(auth())
      .expect(409);
    await change(premium).expect(409);
  });
});
