import { PlanChangeProcessor } from '../src/modules/subscriptions/plan-change.processor';
import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  incidentReportResponseSchema,
  incidentReportDetailResponseSchema,
  responseTimesReportSchema,
  panicReportResponseSchema,
  panicReportDetailResponseSchema,
} from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { REALTIME_PORT } from '../src/common/ports/realtime.port';

function fixtureId(ids: readonly string[], index: number): string {
  const id = ids[index];
  if (!id) throw new Error('Falta un identificador del fixture');
  return id;
}

describe('HU-26 incidentes y respuesta por HTTP', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const prefix = `hu26-${randomUUID()}`;
  const period = 'desde=2026-10-01&hasta=2026-11-01';
  const auth = (uid = 'seed-norte-admin') => ({ Authorization: `Bearer ${uid}` });
  let adminId: string;
  let guardId: string;
  let supervisorId: string;
  let otherSupervisorId: string;
  let clientId: string;
  const sites: string[] = [];
  const shifts: string[] = [];
  const assignments: string[] = [];
  let incidentId: string;
  let alertId: string;
  const at = (value: string) => new Date(`2026-10-01T${value}Z`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (uid: string) => Promise.resolve({ uid }) })
      .overrideProvider(CLOCK)
      .useValue({ now: () => new Date('2026-11-01T12:00:00Z') })
      .overrideProvider(NOTIFICATIONS_PORT)
      .useValue({ notifySiteStaff: jest.fn(), notifyUsers: jest.fn() })
      .overrideProvider(REALTIME_PORT)
      .useValue({ emitToSite: jest.fn() })
      .overrideProvider(PlanChangeProcessor)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    adminId = (await db.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-admin' } })).id;
    guardId = (await db.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-guard' } })).id;
    supervisorId = (
      await db.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-supervisor' } })
    ).id;
    otherSupervisorId = (
      await db.user.create({
        data: {
          companyId: 'norte-company',
          firebaseUid: prefix,
          email: `${prefix}@example.invalid`,
          firstName: 'Otro',
          lastName: 'Supervisor',
          role: 'supervisor',
          status: 'active',
        },
      })
    ).id;
    clientId = (
      await db.client.create({
        data: {
          companyId: 'norte-company',
          name: prefix,
          contactName: 'Ana',
          email: `${prefix}@example.invalid`,
          phone: '+541112345678',
        },
      })
    ).id;
    for (let i = 0; i < 2; i++) {
      const site = await db.site.create({
        data: {
          companyId: 'norte-company',
          clientId,
          name: `${prefix}-${i}`,
          address: 'Ruta 9',
          latitude: -34,
          longitude: -58,
        },
      });
      sites.push(site.id);
      const shift = await db.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: site.id,
          createdById: adminId,
          startsAt: at('03:00:00'),
          endsAt: new Date('2026-11-01T03:00:00Z'),
          serviceDate: new Date('2026-10-01'),
          status: 'closed',
        },
      });
      shifts.push(shift.id);
      const assignment = await db.shiftAssignment.create({
        data: {
          shiftId: shift.id,
          guardId,
          assignedById: adminId,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          active: false,
          result: 'closed_early',
        },
      });
      assignments.push(assignment.id);
    }
    await db.siteSupervisor.createMany({
      data: [
        { companyId: 'norte-company', siteId: fixtureId(sites, 0), userId: supervisorId },
        { companyId: 'norte-company', siteId: fixtureId(sites, 0), userId: otherSupervisorId },
      ],
    });
    const incidentData = (index: number) => ({
      companyId: 'norte-company',
      siteId: fixtureId(sites, index),
      shiftId: fixtureId(shifts, index),
      assignmentId: fixtureId(assignments, index),
      guardId,
      incidentId: randomUUID(),
      type: 'intrusion' as const,
      occurredAtDevice: at('04:00:00'),
      trustedAt: at('05:00:00'),
      receivedAt: at('05:10:00'),
      locationStatus: 'unverifiable' as const,
      simulation: 'not_simulated' as const,
    });
    incidentId = (await db.incident.create({ data: incidentData(0) })).id;
    await db.incident.createMany({
      data: [
        { ...incidentData(0), classificationStatus: 'client_visible' },
        { ...incidentData(0), classificationStatus: 'internal' },
        incidentData(1),
      ],
    });
    await db.incidentClassification.createMany({
      data: [
        {
          companyId: 'norte-company',
          incidentId,
          classification: 'internal',
          internalComment: 'Primera decisión',
          decidedById: supervisorId,
          decidedAt: at('05:12:00'),
        },
        {
          companyId: 'norte-company',
          incidentId,
          classification: 'client_visible',
          internalComment: 'Reclasificación',
          decidedById: otherSupervisorId,
          decidedAt: at('05:20:00'),
        },
      ],
    });
    await db.incident.update({
      where: { id: incidentId },
      data: { classificationStatus: 'client_visible' },
    });
    alertId = randomUUID();
    const panicBase = {
      companyId: 'norte-company',
      siteId: fixtureId(sites, 0),
      shiftId: fixtureId(shifts, 0),
      assignmentId: fixtureId(assignments, 0),
      guardId,
      locationStatus: 'unverifiable' as const,
      triggeredAt: at('06:10:00'),
      receivedAt: at('06:25:00'),
    };
    await db.panicAlert.createMany({
      data: [
        {
          ...panicBase,
          id: alertId,
          channel: 'sms',
          status: 'resolved',
          confirmedAt: at('06:27:00'),
          confirmedById: supervisorId,
          escalatedAt: at('06:26:00'),
          outcome: 'false_alarm',
        },
        {
          ...panicBase,
          id: randomUUID(),
          status: 'confirmed',
          confirmedAt: at('06:29:00'),
          confirmedById: otherSupervisorId,
          outcome: 'real_emergency',
        },
        { ...panicBase, id: randomUUID(), outcome: 'test' },
        {
          ...panicBase,
          id: randomUUID(),
          siteId: fixtureId(sites, 1),
          shiftId: fixtureId(shifts, 1),
          assignmentId: fixtureId(assignments, 1),
        },
      ],
    });
    const notice = await db.notice.create({
      data: {
        companyId: 'norte-company',
        siteId: fixtureId(sites, 0),
        shiftId: fixtureId(shifts, 0),
        kind: 'round_missed',
        subjectId: prefix,
        key: prefix,
        createdAt: at('07:00:00'),
      },
    });
    await db.noticeView.createMany({
      data: [
        {
          companyId: 'norte-company',
          noticeId: notice.id,
          userId: supervisorId,
          seenAt: at('07:02:00'),
        },
        {
          companyId: 'norte-company',
          noticeId: notice.id,
          userId: otherSupervisorId,
          seenAt: at('07:10:00'),
        },
      ],
    });
  }, 30000);
  afterAll(async () => {
    await db.incident.deleteMany({ where: { siteId: { in: sites } } });
    await db.panicAlert.deleteMany({ where: { siteId: { in: sites } } });
    await db.shift.deleteMany({ where: { siteId: { in: sites } } });
    await db.siteSupervisor.deleteMany({ where: { siteId: { in: sites } } });
    await db.site.deleteMany({ where: { id: { in: sites } } });
    await db.client.deleteMany({ where: { id: clientId } });
    await db.user.deleteMany({ where: { id: otherSupervisorId } });
    await app.close();
  });
  const get = (endpoint: string, params = '', uid = 'seed-norte-admin') =>
    request(app.getHttpServer())
      .get(`/api/v1/reportes/${endpoint}?${period}&cliente=${clientId}${params}`)
      .set(auth(uid));
  it('CA1 agrupa tipo, franja confiable, predio y clasificación; pagina un segmento', async () => {
    const report = incidentReportResponseSchema.parse(
      (await get('incidentes', `&predio=${sites[0]}`).expect(200)).body,
    );
    expect(report.total).toBe(3);
    expect(report.byType.find((row) => row.id === 'intrusion')?.value).toBe(3);
    expect(report.byTimeBand.find((row) => row.id === '2')?.value).toBe(3);
    expect(report.byClassification.find((row) => row.id === 'client_visible')?.value).toBe(2);
    const detail = incidentReportDetailResponseSchema.parse(
      (
        await get(
          'incidentes/detalle',
          `&predio=${sites[0]}&tipo=intrusion&franja=2&clasificacion=client_visible&pageSize=1&page=2`,
        ).expect(200)
      ).body,
    );
    expect(detail.total).toBe(2);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.classificationStatus).toBe('client_visible');
  });
  it('CA2/CA3 usa envío, promedio/máximo, primera lectura y primera decisión', async () => {
    const report = responseTimesReportSchema.parse(
      (await get('tiempos-de-respuesta').expect(200)).body,
    );
    expect(report.totals.panic).toEqual({
      count: 2,
      averageMs: 18 * 60000,
      maximumMs: 19 * 60000,
      escalated: 1,
      unanswered: 2,
    });
    expect(report.totals.missedRound.averageMs).toBe(120000);
    expect(report.totals.classification.averageMs).toBe(120000);
    expect(
      'bySupervisor' in report &&
        report.bySupervisor.find((row) => row.id === supervisorId)?.times.panic.averageMs,
    ).toBe(17 * 60000);
  });
  it('CA6 el JSON del supervisor contiene totales visibles y own, nunca bySupervisor ni otro nombre', async () => {
    const response = await get('tiempos-de-respuesta', '', 'seed-norte-supervisor').expect(200);
    const report = responseTimesReportSchema.parse(response.body);
    expect(response.body).not.toHaveProperty('bySupervisor');
    expect(response.body).toHaveProperty('own.id', supervisorId);
    expect(JSON.stringify(response.body)).not.toContain('Otro Supervisor');
    expect(report.totals.panic.count).toBe(2);
    expect(report.totals.panic.unanswered).toBe(1);
    expect('own' in report && report.own.times.missedRound.count).toBe(1);
    const other = responseTimesReportSchema.parse(
      (await get('tiempos-de-respuesta', '', prefix).expect(200)).body,
    );
    expect('own' in other && other.own.times.classification.count).toBe(0);
  });
  it('CA4 separa resultados, sin resolver y canales; detalle con enlace identificable', async () => {
    const report = panicReportResponseSchema.parse((await get('panico').expect(200)).body);
    expect(report.byOutcome.map((row) => row.value)).toEqual([1, 1, 1, 1]);
    expect(report.byChannel.map((row) => row.value)).toEqual([3, 1]);
    expect(report.falseAlarmProportion).toBe(0.25);
    const detail = panicReportDetailResponseSchema.parse(
      (await get('panico/detalle', '&resultado=false_alarm&canal=sms&pageSize=1').expect(200)).body,
    );
    expect(detail.total).toBe(1);
    expect(detail.items[0]?.id).toBe(alertId);
  });
  it.each(['incidentes', 'incidentes/detalle', 'tiempos-de-respuesta', 'panico', 'panico/detalle'])(
    '%s valida períodos y CA5',
    async (endpoint) => {
      for (const range of [
        'desde=2026-01-01&hasta=2027-02-01',
        'desde=2026-11-01&hasta=2026-10-01',
      ]) {
        await request(app.getHttpServer())
          .get(`/api/v1/reportes/${endpoint}?${range}`)
          .set(auth())
          .expect(400);
      }
      await get(endpoint, `&predio=${sites[1]}`, 'seed-norte-supervisor').expect(404);
    },
  );
  it('50 predios × 31 días: cada endpoint principal responde en menos de 3 segundos', async () => {
    const siteIds = Array.from({ length: 50 }, () => randomUUID());
    sites.push(...siteIds);
    await db.site.createMany({
      data: siteIds.map((id, i) => ({
        id,
        companyId: 'norte-company',
        clientId,
        name: `${prefix}-load-${i}`,
        address: 'Ruta 9',
        latitude: -34,
        longitude: -58,
      })),
    });
    const shiftIds = siteIds.map(() => randomUUID());
    await db.shift.createMany({
      data: siteIds.map((siteId, i) => ({
        id: fixtureId(shiftIds, i),
        companyId: 'norte-company',
        siteId,
        createdById: adminId,
        startsAt: at('03:00:00'),
        endsAt: new Date('2026-11-01T03:00:00Z'),
        serviceDate: new Date('2026-10-01'),
        status: 'closed' as const,
      })),
    });
    const assignmentIds = siteIds.map(() => randomUUID());
    await db.shiftAssignment.createMany({
      data: shiftIds.map((shiftId, i) => ({
        id: fixtureId(assignmentIds, i),
        shiftId,
        guardId,
        assignedById: adminId,
        startsAt: at('03:00:00'),
        endsAt: new Date('2026-11-01T03:00:00Z'),
        active: false,
      })),
    });
    const incidents = siteIds.flatMap((siteId, i) =>
      Array.from({ length: 31 * 4 }, (_, j) => {
        const instant = new Date(Date.UTC(2026, 9, Math.floor(j / 4) + 1, 5 + (j % 4) * 4));
        return {
          companyId: 'norte-company',
          siteId,
          shiftId: fixtureId(shiftIds, i),
          assignmentId: fixtureId(assignmentIds, i),
          guardId,
          incidentId: randomUUID(),
          type: 'intrusion' as const,
          occurredAtDevice: instant,
          trustedAt: instant,
          receivedAt: instant,
          locationStatus: 'unverifiable' as const,
          simulation: 'not_simulated' as const,
        };
      }),
    );
    await db.incident.createMany({ data: incidents });
    await db.panicAlert.createMany({
      data: incidents.map((row) => ({
        id: randomUUID(),
        companyId: row.companyId,
        siteId: row.siteId,
        shiftId: row.shiftId,
        assignmentId: row.assignmentId,
        guardId,
        triggeredAt: row.occurredAtDevice,
        receivedAt: row.receivedAt,
        locationStatus: row.locationStatus,
        confirmedAt: new Date(row.receivedAt.getTime() + 60000),
        confirmedById: supervisorId,
      })),
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      for (const endpoint of ['incidentes', 'tiempos-de-respuesta', 'panico']) {
        const started = performance.now();
        const response = await get(endpoint).expect(200);
        const elapsedMs = performance.now() - started;
        expect(elapsedMs).toBeLessThan(3000);
        expect(response.body).toBeDefined();
        process.stdout.write(
          `HU-26 ${endpoint}: ${Math.round(elapsedMs)} ms (50 predios, 6200 incidentes y 6200 alertas)\n`,
        );
      }
    } finally {
      log.mockRestore();
    }
  }, 60000);
});
