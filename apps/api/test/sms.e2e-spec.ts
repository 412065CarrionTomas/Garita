import { SuspensionProcessor } from '../src/modules/subscriptions/suspension.processor';
import { Test } from '@nestjs/testing';
import { type INestApplication, type Type } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  buildPanicSms,
  panicAlertDetailSchema,
  panicShortId,
  smsInboundListSchema,
} from '@garita/shared';
import { setupApp } from '../src/setup-app';
import { CLOCK } from '../src/common/clock';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { SMS_PORT } from '../src/common/ports/sms.port';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import {
  PanicJobsService,
  PANIC_SMS_QUEUE,
  PANIC_ESCALATION_QUEUE,
} from '../src/modules/panic/panic-jobs.service';
import { PanicSmsProcessor, PanicEscalationProcessor } from '../src/modules/panic/panic.processors';
import { ShiftCredentialService } from '../src/modules/sync/shift-credential.service';
import { AccountTrialProcessor } from '../src/modules/account/account-trial.processor';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';
import { MercadoPagoNotificationsProcessor } from '../src/modules/subscriptions/mercadopago-notifications.processor';
import { MercadoPagoReconciliationProcessor } from '../src/modules/subscriptions/mercadopago-reconciliation.processor';
import { FcmMessaging } from '../src/modules/notifications/fcm-messaging';

