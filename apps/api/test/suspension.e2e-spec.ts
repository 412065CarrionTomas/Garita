import { Logger, RequestMethod, type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  USER_ROLES,
  SUSPENSION_MESSAGES,
  accountSuspendedResponseSchema,
  authMeResponseSchema,
  guardSelectionRequiredSchema,
} from '@garita/shared';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { CLOCK } from '../src/common/clock';
import { ALLOWED_ROLES, PUBLIC_ROUTE } from '../src/modules/auth/auth.decorators';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { suspensionClassification } from '../src/modules/auth/account-suspension.policy';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { AccountService } from '../src/modules/account/account.service';
import { AccountTrialProcessor } from '../src/modules/account/account-trial.processor';
import { GraceProcessor } from '../src/modules/subscriptions/grace.processor';
import { PlanChangeProcessor } from '../src/modules/subscriptions/plan-change.processor';
import { SuspensionProcessor } from '../src/modules/subscriptions/suspension.processor';
import { SuspensionService } from '../src/modules/subscriptions/suspension.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';
import { MercadoPagoNotificationsProcessor } from '../src/modules/subscriptions/mercadopago-notifications.processor';
import { MercadoPagoReconciliationProcessor } from '../src/modules/subscriptions/mercadopago-reconciliation.processor';
import { CoverageNoticesService } from '../src/modules/coverage-notices/coverage-notices.service';
import { ResendInvitationMailer } from '../src/modules/users/email.service';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { SMS_PORT } from '../src/common/ports/sms.port';
import { ShiftCredentialService } from '../src/modules/sync/shift-credential.service';
import { QrService } from '../src/modules/checkpoints/qr.service';
import { MercadoPagoWebhookService } from '../src/modules/subscriptions/mercadopago-webhook.service';

jest.setTimeout(120_000);
const rowIds = (body: unknown) =>
  z
    .array(z.object({ id: z.string() }))
    .parse(body)
    .map((row) => row.id);
const itemIds = (body: unknown) =>
  rowIds(z.object({ items: z.array(z.object({ id: z.string() })) }).parse(body).items);
const results = (body: unknown) =>
  z.object({ results: z.array(z.object({ status: z.string() })) }).parse(body).results;
