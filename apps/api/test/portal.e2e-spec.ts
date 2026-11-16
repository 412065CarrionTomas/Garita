import { PlanChangeProcessor } from '../src/modules/subscriptions/plan-change.processor';
import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  portalSitesSchema,
  portalRoundsSchema,
  portalDaySchema,
  portalIncidentsSchema,
  portalPhotosSchema,
  portalEmergenciesSchema,
} from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { REALTIME_PORT } from '../src/common/ports/realtime.port';
import { PHOTO_STORAGE_PORT } from '../src/modules/incidents/photo-storage.port';

function requiredId(ids: string[], index: number) {
  const id = ids[index];
  if (!id) throw new Error('Falta un ID del fixture');
  return id;
}

describe('HU-28 portal del cliente por HTTP', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const prefix = `hu28-${randomUUID()}`;
  const auth = (uid = `${prefix}-client-0`) => ({ Authorization: `Bearer ${uid}` });
  const period = 'desde=2026-10-01&hasta=2026-11-01';
  const now = new Date('2026-11-01T12:00:00Z');
  const clientIds: string[] = [],
    userIds: string[] = [],
    siteIds: string[] = [];
  const roundIds: string[] = [],
    shiftIds: string[] = [],
    incidentIds: string[] = [];
  const secret = 'SECRETO_INTERNO_HU28';
  let adminId: string, guardId: string, supervisorId: string;
  let siteId: string, shiftId: string, assignmentId: string, roundId: string, reviewId: string;
  let visibleIncidentId: string, hiddenIncidentId: string, foreignIncidentId: string;
  const signedUrl = jest.fn(
    (id: string, size: string) =>
      `https://photos.invalid/${encodeURIComponent(id)}?size=${size}&signature=fake&expires=300`,
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (uid: string) => Promise.resolve({ uid }) })
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(NOTIFICATIONS_PORT)
      .useValue({ notifySiteStaff: jest.fn(), notifyUsers: jest.fn() })
      .overrideProvider(REALTIME_PORT)
      .useValue({ emitToSite: jest.fn() })
      .overrideProvider(PHOTO_STORAGE_PORT)
      .useValue({ signedUrl })
      .overrideProvider(PlanChangeProcessor)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    adminId = (await db.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-admin' } })).id;
    supervisorId = (
      await db.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-supervisor' } })
    ).id;
    guardId = (
      await db.user.create({
        data: {
          companyId: 'norte-company',
          firebaseUid: `${prefix}-guard`,
          email: `${prefix}-guard@example.invalid`,
          firstName: secret,
          lastName: 'VIGILADOR_RECONOCIBLE',
          role: 'guard',
          status: 'active',
        },
      })
    ).id;
    userIds.push(guardId);
    for (let index = 0; index < 3; index++) {
      const companyId = index === 2 ? 'sur-company' : 'norte-company';
      const client = await db.client.create({
        data: {
          companyId,
          name: `${prefix}-${index}`,
          contactName: 'Contacto',
          phone: '+541112345678',
          email: `${prefix}-${index}@example.invalid`,
        },
      });
      clientIds.push(client.id);
      const user = await db.user.create({
        data: {
          companyId,
          clientId: client.id,
          role: 'client',
          status: 'active',
          firstName: 'Cliente',
          lastName: 'Portal',
          firebaseUid: `${prefix}-client-${index}`,
          email: `${prefix}-client-${index}@example.invalid`,
        },
      });
      userIds.push(user.id);
      const site = await db.site.create({
        data: {
          companyId,
          clientId: client.id,
          name: index === 0 ? 'Depósito Ruta 9' : `${secret}-predio-${index}`,
          address: 'Ruta 9',
          latitude: -34,
          longitude: -58,
        },
      });
      siteIds.push(site.id);
    }
    siteId = requiredId(siteIds, 0);
    await db.siteSupervisor.create({
      data: { companyId: 'norte-company', siteId, userId: supervisorId },
    });
    roundId = (
      await db.round.create({
        data: { companyId: 'norte-company', siteId, name: `${secret}-ronda` },
      })
    ).id;
    roundIds.push(roundId);
    shiftId = (
      await db.shift.create({
        data: {
          companyId: 'norte-company',
          siteId,
          createdById: adminId,
          startsAt: new Date('2026-10-01T03:00:00Z'),
          endsAt: new Date('2026-10-02T03:00:00Z'),
          serviceDate: new Date('2026-10-01'),
          status: 'closed',
        },
      })
    ).id;
    shiftIds.push(shiftId);
    const assignment = await db.shiftAssignment.create({
      data: {
        shiftId,
        guardId,
        assignedById: adminId,
        startsAt: new Date('2026-10-01T03:00:00Z'),
        endsAt: new Date('2026-10-02T03:00:00Z'),
        active: false,
        result: 'absent',
      },
    });
    assignmentId = assignment.id;
    await db.shiftAssignment.create({
      data: {
        shiftId,
        guardId: null,
        assignedById: adminId,
        startsAt: new Date('2026-10-01T12:00:00Z'),
        endsAt: new Date('2026-10-02T03:00:00Z'),
        active: false,
        result: 'replaced',
      },
    });
    for (let index = 0; index < 26; index++) {
      const status =
        index < 17
          ? 'complete'
          : index === 17
            ? 'complete_late'
            : index === 18
              ? 'incomplete'
              : index === 19
                ? 'not_done'
                : index < 22
                  ? 'in_review'
                  : index === 22
                    ? 'pending_sync'
                    : index === 23
                      ? 'pending'
                      : index === 24
                        ? 'in_progress'
                        : 'late';
      const window = await db.roundWindowState.create({
        data: {
          companyId: 'norte-company',
          shiftId,
          roundId,
          windowIndex: index,
          startsAt: new Date('2026-10-01T04:00:00Z'),
          endsAt: new Date('2026-10-01T05:00:00Z'),
          graceEndsAt: new Date('2026-10-01T05:15:00Z'),
          expectedCount: 1,
          recordedCount: index < 18 ? 1 : 0,
          status,
          severityLevel: index === 16 ? 'grave' : null,
        },
      });
      if (index === 20) reviewId = window.id;
    }
    const checkpoint = await db.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId,
        name: `${secret}-punto`,
        latitude: -34,
        longitude: -58,
      },
    });
    const record = await db.checkpointRecord.create({
      data: {
        companyId: 'norte-company',
        shiftId,
        assignmentId,
        checkpointId: checkpoint.id,
        recordId: randomUUID(),
        method: 'qr',
        occurredAtDevice: new Date('2026-10-01T04:10:00Z'),
        locationStatus: 'ok',
        simulation: 'not_simulated',
        phoneNfc: 'unsupported',
        countedFor: [{ roundId, windowIndex: 16 }],
        requestHash: secret,
      },
    });
    await db.recordFlag.create({
      data: {
        companyId: 'norte-company',
        shiftId,
        checkpointRecordId: record.id,
        type: 'out_of_range',
        severity: 'grave',
        reason: `${secret}-marca-grave`,
      },
    });
    const unassigned = await db.shift.create({
      data: {
        companyId: 'norte-company',
        siteId,
        createdById: adminId,
        status: 'unassigned',
        startsAt: new Date('2026-10-03T03:00:00Z'),
        endsAt: new Date('2026-10-03T04:00:00Z'),
        serviceDate: new Date('2026-10-03'),
      },
    });
    shiftIds.push(unassigned.id);
    // Sin ventanas evaluadas, no debe revelar ni el turno ni el motivo de falta de cobertura.
    for (const classificationStatus of ['client_visible', 'pending', 'internal'] as const) {
      const incident = await db.incident.create({
        data: {
          companyId: 'norte-company',
          siteId,
          shiftId,
          assignmentId,
          guardId,
          incidentId: randomUUID(),
          type: 'intrusion',
          description: `${secret}-descripcion-${classificationStatus}`,
          classificationStatus,
          occurredAtDevice: new Date('2026-09-01T10:00:00Z'),
          trustedAt: new Date('2026-10-02T10:00:00Z'),
          locationStatus: 'ok',
          simulation: 'not_simulated',
        },
      });
      incidentIds.push(incident.id);
      if (classificationStatus === 'client_visible') {
        visibleIncidentId = incident.id;
        for (const [index, clientNote] of ['Nota anterior', 'Portón reparado'].entries())
          await db.incidentClassification.create({
            data: {
              companyId: 'norte-company',
              incidentId: incident.id,
              classification: 'client_visible',
              decidedById: supervisorId,
              internalComment: `${secret}-comentario`,
              clientNote,
              decidedAt: new Date(Date.UTC(2026, 9, 3, index)),
            },
          });
        await db.incidentPhoto.create({
          data: {
            incidentId: incident.id,
            cloudinaryPublicId: `${prefix}/photo`,
            width: 100,
            height: 100,
            bytes: 1000,
          },
        });
      } else hiddenIncidentId = incident.id;
    }
    // Un incidente visible del segundo cliente, aun dentro de la misma empresa, no debe aparecer.
    foreignIncidentId = (
      await db.incident.create({
        data: {
          companyId: 'norte-company',
          siteId: requiredId(siteIds, 1),
          shiftId,
          assignmentId,
          guardId,
          incidentId: randomUUID(),
          type: 'other',
          description: `${secret}-otro-cliente`,
          classificationStatus: 'client_visible',
          occurredAtDevice: new Date('2026-10-02T10:00:00Z'),
          locationStatus: 'ok',
          simulation: 'not_simulated',
        },
      })
    ).id;
    incidentIds.push(foreignIncidentId);
    for (const outcome of ['real_emergency', 'false_alarm', 'test', null] as const) {
      await db.panicAlert.create({
        data: {
          id: randomUUID(),
          companyId: 'norte-company',
          siteId,
          shiftId,
          assignmentId,
          guardId,
          status: outcome ? 'resolved' : 'active',
          outcome,
          triggeredAt: new Date('2026-10-02T10:00:00Z'),
          receivedAt: new Date('2026-10-02T10:00:01Z'),
          confirmedAt: outcome ? new Date('2026-10-02T10:00:45Z') : null,
          resolvedAt: outcome ? new Date('2026-10-02T10:05:00Z') : null,
          confirmedById: outcome ? supervisorId : null,
          resolvedById: outcome ? supervisorId : null,
          resolutionComment: `${secret}-${outcome}`,
          locationStatus: 'ok',
        },
      });
    }
  }, 60000);

  afterAll(async () => {
    await db.roundReviewDecision.deleteMany({
      where: { windowState: { shiftId: { in: shiftIds } } },
    });
    await db.recordFlag.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await db.incident.deleteMany({ where: { id: { in: incidentIds } } });
    await db.panicAlert.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await db.checkpointRecord.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await db.shift.deleteMany({ where: { id: { in: shiftIds } } });
    await db.round.deleteMany({ where: { id: { in: roundIds } } });
    await db.checkpoint.deleteMany({ where: { siteId: { in: siteIds } } });
    await db.siteSupervisor.deleteMany({ where: { siteId: { in: siteIds } } });
    await db.site.deleteMany({ where: { id: { in: siteIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.client.deleteMany({ where: { id: { in: clientIds } } });
    await app.close();
  });
  const get = (path: string, uid?: string) =>
    request(app.getHttpServer()).get(`/api/v1/portal/${path}`).set(auth(uid));

  it('CA1: 90% con dos en verificación aparte, detalle sin demora y predios propios', async () => {
    expect(portalSitesSchema.parse((await get('predios').expect(200)).body)).toEqual([
      { id: siteId, name: 'Depósito Ruta 9' },
    ]);
    const report = portalRoundsSchema.parse((await get(`rondas?${period}`).expect(200)).body);
    expect(report.totals).toEqual({
      completa: 18,
      incompleta: 1,
      no_realizada: 1,
      en_verificacion: 2,
      evaluated: 20,
      percentage: 90,
    });
    const day = portalDaySchema.parse(
      (await get(`rondas/dia?fecha=2026-10-01&pageSize=100`).expect(200)).body,
    );
    expect(day.total).toBe(22);
    expect(day.items.filter((row) => row.status === 'completa')).toHaveLength(18);
    expect(day.items.filter((row) => row.status === 'en_verificacion')).toHaveLength(2);
    expect(portalRoundsSchema.parse((await get('rondas').expect(200)).body)).toMatchObject({
      desde: '2026-10-01',
      hasta: '2026-11-01',
    });
  });
  it('CA3 y CA4: última nota, hora confiable, fotos firmadas y solo emergencias reales', async () => {
    const incidents = portalIncidentsSchema.parse(
      (await get(`incidentes?${period}`).expect(200)).body,
    );
    expect(incidents).toMatchObject({
      total: 1,
      items: [
        {
          id: visibleIncidentId,
          clientNote: 'Portón reparado',
          photoCount: 1,
          occurredAt: '2026-10-02T10:00:00.000Z',
        },
      ],
    });
    const photos = portalPhotosSchema.parse(
      (await get(`incidentes/${visibleIncidentId}/fotos`).expect(200)).body,
    );
    expect(photos).toHaveLength(1);
    expect(photos[0]?.fullUrl).toContain('signature=fake');
    expect(signedUrl).toHaveBeenCalledWith(`${prefix}/photo`, 'thumbnail');
    expect(signedUrl).toHaveBeenCalledWith(`${prefix}/photo`, 'full');
    expect(
      portalIncidentsSchema.parse(
        (await get(`incidentes?${period}&page=2&pageSize=1`).expect(200)).body,
      ).items,
    ).toEqual([]);
    expect(
      portalEmergenciesSchema.parse((await get(`emergencias?${period}`).expect(200)).body),
    ).toMatchObject({ total: 1, items: [{ responseTimeMs: 45000 }] });
  });
  it('CA5: recorre TODAS las respuestas del portal y no encuentra datos trampa ni claves internas', async () => {
    const paths = [
      'predios',
      `rondas?${period}`,
      'rondas/dia?fecha=2026-10-01&pageSize=100',
      `incidentes?${period}`,
      `incidentes/${visibleIncidentId}/fotos`,
      `emergencias?${period}`,
    ];
    for (const path of paths) {
      const response = await get(path).expect(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const text = JSON.stringify(response.body);
      for (const forbidden of [
        secret,
        guardId,
        assignmentId,
        shiftId,
        roundId,
        reviewId,
        hiddenIncidentId,
        foreignIncidentId,
        ...siteIds.slice(1),
        ...shiftIds.slice(1),
        'VIGILADOR_RECONOCIBLE',
        'severity',
        'description',
        'internalComment',
        'guardId',
        'shiftId',
        'assignmentId',
        'complete_late',
        'pending_sync',
        'in_progress',
        'absent',
        'replaced',
        'false_alarm',
        'real_emergency',
        'resolutionComment',
        'confirmedBy',
        'sin vigilador',
        'Nota anterior',
      ])
        expect(text).not.toContain(forbidden);
    }
  });
  it('CA2: una revisión resuelta por HTTP actualiza la siguiente consulta', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/ventanas-ronda/${reviewId}/validar`)
      .set(auth('seed-norte-supervisor'))
      .send({ comment: `${secret}-revision` })
      .expect(201);
    const after = portalRoundsSchema.parse((await get(`rondas?${period}`).expect(200)).body);
    expect(after.totals).toMatchObject({ completa: 19, evaluated: 21, en_verificacion: 1 });
    expect(after.totals.percentage).toBeCloseTo((19 / 21) * 100);
    expect(JSON.stringify(after)).not.toContain(secret);
  });
  it('CA6: 404 para otro cliente, otra empresa, inexistentes y fotos no visibles', async () => {
    for (const site of [requiredId(siteIds, 1), requiredId(siteIds, 2), 'nonexistent'])
      for (const endpoint of ['rondas', 'incidentes', 'emergencias', 'rondas/dia?fecha=2026-10-01'])
        await get(`${endpoint}${endpoint.includes('?') ? '&' : '?'}predio=${site}`).expect(404);
    for (const id of [hiddenIncidentId, foreignIncidentId, 'nonexistent'])
      await get(`incidentes/${id}/fotos`).expect(404);
    for (const uid of [`${prefix}-client-1`, `${prefix}-client-2`]) {
      await get(`rondas?predio=${siteId}`, uid).expect(404);
      await get(`incidentes/${visibleIncidentId}/fotos`, uid).expect(404);
      expect(
        portalIncidentsSchema
          .parse((await get(`incidentes?${period}`, uid).expect(200)).body)
          .items.every((incident) => incident.id !== visibleIncidentId),
      ).toBe(true);
    }
  });
  it('excluye predios y clientes inactivos, incluso en fotos, y falla cerrado sin clientId', async () => {
    await db.site.update({ where: { id: siteId }, data: { status: 'inactive' } });
    try {
      expect((await get('predios').expect(200)).body).toEqual([]);
      await get(`rondas?predio=${siteId}`).expect(404);
      await get(`incidentes/${visibleIncidentId}/fotos`).expect(404);
      expect(
        portalIncidentsSchema.parse((await get(`incidentes?${period}`).expect(200)).body).total,
      ).toBe(0);
    } finally {
      await db.site.update({ where: { id: siteId }, data: { status: 'active' } });
    }
    const clientUserId = requiredId(userIds, 1);
    await db.user.update({ where: { id: clientUserId }, data: { clientId: null } });
    try {
      await get('predios').expect(403);
    } finally {
      await db.user.update({
        where: { id: clientUserId },
        data: { clientId: requiredId(clientIds, 0) },
      });
    }
    await db.client.update({
      where: { id: requiredId(clientIds, 0) },
      data: { status: 'inactive' },
    });
    try {
      await get('predios').expect(403);
    } finally {
      await db.client.update({
        where: { id: requiredId(clientIds, 0) },
        data: { status: 'active' },
      });
    }
  });
  it('rechaza períodos inválidos, parámetros inyectados y paginación fuera de rango', async () => {
    for (const endpoint of ['rondas', 'incidentes', 'emergencias']) {
      await get(`${endpoint}?desde=2025-10-01&hasta=2026-11-01`).expect(400);
      await get(`${endpoint}?desde=2026-10-01`).expect(400);
      await get(`${endpoint}?cliente=${clientIds[1]}`).expect(400);
    }
    await get('incidentes?pageSize=101').expect(400);
    await get('rondas/dia?fecha=2026-02-30').expect(400);
  });
  it('último mes en menos de 3 s con diez predios, 31 días y 12 ventanas diarias', async () => {
    for (let index = 0; index < 10; index++) {
      const site = await db.site.create({
        data: {
          companyId: 'norte-company',
          clientId: requiredId(clientIds, 0),
          name: `${prefix}-perf-${index}`,
          address: 'Ruta 9',
          latitude: -34,
          longitude: -58,
        },
      });
      siteIds.push(site.id);
      const round = await db.round.create({
        data: { companyId: 'norte-company', siteId: site.id, name: 'Ronda' },
      });
      roundIds.push(round.id);
      const shift = await db.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: site.id,
          createdById: adminId,
          startsAt: new Date('2026-10-01T03:00:00Z'),
          endsAt: new Date('2026-11-01T03:00:00Z'),
          serviceDate: new Date('2026-10-01'),
          status: 'closed',
        },
      });
      shiftIds.push(shift.id);
      await db.roundWindowState.createMany({
        data: Array.from({ length: 31 * 12 }, (_, i) => ({
          companyId: 'norte-company',
          shiftId: shift.id,
          roundId: round.id,
          windowIndex: i,
          startsAt: new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 12), 3 + (i % 12))),
          endsAt: new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 12), 4 + (i % 12))),
          graceEndsAt: new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 12), 4 + (i % 12))),
          expectedCount: 1,
          recordedCount: 1,
          status: 'complete',
        })),
      });
    }
    const log = jest.spyOn(Logger.prototype, 'log');
    try {
      const started = performance.now();
      const report = portalRoundsSchema.parse((await get('rondas').expect(200)).body);
      const elapsedMs = performance.now() - started;
      expect(report.totals.completa).toBe(3739);
      expect(elapsedMs).toBeLessThan(3000);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.query',
          clientId: clientIds[0],
          userId: userIds[1],
          desde: '2026-10-01',
          hasta: '2026-11-01',
        }),
      );
      process.stdout.write(
        `HU-28 último mes: ${elapsedMs.toFixed(1)} ms, 10 predios adicionales / 3720 ventanas\n`,
      );
    } finally {
      log.mockRestore();
    }
  }, 60000);
});