describe('HU-37 SMS por HTTP con proveedor simulado', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const prefix = `sms-${randomUUID()}`;
  const companyId = prefix;
  const otherCompany = `${prefix}-other`;
  const now = new Date('2035-01-01T12:00:00Z');
  const secret = 's'.repeat(32);
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const notifications = { notifySiteStaff: jest.fn().mockResolvedValue(undefined) };
  const sms = {
    sendPanicAlert: jest.fn().mockResolvedValue({ sent: true }),
    sendShiftClosed: jest.fn(),
  };
  let siteId: string;
  let shiftId: string;
  let assignmentId: string;
  let shiftToken: string;
  let priorSecret: string | undefined;
  let ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
  const ids: string[] = [];
  const body = (text: string, from = '+543511234567', id = randomUUID()) => ({
    id,
    from,
    text,
    receivedAt: now.toISOString(),
  });
  const text = (id: string) =>
    buildPanicSms({
      alertId: id,
      shiftCode: '123456',
      time: '08:58',
      latitude: -31.4,
      longitude: -64.2,
    });
  function send(
    input: ReturnType<typeof body>,
    signature?: string,
    timestamp = String(now.getTime() / 1000),
  ) {
    ids.push(input.id);
    const raw = JSON.stringify(input);
    return request(app.getHttpServer())
      .post('/api/v1/webhooks/sms')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip)
      .set('x-sms-timestamp', timestamp)
      .set(
        'x-sms-signature',
        signature ??
          `sha256=${createHmac('sha256', secret)
            .update(timestamp + '.' + raw)
            .digest('hex')}`,
      )
      .send(raw);
  }
  function internet(id: string) {
    return request(app.getHttpServer())
      .post('/api/v1/alertas-panico')
      .set('Authorization', `Bearer ${shiftToken}`)
      .send({
        alertId: id,
        shiftId,
        occurredAtDevice: '2035-01-01T11:58:15Z',
        location: {
          status: 'ok',
          latitude: -31.4,
          longitude: -64.2,
          accuracyMeters: 10,
          simulation: 'unavailable',
          takenAt: now.toISOString(),
        },
      });
  }
  beforeAll(async () => {
    priorSecret = process.env.SMS_WEBHOOK_SECRET;
    process.env.SMS_WEBHOOK_SECRET = secret;
    const modulePath = '../src/app.module';
    const imported: unknown = await import(modulePath);
    let builder = Test.createTestingModule({
      imports: [(imported as { AppModule: Type<unknown> }).AppModule],
    });
    for (const provider of [
      PanicSmsProcessor,
      PanicEscalationProcessor,
      AccountTrialProcessor,
      MercadoPagoClient,
      MercadoPagoNotificationsProcessor,
      MercadoPagoReconciliationProcessor,
    ])
      builder = builder.overrideProvider(provider).useValue({});
    const module = await builder
      .overrideProvider(getQueueToken(PANIC_SMS_QUEUE))
      .useValue(queue)
      .overrideProvider(getQueueToken(PANIC_ESCALATION_QUEUE))
      .useValue(queue)
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(SMS_PORT)
      .useValue(sms)
      .overrideProvider(NOTIFICATIONS_PORT)
      .useValue(notifications)
      .overrideProvider(FcmMessaging)
      .useValue({ sendEachForMulticast: jest.fn() })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (token: string) => Promise.resolve({ uid: token }) })
      .overrideProvider(SuspensionProcessor)
      .useValue({})
      .compile();
    app = module.createNestApplication({ rawBody: true });
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.createMany({
      data: [
        { id: companyId, name: 'HU37' },
        { id: otherCompany, name: 'Otra HU37' },
      ],
    });
    await db.user.createMany({
      data: (['admin', 'supervisor', 'guard', 'client'] as const).map((role) => ({
        id: `${prefix}-${role}`,
        firebaseUid: `${prefix}-${role}`,
        companyId,
        role,
        status: 'active',
        firstName: role,
        lastName: 'HU37',
        email: `${prefix}-${role}@example.invalid`,
        phone: role === 'guard' ? '+5493511234567' : '+5491112345678',
      })),
    });
    await db.user.create({
      data: {
        id: `${prefix}-other`,
        firebaseUid: `${prefix}-other`,
        companyId: otherCompany,
        role: 'admin',
        status: 'active',
        firstName: 'Otro',
        lastName: 'HU37',
        email: `${prefix}-other@example.invalid`,
      },
    });
    const client = await db.client.create({
      data: {
        companyId,
        name: 'HU37',
        contactName: 'Contacto',
        phone: '+5491112345678',
        email: `${prefix}@example.invalid`,
      },
    });
    const site = await db.site.create({
      data: {
        companyId,
        clientId: client.id,
        name: 'Predio HU37',
        address: 'Dirección',
        latitude: '-31.4',
        longitude: '-64.2',
      },
    });
    siteId = site.id;
    await db.siteSupervisor.create({ data: { companyId, siteId, userId: `${prefix}-supervisor` } });
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await db.shift.updateMany({ where: { companyId }, data: { status: 'closed' } });
    // The guard overlap constraint only ignores inactive assignments.
    await db.shiftAssignment.updateMany({
      where: { shift: { companyId } },
      data: { active: false },
    });
    const shift = await db.shift.create({
      data: {
        companyId,
        siteId,
        status: 'in_progress',
        panicSmsCode: '123456',
        startsAt: new Date('2035-01-01T11:00:00Z'),
        endsAt: new Date('2035-01-01T19:00:00Z'),
        serviceDate: now,
        createdById: `${prefix}-admin`,
        assignments: {
          create: {
            guardId: `${prefix}-guard`,
            assignedById: `${prefix}-admin`,
            startsAt: new Date('2035-01-01T11:00:00Z'),
            endsAt: new Date('2035-01-01T19:00:00Z'),
          },
        },
      },
      include: { assignments: true },
    });
    shiftId = shift.id;
    const assignment = shift.assignments[0];
    if (!assignment) throw new Error('Falta asignación de prueba');
    assignmentId = assignment.id;
    const credential = await app.get(ShiftCredentialService).issueCredential({
      companyId,
      shiftId,
      assignmentId,
      userId: `${prefix}-guard`,
      scheduledEnd: shift.endsAt,
    });
    shiftToken = credential.token;
    ip = `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  });
  afterAll(async () => {
    {
      await db.smsInbound.deleteMany({
        where: { OR: [{ companyId }, { messageId: { in: ids } }] },
      });
      await db.shift.deleteMany({ where: { companyId } });
      await db.siteSupervisor.deleteMany({ where: { companyId } });
      await db.site.deleteMany({ where: { companyId } });
      await db.client.deleteMany({ where: { companyId } });
      await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompany] } } });
      await db.company.deleteMany({ where: { id: { in: [companyId, otherCompany] } } });
    }
    await app.close();
    if (priorSecret === undefined) delete process.env.SMS_WEBHOOK_SECRET;
    else process.env.SMS_WEBHOOK_SECRET = priorSecret;
  });
  it('CA1/CA7: SMS válido registra una alerta y encola notificación, SMS y escalamiento', async () => {
    const started = performance.now();
    await send(body(text(randomUUID()))).expect(200);
    const alert = await db.panicAlert.findFirstOrThrow({ where: { shiftId } });
    expect(alert).toMatchObject({
      channel: 'sms',
      unverified: false,
      phoneMismatch: false,
      receivedAt: now,
      triggeredAt: new Date('2035-01-01T11:58:00Z'),
    });
    expect(notifications.notifySiteStaff).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, siteId, kind: 'panic' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'escalate',
      expect.objectContaining({ alertId: alert.id }),
      expect.objectContaining({ delay: 120000 }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ alertId: alert.id, reason: 'initial' }),
      expect.anything(),
    );
    expect(performance.now() - started).toBeLessThan(30000);
    await app.get(PanicJobsService).sendSms({ companyId, alertId: alert.id, reason: 'initial' });
    expect(sms.sendPanicAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+5491112345678',
        message: expect.not.stringMatching(/guard|31\.4|64\.2/) as unknown,
      }),
    );
  });
  it('CA2: texto manual queda no verificado y se notifica', async () => {
    await send(body('Ayuda portón')).expect(200);
    const alert = await db.panicAlert.findFirstOrThrow({ where: { shiftId } });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/alertas-panico/${alert.id}`)
      .set('Authorization', `Bearer ${prefix}-admin`)
      .expect(200);
    expect(panicAlertDetailSchema.parse(response.body).authenticated).toBe(false);
    expect(notifications.notifySiteStaff).toHaveBeenCalledTimes(1);
  });
  it('CA3: desconocido se registra sin alerta y sin exponerlo a administradores', async () => {
    const input = body('Ayuda', '+5492219998888');
    await send(input).expect(200);
    expect(await db.panicAlert.count({ where: { shiftId } })).toBe(0);
    expect(
      await db.smsInbound.findUnique({
        where: { provider_messageId: { provider: 'http', messageId: input.id } },
      }),
    ).toMatchObject({ result: 'unknown', companyId: null });
    for (const admin of [`${prefix}-admin`, `${prefix}-other`]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/sms-recibidos?estado=unknown')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(
        smsInboundListSchema.parse(response.body).items.some((row) => row.messageId === input.id),
      ).toBe(false);
    }
  });
  it('CA4: rechaza firma ausente, inválida, vieja y cuerpo modificado', async () => {
    await request(app.getHttpServer()).post('/api/v1/webhooks/sms').send(body('Ayuda')).expect(401);
    await send(body('Ayuda'), 'sha256=invalid').expect(401);
    await send(body('Ayuda'), undefined, String(now.getTime() / 1000 - 301)).expect(401);
    const input = body('Ayuda');
    const signature = `sha256=${createHmac('sha256', secret)
      .update(String(now.getTime() / 1000) + '.' + JSON.stringify(input))
      .digest('hex')}`;
    await send({ ...input, text: 'Modificado' }, signature).expect(401);
  });
  it('sin secreto el webhook responde 401 aunque el cuerpo esté firmado', async () => {
    const config = app.get(ConfigService);
    const get = (key: string): unknown => config.get<unknown>(key);
    const spy = jest
      .spyOn(config, 'get')
      .mockImplementation((key: string) => (key === 'SMS_WEBHOOK_SECRET' ? undefined : get(key)));
    try {
      await send(body('Ayuda')).expect(401);
    } finally {
      spy.mockRestore();
    }
  });
  it('CA5/ID-280: SMS y luego internet conserva canal y recepción y completa UUID', async () => {
    const id = randomUUID();
    await send(body(text(id))).expect(200);
    await internet(id).expect(200);
    expect(await db.panicAlert.findMany({ where: { shiftId } })).toEqual([
      expect.objectContaining({
        id,
        channel: 'sms',
        receivedAt: now,
        accuracyMeters: expect.anything() as unknown,
      }),
    ]);
    expect(await db.smsInbound.findFirst({ where: { shiftId } })).toMatchObject({ alertId: id });
  });
  it('ID-280: internet y luego SMS queda una sola alerta', async () => {
    const id = randomUUID();
    await internet(id).expect(200);
    await send(body(text(id))).expect(200);
    expect(await db.panicAlert.count({ where: { shiftId } })).toBe(1);
    expect(await db.smsInbound.findFirst({ where: { shiftId } })).toMatchObject({ alertId: id });
  });
  it('ID-280: llegadas simultáneas y mensajes repetidos quedan una sola vez', async () => {
    const id = randomUUID();
    const input = body(text(id));
    await Promise.all([send(input).expect(200), internet(id).expect(200), send(input).expect(200)]);
    expect(await db.panicAlert.count({ where: { shiftId } })).toBe(1);
    expect(await db.smsInbound.count({ where: { provider: 'http', messageId: input.id } })).toBe(1);
    await send(body(text(id))).expect(200);
    expect(await db.panicAlert.count({ where: { shiftId } })).toBe(1);
  });
  it('CA6: código válido desde otro número conserva marca visible en listado y detalle', async () => {
    await send(body(text(randomUUID()), '+5492219998888')).expect(200);
    const alert = await db.panicAlert.findFirstOrThrow({ where: { shiftId } });
    expect(alert.phoneMismatch).toBe(true);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/alertas-panico/${alert.id}`)
      .set('Authorization', `Bearer ${prefix}-admin`)
      .expect(200);
    expect(panicAlertDetailSchema.parse(response.body)).toMatchObject({
      authenticated: true,
      phoneMismatch: true,
    });
  });
  it('texto manual y luego SMS con el código del turno: la misma alerta queda verificada', async () => {
    const id = randomUUID();
    await send(body('Ayuda portón')).expect(200);
    await send(body(text(id))).expect(200);
    const alerts = await db.panicAlert.findMany({ where: { shiftId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ unverified: false, shortId: panicShortId(id) });
    expect(notifications.notifySiteStaff).toHaveBeenCalledTimes(1);
  });
  it('completar la gemela de una alerta ya confirmada no vuelve a avisar al personal', async () => {
    const id = randomUUID();
    await send(body(text(id))).expect(200);
    await db.panicAlert.updateMany({ where: { shiftId }, data: { status: 'confirmed' } });
    await internet(id).expect(200);
    expect(await db.panicAlert.findMany({ where: { shiftId } })).toEqual([
      expect.objectContaining({ id, status: 'confirmed' }),
    ]);
    expect(notifications.notifySiteStaff).toHaveBeenCalledTimes(1);
  });
  it('consulta paginada exige administrador y nunca mezcla empresas', async () => {
    await send(body('Ayuda portón')).expect(200);
    await request(app.getHttpServer()).get('/api/v1/sms-recibidos').expect(401);
    for (const role of ['supervisor', 'guard', 'client'])
      await request(app.getHttpServer())
        .get('/api/v1/sms-recibidos')
        .set('Authorization', `Bearer ${prefix}-${role}`)
        .expect(403);
    const own = await request(app.getHttpServer())
      .get('/api/v1/sms-recibidos?estado=unverified')
      .set('Authorization', `Bearer ${prefix}-admin`)
      .expect(200);
    expect(smsInboundListSchema.parse(own.body).items.some((row) => row.shiftId === shiftId)).toBe(
      true,
    );
    const other = await request(app.getHttpServer())
      .get('/api/v1/sms-recibidos')
      .set('Authorization', `Bearer ${prefix}-other`)
      .expect(200);
    expect(smsInboundListSchema.parse(other.body).total).toBe(0);
  });
  it('limita la ruta a 60 pedidos por IP y minuto en Redis', async () => {
    for (let n = 0; n < 60; n++) await send(body('Ayuda'), 'invalid').expect(401);
    await send(body('Ayuda'), 'invalid').expect(429);
  });
});
