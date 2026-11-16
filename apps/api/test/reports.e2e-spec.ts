import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  reportResponseSchema,
  reportDetailResponseSchema,
  reportPendingResponseSchema,
  reportPointsResponseSchema,
  siteResponseSchema,
} from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { REALTIME_PORT } from '../src/common/ports/realtime.port';

describe('HU-25 cumplimiento por HTTP', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const prefix = `hu25-${randomUUID()}`;
  const auth = (uid = 'seed-norte-admin') => ({ Authorization: `Bearer ${uid}` });
  const period = 'desde=2026-10-01&hasta=2026-11-01';
  const now = new Date('2026-11-01T12:00:00Z');
  let adminId: string;
  let guardId: string;
  let supervisorId: string;
  let clientId: string;
  let hiddenClientId: string;
  let siteId: string;
  let hiddenSiteId: string;
  let shiftId: string;
  let assignmentId: string;
  let roundId: string;
  let checkpointId: string;
  let validRecordId: string;
  const ids: string[] = [];
  const siteIds: string[] = [];
  const roundIds: string[] = [];
  const extraUsers: string[] = [];
  const notifications = {
    notifySiteStaff: jest.fn(() => Promise.resolve()),
    notifyUsers: jest.fn(() => Promise.resolve()),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (uid: string) => Promise.resolve({ uid }) })
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(NOTIFICATIONS_PORT)
      .useValue(notifications)
      .overrideProvider(REALTIME_PORT)
      .useValue({ emitToSite: jest.fn() })
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
    clientId = (
      await db.client.create({
        data: {
          companyId: 'norte-company',
          name: prefix,
          contactName: 'Ana',
          phone: '+541112345678',
          email: `${prefix}@example.invalid`,
        },
      })
    ).id;
    for (const name of ['Depósito Ruta 9', 'Planta Norte']) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/predios')
        .set(auth())
        .send({
          clientId,
          name: `${prefix}-${name}`,
          address: 'Ruta 9',
          latitude: -34,
          longitude: -58,
        })
        .expect(201);
      siteIds.push(siteResponseSchema.parse(response.body).id);
    }
    const [visibleSite, hiddenSite] = siteIds;
    if (!visibleSite || !hiddenSite) throw new Error('Faltan predios del fixture');
    siteId = visibleSite;
    hiddenSiteId = hiddenSite;
    hiddenClientId = (
      await db.client.create({
        data: {
          companyId: 'norte-company',
          name: `${prefix}-hidden`,
          contactName: 'Ana',
          phone: '+541112345678',
          email: `${prefix}-hidden@example.invalid`,
        },
      })
    ).id;
    await db.site.update({ where: { id: hiddenSiteId }, data: { clientId: hiddenClientId } });
    await request(app.getHttpServer())
      .put(`/api/v1/predios/${siteId}/supervisores`)
      .set(auth())
      .send({ supervisorIds: [supervisorId] })
      .expect(200);
    // Fixtures de estados evaluados; las lecturas y decisiones que se verifican atraviesan HTTP y el guard real.
    const round = await db.round.create({
      data: { companyId: 'norte-company', siteId, name: prefix },
    });
    roundId = round.id;
    roundIds.push(roundId);
    const shift = await db.shift.create({
      data: {
        companyId: 'norte-company',
        siteId,
        createdById: adminId,
        startsAt: new Date('2026-10-01T03:00:00Z'),
        endsAt: new Date('2026-10-02T03:00:00Z'),
        serviceDate: new Date('2026-10-01'),
        status: 'closed',
      },
    });
    shiftId = shift.id;
    ids.push(shiftId);
    assignmentId = (
      await db.shiftAssignment.create({
        data: {
          shiftId,
          guardId,
          assignedById: adminId,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          active: false,
          result: 'absent',
        },
      })
    ).id;
    checkpointId = (
      await db.checkpoint.create({
        data: {
          companyId: 'norte-company',
          siteId,
          name: 'Galpón 3',
          latitude: -34,
          longitude: -58,
          toleranceRadiusMeters: 50,
        },
      })
    ).id;
    const secondPoint = await db.checkpoint.create({
      data: { companyId: 'norte-company', siteId, name: 'Portón', latitude: -34, longitude: -58 },
    });
    await db.roundWindowState.createMany({
      data: Array.from({ length: 22 }, (_, index) => ({
        companyId: 'norte-company',
        shiftId,
        roundId,
        windowIndex: index,
        startsAt: new Date(Date.UTC(2026, 9, 1, 3 + index)),
        endsAt: new Date(Date.UTC(2026, 9, 1, 4 + index)),
        graceEndsAt: new Date('2026-10-02T00:15:00Z'),
        expectedCount: 2,
        recordedCount: index < 18 || index >= 20 ? 2 : index === 18 ? 1 : 0,
        status:
          index < 18
            ? 'complete'
            : index === 18
              ? 'incomplete'
              : index === 19
                ? 'not_done'
                : 'in_review',
        inReviewSince: index >= 20 ? new Date('2026-10-02T00:00:00Z') : null,
      })),
    });
    // Un turno con registros tuvo inicio y sincronizó: la revisión evalúa con esa cobertura.
    await db.shiftEvent.create({
      data: {
        companyId: 'norte-company',
        shiftId,
        assignmentId,
        type: 'start',
        occurredAt: shift.startsAt,
      },
    });
    await db.shiftSyncState.create({
      data: {
        companyId: 'norte-company',
        shiftId,
        lastContactAt: shift.endsAt,
        lastPendingCount: 0,
        syncedUntil: shift.endsAt,
      },
    });
    // El primer segmento empieza después de la asignación, para probar el dueño de una ausencia.
    await db.shiftAssignment.update({
      where: { id: assignmentId },
      data: { startsAt: new Date('2026-09-30T20:00:00Z') },
    });
    for (let index = 0; index < 2; index++) {
      const record = await db.checkpointRecord.create({
        data: {
          companyId: 'norte-company',
          shiftId,
          assignmentId,
          checkpointId: index === 0 ? checkpointId : secondPoint.id,
          recordId: randomUUID(),
          method: 'qr',
          occurredAtDevice: new Date('2026-10-01T03:10:00Z'),
          locationStatus: 'ok',
          simulation: 'not_simulated',
          phoneNfc: 'unsupported',
          countedFor: [{ roundId, windowIndex: 0 }],
          requestHash: prefix,
        },
      });
      if (index === 0) validRecordId = record.id;
    }
    await db.incident.create({
      data: {
        companyId: 'norte-company',
        siteId,
        shiftId,
        assignmentId,
        guardId,
        incidentId: randomUUID(),
        type: 'other',
        occurredAtDevice: now,
        locationStatus: 'ok',
        simulation: 'not_simulated',
        createdAt: new Date('2026-10-03T00:00:00Z'),
      },
    });
    await db.notice.create({
      data: {
        companyId: 'norte-company',
        siteId,
        shiftId,
        subjectId: shiftId,
        key: `shift_unsynced:${shiftId}`,
        kind: 'shift_unsynced',
        createdAt: new Date('2026-10-04T00:00:00Z'),
      },
    });
    const future = await db.shift.create({
      data: {
        companyId: 'norte-company',
        siteId,
        createdById: adminId,
        startsAt: new Date('2026-11-02T12:00:00Z'),
        endsAt: new Date('2026-11-02T16:00:00Z'),
        serviceDate: new Date('2026-11-02'),
        status: 'unassigned',
      },
    });
    ids.push(future.id);
  }, 60_000);
  afterAll(async () => {
    await db.roundReviewDecision.deleteMany({ where: { windowState: { shiftId: { in: ids } } } });
    await db.recordFlag.deleteMany({ where: { shiftId: { in: ids } } });
    await db.incident.deleteMany({ where: { shiftId: { in: ids } } });
    await db.checkpointRecord.deleteMany({ where: { shiftId: { in: ids } } });
    await db.shift.deleteMany({ where: { id: { in: ids } } });
    await db.round.deleteMany({ where: { id: { in: roundIds } } });
    await db.checkpoint.deleteMany({ where: { siteId: { in: siteIds } } });
    await db.siteSupervisor.deleteMany({ where: { siteId: { in: siteIds } } });
    await db.site.deleteMany({ where: { id: { in: siteIds } } });
    await db.client.deleteMany({ where: { id: { in: [clientId, hiddenClientId] } } });
    await db.user.deleteMany({ where: { id: { in: extraUsers } } });
    await app.close();
  });
  const report = async (uid = 'seed-norte-admin') =>
    reportResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/reportes/rondas?${period}&predio=${siteId}`)
          .set(auth(uid))
          .expect(200)
      ).body,
    );

  it('CA1, CA3 y CA4: 90%, agrupaciones históricas y detalle paginado accesible al supervisor', async () => {
    const result = await report('seed-norte-supervisor');
    expect(result.totals).toMatchObject({
      percentage: 90,
      complete: 18,
      evaluated: 20,
      in_review: 2,
    });
    expect(result.byGuard.find((guard) => guard.id === guardId)?.totals.not_done).toBe(1);
    expect(result.daily.length).toBeGreaterThan(0);
    expect(result.bySite[0]?.id).toBe(siteId);
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/reportes/rondas/detalle?${period}&predio=${siteId}&estado=complete&pageSize=5&page=2`,
      )
      .set(auth('seed-norte-supervisor'))
      .expect(200);
    const detail = reportDetailResponseSchema.parse(response.body);
    expect(detail).toMatchObject({ total: 18, page: 2, pageSize: 5 });
    expect(detail.items).toHaveLength(5);
    expect(detail.items[0]?.shiftId).toBe(shiftId);
  });
  it('CA2 y BDD2: invalidar un registro y validar una revisión cambia la consulta siguiente', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/registros-puntos/${validRecordId}/invalidar`)
      .set(auth('seed-norte-supervisor'))
      .send({ comment: 'Registro verificado como inválido' })
      .expect(201);
    expect((await report()).totals).toMatchObject({ complete: 17, incomplete: 2, percentage: 85 });
    await request(app.getHttpServer())
      .post(`/api/v1/registros-puntos/${validRecordId}/restituir`)
      .set(auth())
      .send({ comment: 'Restituir después de verificar' })
      .expect(201);
    expect((await report()).totals.percentage).toBe(90);
    const review = await db.roundWindowState.findFirstOrThrow({
      where: { shiftId, status: 'in_review' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/ventanas-ronda/${review.id}/validar`)
      .set(auth('seed-norte-supervisor'))
      .send({ comment: 'Recorrido confirmado por cámaras' })
      .expect(201);
    expect((await report()).totals).toMatchObject({ complete: 19, evaluated: 21, in_review: 1 });
  });
  it('CA5: cuenta pendientes y devuelve el más antiguo y el futuro más próximo', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reportes/pendientes?predio=${siteId}`)
      .set(auth('seed-norte-supervisor'))
      .expect(200);
    expect(reportPendingResponseSchema.parse(response.body)).toMatchObject({
      inReview: { count: 1, oldestAt: '2026-10-02T00:00:00.000Z' },
      incidents: { count: 1, oldestAt: '2026-10-03T00:00:00.000Z' },
      unsynced: { count: 1, oldestAt: '2026-10-04T00:00:00.000Z' },
      unassigned: { count: 1, nextAt: '2026-11-02T12:00:00.000Z' },
    });
  });
  it('atribuye al vigilador desactivado y deja las ventanas sin dueño en un grupo separado', async () => {
    const deactivated = await db.user.create({
      data: {
        companyId: 'norte-company',
        firebaseUid: `${prefix}-deactivated`,
        email: `${prefix}-deactivated@example.invalid`,
        firstName: 'Pedro',
        lastName: 'Desactivado',
        role: 'guard',
        status: 'deactivated',
      },
    });
    extraUsers.push(deactivated.id);
    await db.shiftAssignment.update({
      where: { id: assignmentId },
      data: { guardId: deactivated.id },
    });
    expect((await report()).byGuard).toMatchObject([{ id: deactivated.id, deactivated: true }]);
    await db.shiftAssignment.update({ where: { id: assignmentId }, data: { guardId: null } });
    expect((await report()).byGuard).toMatchObject([
      { id: null, name: 'Sin vigilador', totals: { evaluated: 21 } },
    ]);
    await db.shiftAssignment.update({ where: { id: assignmentId }, data: { guardId } });
  });
  it('BDD3: Galpón 3 con marcas de cuatro vigiladores, excluye invalidaciones y no duplica por marca', async () => {
    for (let index = 0; index < 4; index++) {
      const guard = await db.user.create({
        data: {
          companyId: 'norte-company',
          firebaseUid: `${prefix}-${index}`,
          email: `${prefix}-${index}@example.invalid`,
          firstName: 'Guardia',
          lastName: `${index}`,
          role: 'guard',
          status: index === 3 ? 'deactivated' : 'active',
        },
      });
      extraUsers.push(guard.id);
      const assignment = await db.shiftAssignment.create({
        data: {
          shiftId,
          guardId: guard.id,
          assignedById: adminId,
          startsAt: new Date('2026-10-01T03:00:00Z'),
          endsAt: new Date('2026-10-02T03:00:00Z'),
          active: false,
          isCurrent: false,
          result: 'replaced',
        },
      });
      const record = await db.checkpointRecord.create({
        data: {
          companyId: 'norte-company',
          shiftId,
          assignmentId: assignment.id,
          checkpointId,
          recordId: randomUUID(),
          method: 'qr',
          occurredAtDevice: new Date('2026-10-01T03:10:00Z'),
          locationStatus: 'ok',
          simulation: 'not_simulated',
          phoneNfc: 'unsupported',
          countedFor: [],
          requestHash: prefix,
        },
      });
      await db.recordFlag.createMany({
        data: ['out_of_range', 'location_unverifiable'].map((type) => ({
          companyId: 'norte-company',
          shiftId,
          checkpointRecordId: record.id,
          type: type as 'out_of_range' | 'location_unverifiable',
          severity: 'media' as const,
        })),
      });
    }
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reportes/puntos-marcas-frecuentes?${period}&predio=${siteId}`)
      .set(auth('seed-norte-supervisor'))
      .expect(200);
    expect(reportPointsResponseSchema.parse(response.body).items).toMatchObject([
      {
        name: 'Galpón 3',
        validRecords: 5,
        markedRecords: 4,
        guardCount: 4,
        distribution: 'distributed',
      },
    ]);
    const marked = await db.checkpointRecord.findFirstOrThrow({
      where: { checkpointId, flags: { some: {} } },
    });
    await db.checkpointRecord.update({ where: { id: marked.id }, data: { invalidatedAt: now } });
    const next = await request(app.getHttpServer())
      .get(`/api/v1/reportes/puntos-marcas-frecuentes?${period}&predio=${siteId}`)
      .set(auth())
      .expect(200);
    expect(reportPointsResponseSchema.parse(next.body).items[0]).toMatchObject({
      validRecords: 4,
      markedRecords: 3,
      guardCount: 3,
    });
  });
  it('CA6: filtro de cliente/predio, sin filtro solo predios asignados, períodos y roles', async () => {
    for (const path of ['rondas', 'rondas/detalle', 'pendientes', 'puntos-marcas-frecuentes']) {
      await request(app.getHttpServer()).get(`/api/v1/reportes/${path}`).expect(401);
      for (const role of ['guard', 'client'])
        await request(app.getHttpServer())
          .get(`/api/v1/reportes/${path}`)
          .set(auth(`seed-norte-${role}`))
          .expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/reportes/${path}?predio=${hiddenSiteId}`)
        .set(auth('seed-norte-supervisor'))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/v1/reportes/${path}?predio=${siteId}`)
        .set(auth('seed-sur-admin'))
        .expect(404);
    }
    for (const range of ['desde=2025-09-01&hasta=2026-10-01', 'desde=2026-11-01&hasta=2026-10-01'])
      await request(app.getHttpServer())
        .get(`/api/v1/reportes/rondas?${range}`)
        .set(auth())
        .expect(400);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reportes/rondas?${period}&cliente=${clientId}`)
      .set(auth('seed-norte-supervisor'))
      .expect(200);
    expect(
      reportResponseSchema
        .parse(response.body)
        .filters.sites.some((site) => site.id === hiddenSiteId),
    ).toBe(false);
    await request(app.getHttpServer())
      .get(`/api/v1/reportes/rondas?cliente=${clientId}`)
      .set(auth('seed-sur-admin'))
      .expect(404);
    for (const endpoint of ['rondas', 'rondas/detalle'])
      await request(app.getHttpServer())
        .get(`/api/v1/reportes/${endpoint}?cliente=${hiddenClientId}`)
        .set(auth('seed-norte-supervisor'))
        .expect(404);
    const logger = jest.spyOn(Logger.prototype, 'log');
    await report();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reports.query',
        userId: adminId,
        role: 'admin',
        siteIds: [siteId],
        elapsedMs: expect.any(Number) as unknown,
      }),
    );
    logger.mockRestore();
  });
  it('50 predios con un mes de ventanas: respuesta mensual en menos de tres segundos', async () => {
    const sites = Array.from({ length: 50 }, (_, index) => ({
      id: `${prefix}-perf-site-${index}`,
      companyId: 'norte-company',
      clientId,
      name: `${prefix}-${index}`,
      address: 'Ruta 9',
      latitude: -34,
      longitude: -58,
    }));
    siteIds.push(...sites.map((site) => site.id));
    await db.site.createMany({ data: sites });
    const shifts = sites.map((site, index) => ({
      id: `${prefix}-perf-shift-${index}`,
      companyId: 'norte-company',
      siteId: site.id,
      createdById: adminId,
      startsAt: new Date('2026-10-01T03:00:00Z'),
      endsAt: new Date('2026-11-01T03:00:00Z'),
      serviceDate: new Date('2026-10-01'),
      status: 'closed' as const,
    }));
    ids.push(...shifts.map((shift) => shift.id));
    await db.shift.createMany({ data: shifts });
    const rounds = sites.map((site, index) => ({
      id: `${prefix}-perf-round-${index}`,
      companyId: 'norte-company',
      siteId: site.id,
      name: prefix,
    }));
    roundIds.push(...rounds.map((round) => round.id));
    await db.round.createMany({ data: rounds });
    await db.shiftAssignment.createMany({
      data: shifts.map((shift) => ({
        shiftId: shift.id,
        guardId,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        assignedById: adminId,
        active: false,
        result: 'started' as const,
      })),
    });
    const windows = shifts.flatMap((shift, siteIndex) =>
      Array.from({ length: 31 * 12 }, (_, index) => {
        const start = new Date(Date.UTC(2026, 9, 1, 3 + index * 2));
        const end = new Date(start.getTime() + 7200_000);
        return {
          companyId: 'norte-company',
          shiftId: shift.id,
          roundId: `${prefix}-perf-round-${siteIndex}`,
          windowIndex: index,
          startsAt: start,
          endsAt: end,
          graceEndsAt: end,
          expectedCount: 1,
          recordedCount: 1,
          status: 'complete' as const,
        };
      }),
    );
    for (let offset = 0; offset < windows.length; offset += 1000)
      await db.roundWindowState.createMany({ data: windows.slice(offset, offset + 1000) });
    const started = performance.now();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reportes/rondas?${period}&cliente=${clientId}`)
      .set(auth())
      .expect(200);
    const elapsedMs = performance.now() - started;
    const result = reportResponseSchema.parse(response.body);
    expect(result.bySite).toHaveLength(51);
    expect(result.totals.evaluated).toBeGreaterThanOrEqual(50 * 31 * 12);
    expect(elapsedMs).toBeLessThan(3000);
  }, 60_000);
});
