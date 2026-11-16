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
  portalEmergenciesSchema,
  portalPhotosSchema,
} from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { TenantContext } from '../src/modules/auth/tenant-context';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { REALTIME_PORT } from '../src/common/ports/realtime.port';
import { PHOTO_STORAGE_PORT } from '../src/modules/incidents/photo-storage.port';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';
import { pdfPageTexts } from './pdf-text';

describe('HU-40 exportaciones PDF por HTTP', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  const prefix = `hu40-${randomUUID()}`;
  const companyId = `${prefix}-company`;
  const foreignCompanyId = `${prefix}-foreign-company`;
  const secret = 'TRAMPA_HU40_INTERNA';
  const period = 'desde=2026-08-01&hasta=2026-11-01';
  const now = new Date('2026-11-16T15:00:00Z');
  let siteId: string, hiddenSiteId: string, foreignSiteId: string;
  let clientId: string,
    otherClientId: string,
    clientUserId: string,
    adminId: string,
    supervisorId: string,
    guardId: string;
  let visibleIncidentId: string;
  const shiftIds: string[] = [];
  const auth = (role = 'admin') => ({ Authorization: `Bearer ${prefix}-${role}` });
  const get = (path: string, role = 'admin') =>
    request(app.getHttpServer()).get(`/api/v1/${path}`).set(auth(role));

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
      .useValue({ signedUrl: () => 'https://photos.invalid/hu40' })
      .overrideProvider(MercadoPagoClient)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.createMany({
      data: [
        { id: companyId, name: 'Empresa PDF propia', accountStatus: 'active' },
        { id: foreignCompanyId, name: 'EMPRESA_AJENA_HU40', accountStatus: 'active' },
      ],
    });
    const client = await db.client.create({
      data: {
        companyId,
        name: 'Cliente PDF propio',
        contactName: 'Contacto',
        phone: '+541112345678',
        email: `${prefix}@example.invalid`,
      },
    });
    clientId = client.id;
    otherClientId = (
      await db.client.create({
        data: {
          companyId,
          name: 'CLIENTE_AJENO_HU40',
          contactName: 'Contacto',
          phone: '+541112345678',
          email: `${prefix}-other@example.invalid`,
        },
      })
    ).id;
    const foreignClientId = (
      await db.client.create({
        data: {
          companyId: foreignCompanyId,
          name: 'CLIENTE_OTRA_EMPRESA_HU40',
          contactName: 'Contacto',
          phone: '+541112345678',
          email: `${prefix}-foreign@example.invalid`,
        },
      })
    ).id;
    for (const role of ['admin', 'supervisor', 'guard', 'client'] as const) {
      const user = await db.user.create({
        data: {
          companyId,
          firebaseUid: `${prefix}-${role}`,
          email: `${prefix}-${role}@example.invalid`,
          firstName: role === 'guard' ? secret : role,
          lastName: 'PDF',
          role,
          status: 'active',
          ...(role === 'client' ? { clientId } : {}),
        },
      });
      if (role === 'admin') adminId = user.id;
      if (role === 'supervisor') supervisorId = user.id;
      if (role === 'guard') guardId = user.id;
      if (role === 'client') clientUserId = user.id;
    }
    siteId = (
      await db.site.create({
        data: {
          companyId,
          clientId,
          name: 'Depósito PDF propio',
          address: 'Ruta 9',
          latitude: -34,
          longitude: -58,
        },
      })
    ).id;
    hiddenSiteId = (
      await db.site.create({
        data: {
          companyId,
          clientId: otherClientId,
          name: 'PREDIO_AJENO_HU40',
          address: 'Otro',
          latitude: -34,
          longitude: -58,
        },
      })
    ).id;
    foreignSiteId = (
      await db.site.create({
        data: {
          companyId: foreignCompanyId,
          clientId: foreignClientId,
          name: 'PREDIO_OTRA_EMPRESA_HU40',
          address: 'Otro',
          latitude: -34,
          longitude: -58,
        },
      })
    ).id;
    await db.siteSupervisor.create({ data: { companyId, siteId, userId: supervisorId } });
    const roundId = (
      await db.round.create({ data: { companyId, siteId, name: `${secret}_RONDA` } })
    ).id;
    const windows = [];
    for (let day = 0; day < 92; day++) {
      const startsAt = new Date(Date.UTC(2026, 7, day + 1, 3));
      const endsAt = new Date(startsAt.getTime() + 24 * 3600000);
      const shift = await db.shift.create({
        data: {
          companyId,
          siteId,
          createdById: adminId,
          startsAt,
          endsAt,
          serviceDate: new Date(Date.UTC(2026, 7, day + 1)),
          status: 'closed',
          assignments: {
            create: {
              guardId,
              assignedById: adminId,
              startsAt,
              endsAt,
              result: 'started',
              active: false,
            },
          },
        },
        include: { assignments: true },
      });
      shiftIds.push(shift.id);
      const assignmentId = shift.assignments[0]?.id;
      if (!assignmentId) throw new Error('Falta asignación del fixture');
      for (let windowIndex = 0; windowIndex < 12; windowIndex++) {
        const windowStart = new Date(startsAt.getTime() + windowIndex * 3600000);
        windows.push({
          companyId,
          shiftId: shift.id,
          roundId,
          windowIndex,
          startsAt: windowStart,
          endsAt: new Date(windowStart.getTime() + 1800000),
          graceEndsAt: new Date(windowStart.getTime() + 2700000),
          expectedCount: 1,
          recordedCount: 1,
          status:
            windowIndex === 0
              ? ('in_review' as const)
              : windowIndex === 1
                ? ('complete_late' as const)
                : ('complete' as const),
        });
      }
      const incident = await db.incident.create({
        data: {
          companyId,
          siteId,
          shiftId: shift.id,
          assignmentId,
          guardId,
          incidentId: randomUUID(),
          type: 'intrusion',
          description: `${secret}_DESCRIPCION`,
          classificationStatus: 'client_visible',
          occurredAtDevice: startsAt,
          trustedAt: startsAt,
          receivedAt: startsAt,
          locationStatus: 'ok',
          simulation: 'not_simulated',
          classifications: {
            create: {
              companyId,
              classification: 'client_visible',
              internalComment: `${secret}_COMENTARIO`,
              clientNote: day === 91 ? 'ULTIMA_NOTA_PERIODO' : 'Acceso reparado',
              decidedById: supervisorId,
              decidedAt: startsAt,
            },
          },
        },
      });
      visibleIncidentId = incident.id;
      await db.panicAlert.create({
        data: {
          id: randomUUID(),
          companyId,
          siteId,
          shiftId: shift.id,
          assignmentId,
          guardId,
          status: 'resolved',
          outcome: 'real_emergency',
          triggeredAt: startsAt,
          receivedAt: startsAt,
          confirmedAt: new Date(startsAt.getTime() + 45000),
          confirmedById: supervisorId,
          resolvedAt: new Date(startsAt.getTime() + 60000),
          resolvedById: supervisorId,
          resolutionComment: `${secret}_RESOLUCION`,
          locationStatus: 'ok',
        },
      });
      if (day === 0) {
        const checkpointId = (
          await db.checkpoint.create({
            data: { companyId, siteId, name: 'PUNTO_HU40', latitude: -34, longitude: -58 },
          })
        ).id;
        for (let index = 0; index < 3; index++) {
          await db.checkpointRecord.create({
            data: {
              companyId,
              shiftId: shift.id,
              assignmentId,
              checkpointId,
              recordId: randomUUID(),
              method: 'qr',
              occurredAtDevice: startsAt,
              trustedAt: startsAt,
              requestHash: `${prefix}-${index}`,
              locationStatus: 'ok',
              simulation: 'not_simulated',
              phoneNfc: 'on',
              countedFor: [],
              flags: {
                create: {
                  companyId,
                  shiftId: shift.id,
                  type: 'out_of_range',
                  severity: 'grave',
                  reason: `${secret}_MARCA`,
                },
              },
            },
          });
        }
        await db.incident.createMany({
          data: ['internal', 'pending'].map((classificationStatus) => ({
            companyId,
            siteId,
            shiftId: shift.id,
            assignmentId,
            guardId,
            incidentId: randomUUID(),
            type: 'other' as const,
            description: `${secret}_INCIDENTE`,
            classificationStatus: classificationStatus as 'internal' | 'pending',
            occurredAtDevice: startsAt,
            locationStatus: 'ok' as const,
            simulation: 'not_simulated' as const,
          })),
        });
        await db.panicAlert.create({
          data: {
            id: randomUUID(),
            companyId,
            siteId,
            shiftId: shift.id,
            assignmentId,
            guardId,
            status: 'resolved',
            outcome: 'false_alarm',
            triggeredAt: startsAt,
            receivedAt: startsAt,
            locationStatus: 'ok',
          },
        });
      }
    }
    await db.roundWindowState.createMany({ data: windows });
    await db.incidentPhoto.create({
      data: {
        incidentId: visibleIncidentId,
        cloudinaryPublicId: `${secret}_FOTO`,
        width: 100,
        height: 100,
        bytes: 1000,
      },
    });
  }, 60000);

  afterAll(async () => {
    {
      await db.reportExport.deleteMany({
        where: { companyId: { in: [companyId, foreignCompanyId] } },
      });
      await db.recordFlag.deleteMany({ where: { companyId } });
      await db.panicAlert.deleteMany({ where: { companyId } });
      await db.incident.deleteMany({ where: { companyId } });
      await db.checkpointRecord.deleteMany({ where: { companyId } });
      await db.shift.deleteMany({ where: { companyId } });
      await db.round.deleteMany({ where: { companyId } });
      await db.checkpoint.deleteMany({ where: { companyId } });
      await db.siteSupervisor.deleteMany({ where: { companyId } });
      await db.site.deleteMany({ where: { companyId: { in: [companyId, foreignCompanyId] } } });
      await db.user.deleteMany({ where: { companyId } });
      await db.client.deleteMany({ where: { companyId: { in: [companyId, foreignCompanyId] } } });
      await db.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
    }
    await app.close();
  });

  const readPdf = async (path: string, role = 'admin') => {
    const response = await get(path, role)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Content-Disposition', /attachment; filename="garita-/)
      .expect('Cache-Control', 'private, no-store');
    const pdf: unknown = response.body;
    if (!Buffer.isBuffer(pdf)) throw new Error('La respuesta PDF no es binaria');
    return { response, pdf, pages: pdfPageTexts(pdf), text: pdfPageTexts(pdf).join('\n') };
  };
  it('CA1/BDD2: administrador incluye indicadores, gráficos con tabla, vigiladores, puntos y registro', async () => {
    const { response, text, pages } = await readPdf(
      `reportes/rondas/pdf?${period}&predio=${siteId}`,
    );
    for (const expected of [
      'Empresa PDF propia',
      'Cliente PDF propio',
      'Depósito PDF propio',
      'Porcentaje de cumplimiento',
      'Rondas por estado',
      'Evolución diaria del cumplimiento',
      'Comparación de cumplimiento por vigilador',
      secret,
      'PUNTO_HU40',
      'Listado de rondas del período',
    ])
      expect(text).toContain(expected);
    for (const page of pages)
      expect(page).toContain('Los datos pueden cambiar por verificaciones posteriores.');
    expect(
      await db.reportExport.findFirstOrThrow({
        where: { correlationId: String(response.headers['x-correlation-id']) },
      }),
    ).toMatchObject({
      userId: adminId,
      role: 'admin',
      siteIds: [siteId],
      periodStart: '2026-08-01',
      periodEnd: '2026-11-01',
      reportType: 'rounds',
      result: 'ok',
      createdAt: now,
    });
  }, 20000);
  it('CA2/BDD1: portal contiene solo respuestas permitidas, fotos contadas y todo el período', async () => {
    const { text, pdf } = await readPdf(`portal/reporte/pdf?${period}`, 'client');
    for (const expected of [
      'Empresa PDF propia',
      'Cliente PDF propio',
      'Depósito PDF propio',
      'Rondas en verificación',
      'En verificación',
      'Incidentes compartidos',
      'ULTIMA_NOTA_PERIODO',
      'Emergencias reales',
      '45 segundos',
      '1 fotos. Se consultan en el portal.',
    ])
      expect(text.replace(/\n/g, '')).toContain(expected);
    for (const forbidden of [
      secret,
      'CLIENTE_AJENO_HU40',
      'PREDIO_AJENO_HU40',
      'EMPRESA_AJENA_HU40',
      'CLIENTE_OTRA_EMPRESA_HU40',
      'PREDIO_OTRA_EMPRESA_HU40',
      'PUNTO_HU40',
      'Falsa alarma',
      'Vigilador',
      'Interno',
    ])
      expect(text).not.toContain(forbidden);
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
    expect(
      await db.reportExport.findFirstOrThrow({ where: { userId: clientUserId, result: 'ok' } }),
    ).toMatchObject({ role: 'client', siteIds: [siteId], reportType: 'portal' });
  }, 20000);
  it('supervisor exporta solo predios asignados y tiempos propios, sin comparación por supervisor', async () => {
    const { text } = await readPdf(`reportes/incidentes/pdf?${period}`, 'supervisor');
    expect(text).toContain('Tus tiempos');
    expect(text).not.toContain('Comparación por supervisor');
    expect(text).toContain('Depósito PDF propio');
    expect(text).not.toContain('PREDIO_AJENO_HU40');
    expect(text).not.toContain('CLIENTE_AJENO_HU40');
    const admin = await readPdf(`reportes/incidentes/pdf?${period}&predio=${siteId}`);
    expect(admin.text).toContain('Comparación por supervisor');
  }, 20000);
  it('CA4/CA5/BDD3: seis meses devuelve el mensaje del límite y registra el fallo', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      for (const [endpoint, role] of [
        ['reportes/rondas/pdf', 'supervisor'],
        ['reportes/incidentes/pdf', 'admin'],
        ['portal/reporte/pdf', 'client'],
      ]) {
        const response = await get(
          `${endpoint}?desde=2026-05-01&hasta=2026-11-01&predio=${siteId}`,
          role,
        ).expect(400);
        expect(response.body).toMatchObject({
          message: 'El período máximo para exportar es de 3 meses',
        });
        expect(
          await db.reportExport.findFirstOrThrow({
            where: { correlationId: String(response.headers['x-correlation-id']) },
          }),
        ).toMatchObject({
          result: 'failed',
          role,
          siteIds: [siteId],
          periodStart: '2026-05-01',
          periodEnd: '2026-11-01',
        });
      }
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'report_export.metric',
          result: 'failed',
        }),
      );
    } finally {
      errorLog.mockRestore();
    }
  });
  it('reutiliza la validación estricta y 404 de predios ajenos, también para la misma empresa', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      for (const endpoint of ['reportes/rondas/pdf', 'reportes/incidentes/pdf']) {
        await get(`${endpoint}?${period}&predio=${hiddenSiteId}`, 'supervisor').expect(404);
        await get(`${endpoint}?${period}&predio=${foreignSiteId}`).expect(404);
        await get(`${endpoint}?${period}&inventado=1`).expect(400);
      }
      for (const predio of [hiddenSiteId, foreignSiteId])
        await get(`portal/reporte/pdf?${period}&predio=${predio}`, 'client').expect(404);
      await get(`portal/reporte/pdf?${period}&cliente=${otherClientId}`, 'client').expect(400);
    } finally {
      log.mockRestore();
    }
  });
  it('la nueva política no cambia respuestas de los seis endpoints existentes del portal', async () => {
    const paths = [
      ['predios', portalSitesSchema],
      ['rondas?' + period, portalRoundsSchema],
      ['rondas/dia?fecha=2026-10-31', portalDaySchema],
      ['incidentes?' + period, portalIncidentsSchema],
      ['emergencias?' + period, portalEmergenciesSchema],
      [`incidentes/${visibleIncidentId}/fotos`, portalPhotosSchema],
    ] as const;
    for (const [path, schema] of paths) {
      const response = await get(`portal/${path}`, 'client').expect(200);
      expect(schema.safeParse(response.body).success).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain(secret);
    }
    expect(portalSitesSchema.parse((await get('portal/predios', 'client')).body)).toEqual([
      { id: siteId, name: 'Depósito PDF propio' },
    ]);
  });
  it('política tenant: Client propio activo y ReportExport solo del usuario, aun sin filtro', async () => {
    const prisma = app.get(PrismaService).tenantPrisma;
    const context = app.get(TenantContext);
    await context.run(
      {
        correlationId: 'tenant-hu40',
        user: { userId: clientUserId, companyId, clientId, role: 'client', status: 'active' },
      },
      async () => {
        expect(await prisma.client.findMany({ select: { name: true } })).toEqual([
          { name: 'Cliente PDF propio' },
        ]);
        expect(
          await prisma.client.findFirst({ where: { id: otherClientId }, select: { name: true } }),
        ).toBeNull();
        const exports = await prisma.reportExport.findMany();
        expect(exports.length).toBeGreaterThan(0);
        expect(
          exports.every((row) => row.userId === clientUserId && row.companyId === companyId),
        ).toBe(true);
        expect(await prisma.reportExport.findFirst({ where: { userId: adminId } })).toBeNull();
        await expect(
          prisma.reportExport.create({
            data: {
              companyId,
              userId: adminId,
              role: 'admin',
              siteIds: [],
              reportType: 'rounds',
              result: 'ok',
              correlationId: 'spoofed',
            },
          }),
        ).rejects.toThrow('Solo se registran');
        await db.client.update({ where: { id: clientId }, data: { status: 'inactive' } });
        try {
          expect(await prisma.client.findMany({ select: { name: true } })).toEqual([]);
        } finally {
          await db.client.update({ where: { id: clientId }, data: { status: 'active' } });
        }
      },
    );
  });
  it('CA3 mide tres meses sembrados atravesando servicios reales, renderizado, registro y HTTP', async () => {
    for (const [path, role] of [
      ['reportes/rondas/pdf', 'admin'],
      ['reportes/incidentes/pdf', 'admin'],
      ['portal/reporte/pdf', 'client'],
    ]) {
      const start = performance.now();
      const before = process.memoryUsage().rss;
      const { pdf, text } = await readPdf(`${path}?${period}&predio=${siteId}`, role);
      const elapsedMs = performance.now() - start;
      expect(text).toContain('2026-08-01');
      expect(text).toContain('2026-11-01');
      expect(elapsedMs).toBeLessThan(15000);
      expect(pdf.length).toBeLessThan(5000000);
      const metric = {
        path,
        days: 92,
        windows: 1104,
        visibleIncidents: 92,
        realEmergencies: 92,
        elapsedMs: Math.round(elapsedMs),
        bytes: pdf.length,
        rssBeforeMiB: Math.round(before / 1048576),
        rssAfterMiB: Math.round(process.memoryUsage().rss / 1048576),
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        compression: false,
      };
      process.stdout.write(`HU40_PERF ${JSON.stringify(metric)}\n`);
    }
  }, 60000);
});