describe('HU-43 HTTP: permissions, started shifts and full-cycle recovery', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const companyId = `hu43-${randomUUID()}`;
  let adminId: string,
    guardId: string,
    supervisorId: string,
    clientId: string,
    siteId: string,
    shiftId: string,
    assignmentId: string,
    planId: string,
    subId: string,
    checkpointId: string,
    roundId: string,
    versionId: string;
  let now = new Date('2030-12-08T22:30:00Z');
  const next = '2031-01-01T12:00:00.000Z';
  const notificationIds: string[] = [];
  const remote: { id: string; status: string; next_payment_date: string | null } = {
    id: companyId,
    status: 'authorized',
    next_payment_date: next,
  };
  const mp = {
    getPreapproval: jest.fn().mockImplementation(() => Promise.resolve({ ...remote })),
    setPreapprovalStatus: jest.fn().mockImplementation((_id: string, status: string) => {
      remote.status = status;
      return Promise.resolve({ ...remote });
    }),
    searchAuthorizedPayments: jest.fn().mockResolvedValue([]),
    getAuthorizedPayment: jest.fn().mockResolvedValue({ payment: { status: 'rejected' } }),
    searchGracePayments: jest.fn().mockResolvedValue([]),
    createPreference: jest
      .fn()
      .mockResolvedValue({ id: 'preference', initPoint: 'https://mp.test/overdue' }),
    updatePreapprovalAmount: jest.fn(),
    getPayment: jest.fn(),
  };
  const auth = (role = 'admin') => ({ Authorization: `Bearer ${companyId}-${role}` });
  const http = (method: string, path: string) => {
    const agent = request(app.getHttpServer());
    switch (method) {
      case 'GET':
        return agent.get(path);
      case 'POST':
        return agent.post(path);
      case 'PUT':
        return agent.put(path);
      case 'PATCH':
        return agent.patch(path);
      case 'DELETE':
        return agent.delete(path);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  };
  async function suspend() {
    await app.get(AccountService).transition({ companyId, to: 'grace', graceEndsAt: now });
    now = new Date('2030-12-09T00:00:00Z');
    await app
      .get(AccountService)
      .transition({ companyId, to: 'suspended', reason: 'grace_expired' });
  }
  beforeAll(async () => {
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (uid: string) => Promise.resolve({ uid }),
        setDisabled: jest.fn(),
        revokeRefreshTokens: jest.fn(),
      })
      .overrideProvider(MercadoPagoClient)
      .useValue(mp)
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(ResendInvitationMailer)
      .useValue({
        sendInvitation: jest.fn(),
        sendTrialReminder: jest.fn(),
        sendGraceReminder: jest.fn(),
      })
      .overrideProvider(NOTIFICATIONS_PORT)
      .useValue({ notifySiteStaff: jest.fn(), notifyUsers: jest.fn() })
      .overrideProvider(SMS_PORT)
      .useValue({ sendPanicAlert: jest.fn(), sendShiftClosed: jest.fn() });
    for (const processor of [
      AccountTrialProcessor,
      GraceProcessor,
      PlanChangeProcessor,
      SuspensionProcessor,
      MercadoPagoNotificationsProcessor,
      MercadoPagoReconciliationProcessor,
    ])
      builder.overrideProvider(processor).useValue({});
    const module = await builder.compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.create({ data: { id: companyId, name: 'HU43', accountStatus: 'active' } });
    clientId = (
      await db.client.create({
        data: {
          companyId,
          name: 'Cliente HU43',
          contactName: 'Contacto',
          phone: '+5493511234567',
          email: 'cliente@example.invalid',
        },
      })
    ).id;
    const users = new Map<string, string>();
    for (const role of [...USER_ROLES, 'other-supervisor'] as const) {
      const user = await db.user.create({
        data: {
          companyId,
          firebaseUid: `${companyId}-${role}`,
          email: `${companyId}-${role}@example.invalid`,
          firstName: 'HU43',
          lastName: role,
          role: role === 'other-supervisor' ? 'supervisor' : role,
          status: 'active',
          ...(role === 'client' ? { clientId } : {}),
        },
      });
      users.set(role, user.id);
    }
    const admin = users.get('admin'),
      guard = users.get('guard'),
      supervisor = users.get('supervisor');
    if (!admin || !guard || !supervisor) throw new Error('Missing test users');
    adminId = admin;
    guardId = guard;
    supervisorId = supervisor;
    siteId = (
      await db.site.create({
        data: {
          companyId,
          clientId,
          name: 'Predio HU43',
          address: 'Calle 1',
          latitude: '-31',
          longitude: '-64',
        },
      })
    ).id;
    await db.siteSupervisor.create({ data: { companyId, siteId, userId: supervisorId } });
    planId = (
      await db.plan.create({
        data: { code: companyId, name: 'Plan HU43', monthlyPrice: '45000.00', maxGuards: 10 },
      })
    ).id;
    checkpointId = (
      await db.checkpoint.create({
        data: { companyId, siteId, name: 'Punto HU43', latitude: '-31', longitude: '-64' },
      })
    ).id;
    const round = await db.round.create({
      data: {
        companyId,
        siteId,
        name: 'Ronda HU43',
        versions: {
          create: {
            versionNumber: 1,
            createdById: adminId,
            frequencyMinutes: 60,
            graceMinutes: 15,
            windowStartLocal: '00:00',
            windowEndLocal: '23:59',
            checkpoints: { create: { companyId, checkpointId, position: 0 } },
          },
        },
      },
      include: { versions: true },
    });
    roundId = round.id;
    const version = round.versions[0];
    if (!version) throw new Error('Missing test round version');
    versionId = version.id;
    await db.round.update({ where: { id: roundId }, data: { currentVersionId: versionId } });
  });
  beforeEach(async () => {
    now = new Date('2030-12-08T22:30:00Z');
    remote.status = 'authorized';
    remote.next_payment_date = next;
    jest.clearAllMocks();
    await db.shift.deleteMany({ where: { companyId } });
    await db.subscriptionCharge.deleteMany({ where: { companyId } });
    await db.subscription.deleteMany({ where: { companyId } });
    await db.company.update({
      where: { id: companyId },
      data: {
        accountStatus: 'active',
        suspendedAt: null,
        suspensionReason: null,
        suspensionEffectsPending: false,
        graceChargeId: null,
      },
    });
    const shift = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-12-08T22:00:00Z'),
        endsAt: new Date('2030-12-09T06:00:00Z'),
        serviceDate: new Date('2030-12-08'),
        startedAt: new Date('2030-12-08T22:00:00Z'),
        status: 'in_progress',
        syncDeadlineAt: new Date('2030-12-09T08:00:00Z'),
        assignments: {
          create: {
            guardId,
            assignedById: adminId,
            startsAt: new Date('2030-12-08T22:00:00Z'),
            endsAt: new Date('2030-12-09T06:00:00Z'),
            result: 'started',
          },
        },
      },
      include: { assignments: true },
    });
    shiftId = shift.id;
    const assignment = shift.assignments[0];
    if (!assignment) throw new Error('Missing test assignment');
    assignmentId = assignment.id;
    await db.shiftRound.create({ data: { shiftId, roundId, roundVersionId: versionId } });
    subId = (
      await db.subscription.create({
        data: {
          companyId,
          planId,
          payerEmail: 'hu43@example.invalid',
          status: 'authorized',
          startsAt: now,
          nextChargeAt: new Date(next),
          mpPreapprovalId: companyId,
        },
      })
    ).id;
  });
  afterAll(async () => {
    {
      await db.mercadoPagoNotification.deleteMany({ where: { id: { in: notificationIds } } });
      await db.shift.deleteMany({ where: { companyId } });
      await db.subscriptionCharge.deleteMany({ where: { companyId } });
      await db.subscription.deleteMany({ where: { companyId } });
      await db.round.update({ where: { id: roundId }, data: { currentVersionId: null } });
      await db.roundVersionCheckpoint.deleteMany({ where: { companyId } });
      await db.roundVersion.deleteMany({ where: { roundId } });
      await db.round.delete({ where: { id: roundId } });
      await db.checkpoint.delete({ where: { id: checkpointId } });
      await db.siteSupervisor.deleteMany({ where: { companyId } });
      await db.site.deleteMany({ where: { companyId } });
      await db.user.deleteMany({ where: { companyId } });
      await db.client.deleteMany({ where: { companyId } });
      await db.company.delete({ where: { id: companyId } });
      await db.plan.delete({ where: { id: planId } });
    }
    await app.close();
  });

  it('enumerates every server route and blocks every unlisted authenticated route for every permitted role', async () => {
    await suspend();
    let checked = 0;
    const inventory: string[] = ['| Método | Endpoint | Clasificación |', '| --- | --- | --- |'];
    for (const module of app.get(ModulesContainer).values())
      for (const controller of module.controllers.values()) {
        const target = controller.metatype;
        if (!target) continue;
        const base: unknown = Reflect.getMetadata(PATH_METADATA, target);
        for (const name of Object.getOwnPropertyNames(target.prototype)) {
          const descriptor = Object.getOwnPropertyDescriptor(target.prototype, name);
          const handler: unknown = descriptor?.value;
          if (typeof handler !== 'function') continue;
          const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
          const suffix: unknown = Reflect.getMetadata(PATH_METADATA, handler);
          if (typeof method !== 'number' || typeof base !== 'string' || typeof suffix !== 'string')
            continue;
          const route = [base, suffix]
            .filter(Boolean)
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/^\//, '')
            .replace(/\/$/, '');
          const methodName = RequestMethod[method];
          if (!methodName) throw new Error('Unknown HTTP method');
          const publicRoute: unknown =
            Reflect.getMetadata(PUBLIC_ROUTE, handler) ?? Reflect.getMetadata(PUBLIC_ROUTE, target);
          const guards: unknown =
            Reflect.getMetadata(GUARDS_METADATA, handler) ??
            Reflect.getMetadata(GUARDS_METADATA, target);
          const credential =
            Array.isArray(guards) &&
            guards.some(
              (guard: unknown) =>
                typeof guard === 'function' && guard.name === 'ShiftCredentialGuard',
            );
          inventory.push(
            `| ${methodName} | /api/v1/${route} | ${publicRoute ? (credential ? 'credencial de turno' : 'público') : suspensionClassification(methodName, route)} |`,
          );
          if (publicRoute) continue;
          if (suspensionClassification(methodName, route) !== 'blocked') continue;
          const roles: unknown =
            Reflect.getMetadata(ALLOWED_ROLES, handler) ??
            Reflect.getMetadata(ALLOWED_ROLES, target);
          expect(Array.isArray(roles)).toBe(true);
          if (!Array.isArray(roles)) continue;
          for (const role of USER_ROLES.filter((role) => roles.includes(role))) {
            const response = await http(
              methodName,
              `/api/v1/${route.replace(/:[^/]+/g, randomUUID())}`,
            )
              .set(auth(role))
              .send({});
            expect({ route: `${methodName} ${route}`, role, status: response.status }).toEqual({
              route: `${methodName} ${route}`,
              role,
              status: 402,
            });
            expect(response.body).toMatchObject({
              code: 'ACCOUNT_SUSPENDED',
              message: SUSPENSION_MESSAGES[role],
            });
            checked++;
          }
        }
      }
    expect(checked).toBeGreaterThan(100);
    if (process.env.HU43_ENDPOINT_REPORT)
      writeFileSync(process.env.HU43_ENDPOINT_REPORT, inventory.join('\n') + '\n');
  });

  it('keeps only the started shift, its notices and unresolved alerts, with site isolation', async () => {
    const past = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-12-07T10:00:00Z'),
        endsAt: new Date('2030-12-07T18:00:00Z'),
        serviceDate: new Date('2030-12-07'),
        status: 'closed',
      },
    });
    const notice = await db.notice.create({
      data: {
        companyId,
        siteId,
        shiftId,
        kind: 'round_missed',
        subjectId: shiftId,
        key: randomUUID(),
      },
    });
    await db.notice.create({
      data: {
        companyId,
        siteId,
        shiftId: past.id,
        kind: 'round_missed',
        subjectId: past.id,
        key: randomUUID(),
      },
    });
    const alert = await db.panicAlert.create({
      data: {
        id: randomUUID(),
        companyId,
        siteId,
        shiftId,
        assignmentId,
        guardId,
        triggeredAt: now,
        receivedAt: now,
        locationStatus: 'disabled',
      },
    });
    await suspend();
    const visible = await http('GET', '/api/v1/supervision/turnos')
      .set(auth('supervisor'))
      .expect(200);
    expect(rowIds(visible.body)).toEqual([shiftId]);
    const mine = await http('GET', '/api/v1/mis-turnos').set(auth('guard')).expect(200);
    expect(rowIds(mine.body)).toEqual([shiftId]);
    const notices = await http('GET', '/api/v1/avisos').set(auth('supervisor')).expect(200);
    expect(itemIds(notices.body)).toEqual([notice.id]);
    const panic = await http('GET', '/api/v1/alertas-panico').set(auth('supervisor')).expect(200);
    expect(itemIds(panic.body)).toEqual([alert.id]);
    await http('GET', `/api/v1/turnos/${shiftId}/detalle`).set(auth('supervisor')).expect(200);
    await http('GET', `/api/v1/turnos/${shiftId}/detalle`)
      .set(auth('other-supervisor'))
      .expect(402);
    await http('GET', `/api/v1/turnos/${past.id}/detalle`).set(auth('supervisor')).expect(402);
    await http('POST', `/api/v1/alertas-panico/${alert.id}/confirmar`)
      .set(auth('supervisor'))
      .expect(200);
    await http('POST', `/api/v1/alertas-panico/${alert.id}/resolver`)
      .set(auth('supervisor'))
      .send({ outcome: 'false_alarm', comment: 'Falsa alarma confirmada' })
      .expect(200);
    await http('GET', `/api/v1/alertas-panico/${alert.id}`).set(auth('supervisor')).expect(402);
  });

  it('cancels due unstarted shifts without coverage notices and never restores them', async () => {
    const due = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-12-08T23:00:00Z'),
        endsAt: new Date('2030-12-09T05:00:00Z'),
        serviceDate: new Date('2030-12-08'),
        status: 'unassigned',
      },
    });
    const future = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-12-21T23:00:00Z'),
        endsAt: new Date('2030-12-22T05:00:00Z'),
        serviceDate: new Date('2030-12-21'),
        status: 'unassigned',
      },
    });
    await suspend();
    await app.get(CoverageNoticesService).sweep();
    expect((await db.shift.findUniqueOrThrow({ where: { id: due.id } })).status).toBe(
      'cancelled_by_suspension',
    );
    expect(
      await db.notice.count({
        where: { companyId, kind: { in: ['shift_without_guard', 'shift_not_started'] } },
      }),
    ).toBe(0);
    await app.get(AccountService).transition({ companyId, to: 'active' });
    expect((await db.shift.findUniqueOrThrow({ where: { id: due.id } })).status).toBe(
      'cancelled_by_suspension',
    );
    expect((await db.shift.findUniqueOrThrow({ where: { id: future.id } })).status).toBe(
      'unassigned',
    );
  });

  it('preserves records, incidents, panic and late synchronization with the shift credential', async () => {
    const { token } = await app.get(ShiftCredentialService).issueCredential({
      shiftId,
      assignmentId,
      userId: guardId,
      companyId,
      scheduledEnd: new Date('2030-12-09T06:00:00Z'),
    });
    await suspend();
    const location = {
      status: 'disabled',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      simulation: 'unavailable',
      takenAt: null,
    };
    const credential = { Authorization: `Bearer ${token}` };
    const record = {
      recordId: randomUUID(),
      shiftId,
      method: 'qr',
      scannedValue: app.get(QrService).createPayload(checkpointId, 1),
      occurredAtDevice: now.toISOString(),
      location,
      phoneNfc: 'unsupported',
    };
    const incident = {
      incidentId: randomUUID(),
      shiftId,
      type: 'intrusion',
      photoCount: 0,
      occurredAtDevice: now.toISOString(),
      location,
    };
    await http('POST', '/api/v1/alertas-panico')
      .set(credential)
      .send({ alertId: randomUUID(), shiftId, occurredAtDevice: now.toISOString(), location })
      .expect(200);
    const batch = await http('POST', '/api/v1/sincronizacion/eventos')
      .set(credential)
      .send({
        shiftId,
        pendingCount: 0,
        syncedUntil: null,
        events: [
          { type: 'checkpoint_record', payload: record },
          { type: 'incident', payload: incident },
        ],
      })
      .expect(200);
    expect(results(batch.body).map((row) => row.status)).toEqual(['accepted', 'accepted']);
    expect(await db.checkpointRecord.count({ where: { companyId, shiftId } })).toBe(1);
    expect(await db.incident.count({ where: { companyId, shiftId } })).toBe(1);
    await db.shift.update({
      where: { id: shiftId },
      data: { status: 'auto_closed', closedAt: new Date('2030-12-09T06:00:00Z') },
    });
    now = new Date('2030-12-09T09:00:00Z');
    await http('GET', `/api/v1/turnos/${shiftId}/detalle`).set(auth('supervisor')).expect(402);
    const late = await http('POST', '/api/v1/sincronizacion/eventos')
      .set(credential)
      .send({
        shiftId,
        pendingCount: 0,
        syncedUntil: null,
        events: [
          {
            type: 'incident',
            payload: {
              ...incident,
              incidentId: randomUUID(),
              occurredAtDevice: '2030-12-09T05:00:00Z',
            },
          },
        ],
      })
      .expect(200);
    expect(results(late.body)[0]?.status).toBe('accepted');
  });

  it('refuses a new guard start with 402 and marks the unstarted shift cancelled', async () => {
    const fresh = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-12-09T22:00:00Z'),
        endsAt: new Date('2030-12-10T06:00:00Z'),
        serviceDate: new Date('2030-12-09'),
        assignments: {
          create: {
            guardId,
            assignedById: adminId,
            startsAt: new Date('2030-12-09T22:00:00Z'),
            endsAt: new Date('2030-12-10T06:00:00Z'),
          },
        },
      },
    });
    await suspend();
    const result = await http('POST', `/api/v1/turnos/${fresh.id}/iniciar`)
      .set(auth('guard'))
      .send({})
      .expect(402);
    expect(accountSuspendedResponseSchema.parse(result.body).message).toBe(
      SUSPENSION_MESSAGES.guard,
    );
    expect((await db.shift.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      'cancelled_by_suspension',
    );
    expect((await db.shift.findUniqueOrThrow({ where: { id: shiftId } })).status).toBe(
      'in_progress',
    );
    // V9 H2: la asignación del turno cancelado se libera; la del turno en curso sigue activa.
    expect(await db.shiftAssignment.count({ where: { shiftId: fresh.id, active: true } })).toBe(0);
    expect(
      (await db.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).active,
    ).toBe(true);
  });

  it('V9 H2: after reactivation the guard of a shift cancelled by suspension can be rescheduled', async () => {
    const other = await db.user.create({
      data: {
        companyId,
        firebaseUid: `${companyId}-guard-h2`,
        email: `${companyId}-guard-h2@example.invalid`,
        firstName: 'HU43',
        lastName: 'guard-h2',
        role: 'guard',
        status: 'active',
      },
    });
    const due = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        startsAt: new Date('2030-12-08T23:30:00Z'),
        endsAt: new Date('2030-12-09T08:00:00Z'),
        serviceDate: new Date('2030-12-08'),
        assignments: {
          create: {
            guardId: other.id,
            assignedById: adminId,
            startsAt: new Date('2030-12-08T23:30:00Z'),
            endsAt: new Date('2030-12-09T08:00:00Z'),
          },
        },
      },
    });
    await suspend();
    expect((await db.shift.findUniqueOrThrow({ where: { id: due.id } })).status).toBe(
      'cancelled_by_suspension',
    );
    expect(await db.shiftAssignment.count({ where: { shiftId: due.id, active: true } })).toBe(0);
    await db.company.update({
      where: { id: companyId },
      data: { accountStatus: 'active', suspendedAt: null, suspensionReason: null },
    });
    now = new Date('2030-12-09T00:30:00Z');
    await http('POST', '/api/v1/turnos')
      .set(auth())
      .send({
        siteId,
        guardId: other.id,
        roundIds: [roundId],
        startsAt: '2030-12-09T01:00:00.000Z',
        endsAt: '2030-12-09T08:00:00.000Z',
      })
      .expect(201);
    await db.shift.deleteMany({ where: { companyId } });
    await db.user.delete({ where: { id: other.id } });
  });

  it('V9 H1: a paused preapproval without next_payment_date keeps the expected charge date', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error');
    await suspend();
    await app.get(SuspensionService).reconcile(companyId);
    expect(mp.setPreapprovalStatus).toHaveBeenCalledWith(companyId, 'paused');
    remote.next_payment_date = null;
    await http('GET', '/api/v1/suscripcion').set(auth()).expect(200);
    expect(
      (
        await db.subscription.findUniqueOrThrow({ where: { id: subId } })
      ).nextChargeAt?.toISOString(),
    ).toBe(next);
    remote.next_payment_date = next;
    await db.company.update({
      where: { id: companyId },
      data: { accountStatus: 'active', suspendedAt: null, suspensionReason: null },
    });
    await app.get(SuspensionService).reconcile(companyId);
    const resumed = await db.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(resumed.status).toBe('authorized');
    expect(resumed.nextChargeAt?.toISOString()).toBe(next);
    expect(errors).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'subscription.next_payment_date_diff' }),
    );
    errors.mockRestore();
  });

  it.each([next, '2031-01-20T12:00:00.000Z'])(
    'pays the complete rejected cycle and resumes with remote date %s',
    async (remoteDate) => {
      const charge = await db.subscriptionCharge.create({
        data: {
          companyId,
          subscriptionId: subId,
          mpAuthorizedPaymentId: randomUUID(),
          amount: '45000.00',
          status: 'rejected',
          chargedAt: new Date('2030-12-01T12:00:00Z'),
        },
      });
      await db.company.update({ where: { id: companyId }, data: { graceChargeId: charge.id } });
      await suspend();
      await app.get(SuspensionService).reconcile(companyId);
      expect(mp.setPreapprovalStatus).toHaveBeenCalledWith(companyId, 'paused');
      now = new Date('2030-12-20T12:00:00Z');
      await http('POST', '/api/v1/suscripcion/pagar-adeudado').set(auth()).send({}).expect(201);
      expect(mp.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '45000.00', externalReference: `grace:${charge.id}` }),
      );
      const payment = {
        id: `${companyId}-paid`,
        status: 'approved',
        external_reference: `grace:${charge.id}`,
        transaction_amount: '45000.00',
        currency_id: 'ARS',
      };
      mp.getPayment.mockResolvedValue(payment);
      const notificationId = randomUUID();
      notificationIds.push(notificationId);
      await app
        .get(MercadoPagoWebhookService)
        .receive({ id: notificationId, type: 'payment', resourceId: payment.id });
      await app.get(MercadoPagoWebhookService).process(notificationId);
      await app.get(MercadoPagoWebhookService).process(notificationId);
      remote.next_payment_date = remoteDate;
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        await app.get(SuspensionService).reconcile(companyId);
        if (remoteDate !== next)
          expect(log).toHaveBeenCalledWith(
            expect.objectContaining({
              event: 'subscription.next_payment_date_diff',
              expected: next,
              actual: remoteDate,
            }),
          );
        await app.get(SubscriptionsService).syncPreapproval(companyId);
        await http('GET', '/api/v1/suscripcion').set(auth()).expect(200);
        expect(
          (await db.company.findUniqueOrThrow({ where: { id: companyId } })).accountStatus,
        ).toBe('active');
        expect(
          (
            await db.subscription.findUniqueOrThrow({ where: { id: subId } })
          ).nextChargeAt?.toISOString(),
        ).toBe(remoteDate);
        expect(
          mp.setPreapprovalStatus.mock.calls.filter(([, status]) => status === 'authorized'),
        ).toHaveLength(1);
      } finally {
        log.mockRestore();
      }
    },
  );

  it('requires a session, keeps debt payment admin-only and rejects debt-free re-subscriptions', async () => {
    await http('POST', '/api/v1/suscripcion/pagar-adeudado').send({}).expect(401);
    await http('POST', '/api/v1/suscripcion/pagar-adeudado')
      .set(auth('supervisor'))
      .send({})
      .expect(403);
    await http('POST', '/api/v1/suscripcion/pagar-adeudado').set(auth()).send({}).expect(409);
    await suspend();
    await http('POST', `/api/v1/turnos/${shiftId}/reasignar`).set(auth()).send({}).expect(402);
    const me = await http('GET', '/api/v1/auth/me').set(auth('client')).expect(200);
    expect(authMeResponseSchema.parse(me.body).company).toMatchObject({
      accountStatus: 'suspended',
    });
    expect(JSON.stringify(me.body)).not.toMatch(/grace_expired|graceChargeId|45000/);
  });

  it('requires guard selection when regularizing with a smaller plan', async () => {
    const small = await db.plan.create({
      data: {
        code: `${companyId}-small`,
        name: 'Menor HU43',
        monthlyPrice: '20000.00',
        maxGuards: 1,
      },
    });
    const extra = await db.user.create({
      data: {
        companyId,
        firebaseUid: `${companyId}-extra`,
        email: `${companyId}-extra@example.invalid`,
        firstName: 'Otro',
        lastName: 'Vigilador',
        role: 'guard',
        status: 'active',
      },
    });
    try {
      const charge = await db.subscriptionCharge.create({
        data: {
          companyId,
          subscriptionId: subId,
          mpAuthorizedPaymentId: randomUUID(),
          amount: '45000.00',
          status: 'rejected',
        },
      });
      await db.company.update({ where: { id: companyId }, data: { graceChargeId: charge.id } });
      await suspend();
      const response = await http('POST', '/api/v1/suscripcion/pagar-adeudado')
        .set(auth())
        .send({ planId: small.id })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'guard_selection_required', maxGuards: 1 });
      expect(guardSelectionRequiredSchema.parse(response.body).guards).toHaveLength(2);
      expect(mp.createPreference).not.toHaveBeenCalled();
    } finally {
      await db.user.delete({ where: { id: extra.id } });
      await db.plan.delete({ where: { id: small.id } });
    }
  });
});
