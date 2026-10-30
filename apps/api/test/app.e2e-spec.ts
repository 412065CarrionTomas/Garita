import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  SYNC_DEADLINE_PORT,
  SHIFT_AUTO_CLOSE_QUEUE,
  type SyncDeadlinePort,
} from '../src/modules/shift-execution/shift-execution.service';
import {
  authMeResponseSchema,
  liveHealthResponseSchema,
  serverTimeResponseSchema,
  startShiftResponseSchema,
  checkpointRecordResponseSchema,
  deviceSchema,
  shiftRecordsResponseSchema,
  siteResponseSchema,
  noticeKey,
  noticeSchema,
  noticesListResponseSchema,
  USER_ROLES,
  SOCKET_NAMESPACE,
  panicAlertStateResponseSchema,
  panicAlertDetailSchema,
} from '@garita/shared';
import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { aesCbc, aesCmac, deriveTagKey, truncateMac } from '../src/modules/nfc-tags/secure/crypto';
import { FACTORY_KEY, sessionKeys } from '../src/modules/nfc-tags/secure/ev2';
import { ShiftCredentialService } from '../src/modules/sync/shift-credential.service';
import { ConfigService } from '@nestjs/config';
import type { Server as HttpServer } from 'node:http';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { QrService } from '../src/modules/checkpoints/qr.service';
import { CheckpointsModule } from '../src/modules/checkpoints/checkpoints.module';
import { Roles } from '../src/modules/auth/auth.decorators';
import { TenantResourceService } from '../src/modules/auth/tenant-resource.service';
import { TenantContext } from '../src/modules/auth/tenant-context';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ShiftExecutionService } from '../src/modules/shift-execution/shift-execution.service';
import { MarcasService } from '../src/modules/marcas/marcas.service';
import { NfcTagsService } from '../src/modules/nfc-tags/nfc-tags.service';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { REALTIME_PORT, type RealtimePort } from '../src/common/ports/realtime.port';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../src/common/ports/notifications.port';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { RoundWindowStateService } from '../src/modules/supervision/round-window-state.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PanicJobsService } from '../src/modules/panic/panic-jobs.service';
import { SMS_PORT, type SmsPort } from '../src/common/ports/sms.port';
import { NOTICES_PORT, type NoticesPort } from '../src/common/ports/notices.port';
import {
  REPORT_RECALCULATION_PORT,
  type ReportRecalculationPort,
} from '../src/common/ports/report-recalculation.port';

function isLogEntry(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHttpServer(value: unknown): value is HttpServer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'listening' in value &&
    typeof value.listening === 'boolean'
  );
}

@Controller('test-only/users')
class TestOnlyUserController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResources: TenantResourceService,
    private readonly qr: QrService,
  ) {}

  @Get('unannotated')
  unannotated(): { ok: true } {
    return { ok: true };
  }

  @Get('qr/verify')
  @Roles('admin')
  verifyQr(@Query('payload') payload: string) {
    return this.qr.verifyQrPayload(payload);
  }

  @Get('admin-only')
  @Roles('admin')
  adminOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('pending-protected')
  @Roles(...USER_ROLES)
  pendingProtected(): { ok: true } {
    return { ok: true };
  }

  @Get('all')
  @Roles(...USER_ROLES)
  all() {
    return this.prisma.tenantPrisma.user.findMany({ select: { id: true, companyId: true } });
  }

  @Get('companies')
  @Roles(...USER_ROLES)
  companies() {
    return this.prisma.tenantPrisma.company.findMany({ select: { id: true } });
  }

  @Get('panic/:id')
  @Roles('admin', 'supervisor')
  panicById(@Param('id') id: string) {
    return this.tenantResources.findOwnedOrThrow('PanicAlert', id);
  }

  @Get('panic-sms/:id')
  @Roles('admin', 'supervisor')
  panicSmsById(@Param('id') id: string) {
    return this.tenantResources.findOwnedOrThrow('PanicSmsDelivery', id);
  }

  @Get('transaction')
  @Roles(...USER_ROLES)
  transaction() {
    return this.prisma.tenantPrisma.$transaction((tx) =>
      tx.user.findMany({ select: { id: true, companyId: true } }),
    );
  }

  @Get('clients-with-sites')
  @Roles(...USER_ROLES)
  clientsWithSites() {
    return this.prisma.tenantPrisma.client.findMany({ include: { sites: true } });
  }

  @Post('create-spoofed')
  @Roles(...USER_ROLES)
  createSpoofed() {
    const nonce = randomUUID();
    return this.prisma.tenantPrisma.user.create({
      data: {
        companyId: 'sur-company',
        firebaseUid: `tenant-test-${nonce}`,
        email: `tenant-test-${nonce}@example.invalid`,
        firstName: 'Tenant',
        lastName: 'Test',
        role: 'guard',
        status: 'active',
      },
      select: { id: true, companyId: true },
    });
  }

  @Patch(':id')
  @Roles(...USER_ROLES)
  updateById(@Param('id') id: string) {
    return this.prisma.tenantPrisma.user.updateMany({
      where: { id },
      data: { firstName: 'Updated by another tenant' },
    });
  }

  @Delete(':id')
  @Roles(...USER_ROLES)
  deleteById(@Param('id') id: string) {
    return this.prisma.tenantPrisma.user.deleteMany({ where: { id } });
  }

  @Get(':id')
  @Roles(...USER_ROLES)
  findById(@Param('id') id: string) {
    return this.tenantResources.findOwnedOrThrow('User', id);
  }

  @Patch('invitations/:id')
  @Roles(...USER_ROLES)
  updateInvitation(@Param('id') id: string) {
    return this.prisma.tenantPrisma.invitation.updateMany({
      where: { id },
      data: { sendStatus: 'sent', usedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
  }

  @Get('raw/:kind')
  @Roles(...USER_ROLES)
  raw(@Param('kind') kind: string) {
    if (kind === 'query') return this.prisma.tenantPrisma.$queryRaw`SELECT 1`;
    if (kind === 'execute') return this.prisma.tenantPrisma.$executeRaw`SELECT 1`;
    if (kind === 'query-unsafe') return this.prisma.tenantPrisma.$queryRawUnsafe('SELECT 1');
    return this.prisma.tenantPrisma.$executeRawUnsafe('SELECT 1');
  }

  @Get('unregistered/:id')
  @Roles(...USER_ROLES)
  unregistered(@Param('id') id: string) {
    return this.tenantResources.findOwnedOrThrow('UnknownModel', id);
  }
}

@Module({
  imports: [PrismaModule, CheckpointsModule],
  controllers: [TestOnlyUserController],
  providers: [TenantResourceService],
})
class TestOnlyModule {}

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { isShiftOverlapViolation } from '../src/modules/shifts/shift-overlap-error';

// Requiere PostgreSQL y Redis en ejecución (docker compose up -d).
describe('Aplicación (e2e)', () => {
  let app: INestApplication<App>;
  let northInvitationId: string;
  let southInvitationId: string;
  let northAssignedSiteId: string;
  let northUnassignedSiteId: string;
  let southSiteId: string;
  let northClientId: string;
  let northSupervisorId: string;
  let otherSupervisorId: string;
  let northGuardId: string;
  const createdRoundNames: string[] = [];
  const createdCheckpointIds: string[] = [];
  const createdShiftIds: string[] = [];
  const createdSiteIds: string[] = [];
  let testNow = new Date('2026-10-13T12:00:00.000Z');
  const createdNfcCheckpointIds: string[] = [];
  const notificationTokens: string[] = [];

  it.each(['rondas', 'rondas/detalle', 'pendientes', 'puntos-marcas-frecuentes'])(
    'HU-25 permisos de reportes/%s',
    async (endpoint) => {
      const path = `/api/v1/reportes/${endpoint}`;
      await request(app.getHttpServer()).get(path).expect(401);
      for (const token of ['token-guard', 'token-client'])
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      for (const siteId of [northUnassignedSiteId, southSiteId])
        await request(app.getHttpServer())
          .get(`${path}?predio=${siteId}`)
          .set('Authorization', 'Bearer token-supervisor')
          .expect(404);
      await request(app.getHttpServer())
        .get(`${path}?predio=${northAssignedSiteId}`)
        .set('Authorization', 'Bearer token-other-supervisor')
        .expect(404);
      await request(app.getHttpServer())
        .get(`${path}?predio=${northAssignedSiteId}`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
    },
  );

  beforeAll(async () => {
    process.env.NFC_MASTER_KEY =
      process.env.NFC_MASTER_KEY ?? Buffer.alloc(16, 0x11).toString('hex');
    process.env.NFC_MASTER_KEY_VERSION = process.env.NFC_MASTER_KEY_VERSION ?? '1';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TestOnlyModule],
    })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (token: string) => {
          if (token === 'token-connectivity')
            return Promise.resolve({ uid: 'e2e-connectivity-guard' });
          if (token === 'token-admin') return Promise.resolve({ uid: 'seed-norte-admin' });
          if (token === 'token-deactivated')
            return Promise.resolve({ uid: 'seed-norte-deactivated' });
          if (token === 'token-pending') return Promise.resolve({ uid: 'seed-norte-pending' });
          if (token === 'token-guard') return Promise.resolve({ uid: 'seed-norte-guard' });
          if (token === 'token-replacement')
            return Promise.resolve({ uid: 'tenant-test-replacement' });
          if (token === 'token-reassignment-source')
            return Promise.resolve({ uid: 'tenant-test-reassignment-source' });
          if (token === 'token-supervisor')
            return Promise.resolve({ uid: 'seed-norte-supervisor' });
          if (token === 'token-other-supervisor')
            return Promise.resolve({ uid: 'seed-norte-other-supervisor' });
          if (token === 'token-client') return Promise.resolve({ uid: 'seed-norte-client' });
          if (token === 'token-south-admin') return Promise.resolve({ uid: 'seed-sur-admin' });
          return Promise.reject(new Error('Token inválido'));
        },
        setDisabled: jest.fn(() => Promise.resolve()),
        revokeRefreshTokens: jest.fn(() => Promise.resolve()),
        createDisabledUser: jest.fn((email: string) => Promise.resolve({ uid: email })),
        deleteUser: jest.fn(() => Promise.resolve()),
        generatePasswordResetLink: jest.fn((email: string) => Promise.resolve(email)),
      })
      .overrideProvider(CLOCK)
      .useValue({ now: () => testNow })
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    const prisma = app.get(PrismaService).systemPrisma;
    await prisma.user.updateMany({
      where: { firebaseUid: 'seed-norte-client' },
      data: { status: 'active' },
    });
    await prisma.nfcTag.deleteMany({ where: { checkpointId: { in: createdNfcCheckpointIds } } });
    await prisma.checkpoint.deleteMany({ where: { id: { in: createdNfcCheckpointIds } } });
    const northClient = await prisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
    });
    const southClient = await prisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'sur-company', name: 'Cliente sur' } },
    });
    northClientId = northClient.id;
    northAssignedSiteId = (
      await prisma.site.findUniqueOrThrow({
        where: { clientId_name: { clientId: northClient.id, name: 'Predio A' } },
      })
    ).id;
    northUnassignedSiteId = (
      await prisma.site.findUniqueOrThrow({
        where: { clientId_name: { clientId: northClient.id, name: 'Predio B' } },
      })
    ).id;
    await prisma.siteSupervisor.deleteMany({
      where: { siteId: northUnassignedSiteId },
    });
    southSiteId = (
      await prisma.site.findUniqueOrThrow({
        where: { clientId_name: { clientId: southClient.id, name: 'Predio A' } },
      })
    ).id;
    northSupervisorId = (
      await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-supervisor' } })
    ).id;
    northGuardId = (
      await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-guard' } })
    ).id;
    const pending = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-pending' },
    });
    await prisma.user.update({ where: { id: pending.id }, data: { status: 'invitation_pending' } });
    const northInvitation = await prisma.invitation.upsert({
      where: { tokenHash: 'e2e-north-invitation' },
      create: {
        userId: pending.id,
        tokenHash: 'e2e-north-invitation',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
      update: { userId: pending.id },
    });
    northInvitationId = northInvitation.id;
    const southUser = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-sur-admin' },
    });
    const southInvitation = await prisma.invitation.upsert({
      where: { tokenHash: 'e2e-south-invitation' },
      create: {
        userId: southUser.id,
        tokenHash: 'e2e-south-invitation',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
      update: { userId: southUser.id },
    });
    southInvitationId = southInvitation.id;
    const otherSupervisor = await prisma.user.upsert({
      where: { firebaseUid: 'seed-norte-other-supervisor' },
      create: {
        companyId: 'norte-company',
        email: 'other-supervisor@norte.com',
        firstName: 'Otro',
        lastName: 'Supervisor',
        role: 'supervisor',
        status: 'active',
        firebaseUid: 'seed-norte-other-supervisor',
      },
      update: { status: 'active' },
    });
    otherSupervisorId = otherSupervisor.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    await prisma.secureTagSession.deleteMany({
      where: { checkpointId: { in: [...createdNfcCheckpointIds, ...createdCheckpointIds] } },
    });
    await prisma.notificationDevice.deleteMany({ where: { token: { in: notificationTokens } } });
    await prisma.recordFlag.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.roundReviewDecision.deleteMany({
      where: { windowState: { shiftId: { in: createdShiftIds } } },
    });
    await prisma.checkpointRecord.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.panicAlert.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
    await prisma.site.deleteMany({ where: { id: { in: createdSiteIds } } });
    const rounds = await prisma.round.findMany({
      where: { name: { in: createdRoundNames } },
      select: { id: true },
    });
    const roundIds = rounds.map(({ id }) => id);
    if (roundIds.length) {
      const versions = await prisma.roundVersion.findMany({
        where: { roundId: { in: roundIds } },
        select: { id: true },
      });
      const versionIds = versions.map(({ id }) => id);
      await prisma.roundVersionCheckpoint.deleteMany({
        where: { roundVersionId: { in: versionIds } },
      });
      await prisma.round.updateMany({
        where: { id: { in: roundIds } },
        data: { currentVersionId: null },
      });
      await prisma.roundVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.round.deleteMany({ where: { id: { in: roundIds } } });
    }
    await prisma.nfcTag.deleteMany({ where: { checkpointId: { in: createdCheckpointIds } } });
    await prisma.checkpoint.deleteMany({ where: { id: { in: createdCheckpointIds } } });
    await prisma.checkpoint.deleteMany({
      where: { name: { startsWith: 'Punto PDF E2E ' } },
    });
    await prisma.invitation.deleteMany({
      where: { tokenHash: { in: ['e2e-north-invitation', 'e2e-south-invitation'] } },
    });
    await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: 'tenant-test-' } } });
    await prisma.user.updateMany({
      where: { firebaseUid: 'seed-norte-pending' },
      data: { status: 'invitation_pending' },
    });
    await prisma.user.updateMany({
      where: { firebaseUid: 'seed-norte-client' },
      data: { status: 'active' },
    });
    if (otherSupervisorId) {
      await prisma.siteSupervisor.deleteMany({
        where: { userId: otherSupervisorId },
      });
      await prisma.user.deleteMany({
        where: { firebaseUid: 'seed-norte-other-supervisor' },
      });
    }
    await app.close();
  });

  it('registra pánico por HTTP con la credencial de turno, deduplica y aísla turnos', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const creator = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2035-01-01T10:00:00Z'),
        endsAt: new Date('2035-01-01T18:00:00Z'),
        serviceDate: new Date('2035-01-01T00:00:00Z'),
        createdById: creator.id,
        status: 'in_progress',
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2035-01-01T10:00:00Z'),
            endsAt: new Date('2035-01-01T18:00:00Z'),
            assignedById: creator.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id },
    });
    testNow = new Date('2035-01-01T12:00:00Z');
    const { token } = await app.get(ShiftCredentialService).issueCredential({
      shiftId: shift.id,
      assignmentId: assignment.id,
      userId: northGuardId,
      companyId: 'norte-company',
      scheduledEnd: shift.endsAt,
    });
    testNow = new Date('2026-10-13T12:00:00.000Z');
    const notifications = jest
      .spyOn(app.get<NotificationsPort>(NOTIFICATIONS_PORT), 'notifySiteStaff')
      .mockResolvedValue();
    const realtime = jest
      .spyOn(app.get<RealtimePort>(REALTIME_PORT), 'emitToSite')
      .mockImplementation(() => undefined);
    const client = request(app.getHttpServer());
    const alertId = randomUUID();
    const body = {
      alertId,
      shiftId: shift.id,
      occurredAtDevice: testNow.toISOString(),
      location: {
        status: 'ok',
        latitude: -34.6,
        longitude: -58.4,
        accuracyMeters: 20,
        simulation: 'not_simulated',
        takenAt: testNow.toISOString(),
      },
    };
    const panicShiftIds = [shift.id];
    const schedule = jest.spyOn(app.get(PanicJobsService), 'schedule').mockResolvedValue();
    try {
      await client.post('/api/v1/alertas-panico').send(body).expect(401);
      const first = await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
      expect(first.body).toMatchObject({ alertId, status: 'active' });
      for (const firebaseToken of ['token-admin', 'token-guard', 'token-supervisor']) {
        await client
          .post('/api/v1/alertas-panico')
          .set('Authorization', `Bearer ${firebaseToken}`)
          .send(body)
          .expect(401);
      }
      await client
        .get(`/api/v1/test-only/users/panic/${alertId}`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      await client
        .get(`/api/v1/test-only/users/panic/${alertId}`)
        .set('Authorization', 'Bearer token-other-supervisor')
        .expect(404);
      await client
        .get(`/api/v1/test-only/users/panic/${alertId}`)
        .set('Authorization', 'Bearer token-south-admin')
        .expect(404);
      await client.get(`/api/v1/alertas-panico/${alertId}/estado`).expect(401);
      await client
        .patch(`/api/v1/alertas-panico/${alertId}/ubicacion`)
        .send({ location: body.location })
        .expect(401);
      expect(notifications).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'panic', priority: 'high' }),
      );
      expect(realtime).toHaveBeenCalledWith(
        'norte-company',
        northAssignedSiteId,
        'panico.actualizado',
        { alertId, siteId: northAssignedSiteId },
      );
      await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
      expect(await prisma.panicAlert.count({ where: { shiftId: shift.id } })).toBe(1);
      const activationId = randomUUID();
      const next = await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...body, alertId: activationId })
        .expect(200);
      await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...body, alertId: activationId })
        .expect(200);
      expect(panicAlertStateResponseSchema.parse(next.body).alertId).toBe(alertId);
      expect(
        (await prisma.panicAlert.findUniqueOrThrow({ where: { id: alertId } })).activationCount,
      ).toBe(2);
      expect(await prisma.panicAlertEvent.count({ where: { alertId, type: 'activation' } })).toBe(
        1,
      );
      await client
        .patch(`/api/v1/alertas-panico/${alertId}/ubicacion`)
        .set('Authorization', `Bearer ${token}`)
        .send({ location: { ...body.location, accuracyMeters: 5 } })
        .expect(200);
      expect(
        Number(
          (await prisma.panicAlert.findUniqueOrThrow({ where: { id: alertId } })).accuracyMeters,
        ),
      ).toBe(5);
      for (const invalid of [
        { status: 'unverifiable', latitude: null, longitude: null },
        { status: 'ok', latitude: null, longitude: body.location.longitude },
        { status: 'ok', latitude: body.location.latitude, longitude: null },
      ]) {
        await client
          .patch(`/api/v1/alertas-panico/${alertId}/ubicacion`)
          .set('Authorization', `Bearer ${token}`)
          .send({ location: { ...body.location, ...invalid, accuracyMeters: 1 } })
          .expect(200);
        const preserved = await prisma.panicAlert.findUniqueOrThrow({ where: { id: alertId } });
        expect(Number(preserved.latitude)).toBe(body.location.latitude);
        expect(Number(preserved.longitude)).toBe(body.location.longitude);
        expect(Number(preserved.accuracyMeters)).toBe(5);
        expect(preserved.locationStatus).toBe('ok');
      }
      await client
        .get(`/api/v1/alertas-panico/${alertId}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const other = await prisma.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: northUnassignedSiteId,
          startsAt: new Date('2035-01-02T10:00:00Z'),
          endsAt: new Date('2035-01-02T18:00:00Z'),
          serviceDate: new Date('2035-01-02T00:00:00Z'),
          createdById: creator.id,
          status: 'scheduled',
          assignments: {
            create: {
              guardId: northGuardId,
              startsAt: new Date('2035-01-02T10:00:00Z'),
              endsAt: new Date('2035-01-02T18:00:00Z'),
              assignedById: creator.id,
            },
          },
        },
      });
      createdShiftIds.push(other.id);
      panicShiftIds.push(other.id);
      const otherAssignment = await prisma.shiftAssignment.findFirstOrThrow({
        where: { shiftId: other.id },
      });
      const otherToken = (
        await app.get(ShiftCredentialService).issueCredential({
          shiftId: other.id,
          assignmentId: otherAssignment.id,
          userId: northGuardId,
          companyId: 'norte-company',
          scheduledEnd: other.endsAt,
        })
      ).token;
      await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${otherToken}`)
        .send(body)
        .expect(403);
      await client
        .patch(`/api/v1/alertas-panico/${alertId}/ubicacion`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ location: body.location })
        .expect(404);
      await client
        .get(`/api/v1/alertas-panico/${alertId}/estado`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ ...body, alertId: randomUUID(), shiftId: other.id })
        .expect(409);

      const detailPath = `/api/v1/alertas-panico/${alertId}`;
      for (const [method, path] of [
        ['get', '/api/v1/alertas-panico'],
        ['get', detailPath],
        ['post', `${detailPath}/confirmar`],
        ['post', `${detailPath}/resolver`],
      ] as const) {
        await client[method](path).expect(401);
        for (const denied of ['token-guard', 'token-client'])
          await client[method](path).set('Authorization', `Bearer ${denied}`).expect(403);
        if (path !== '/api/v1/alertas-panico') {
          for (const denied of ['token-other-supervisor', 'token-south-admin'])
            await client[method](path)
              .set('Authorization', `Bearer ${denied}`)
              .send(
                method === 'post' && path.endsWith('resolver')
                  ? { outcome: 'test', comment: 'Prueba válida' }
                  : {},
              )
              .expect(404);
        }
      }
      for (const [authToken, visible] of [
        ['token-supervisor', true],
        ['token-other-supervisor', false],
        ['token-south-admin', false],
      ] as const) {
        const inbox = await client
          .get('/api/v1/alertas-panico')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
        expect(
          z
            .object({ items: z.array(z.object({ id: z.string() })) })
            .parse(inbox.body)
            .items.some((item) => item.id === alertId),
        ).toBe(visible);
      }
      await client
        .post(`${detailPath}/resolver`)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ outcome: 'test', comment: 'Prueba válida' })
        .expect(409);
      for (const invalid of [
        { comment: 'Sin resultado' },
        { outcome: 'test', comment: 'cort' },
        { outcome: 'test', comment: 'x'.repeat(1001) },
      ])
        await client
          .post(`${detailPath}/resolver`)
          .set('Authorization', 'Bearer token-supervisor')
          .send(invalid)
          .expect(400);
      const confirmed = await client
        .post(`${detailPath}/confirmar`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      const confirmedDetail = panicAlertDetailSchema.parse(confirmed.body);
      expect(confirmedDetail).toMatchObject({
        status: 'confirmed',
        confirmedAt: testNow.toISOString(),
      });
      expect(confirmedDetail.confirmedBy?.name).toBeTruthy();
      await client
        .post(`${detailPath}/confirmar`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(409);
      const guardState = await client
        .get(`${detailPath}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(panicAlertStateResponseSchema.parse(guardState.body)).toMatchObject({
        status: 'confirmed',
        confirmedAt: testNow.toISOString(),
      });
      // A different assigned supervisor can resolve the first supervisor's confirmation.
      await prisma.siteSupervisor.create({
        data: {
          companyId: 'norte-company',
          siteId: northAssignedSiteId,
          userId: otherSupervisorId,
        },
      });
      try {
        const resolved = await client
          .post(`${detailPath}/resolver`)
          .set('Authorization', 'Bearer token-other-supervisor')
          .send({ outcome: 'test', comment: 'Prueba de capacitación' })
          .expect(200);
        expect(panicAlertDetailSchema.parse(resolved.body)).toMatchObject({
          status: 'resolved',
          outcome: 'test',
          resolutionComment: 'Prueba de capacitación',
        });
      } finally {
        await prisma.siteSupervisor.deleteMany({
          where: { siteId: northAssignedSiteId, userId: otherSupervisorId },
        });
      }
      expect(await prisma.panicAlertEvent.count({ where: { alertId, type: 'confirmed' } })).toBe(1);
      expect(await prisma.panicAlertEvent.count({ where: { alertId, type: 'resolved' } })).toBe(1);
      const lateId = randomUUID();
      testNow = new Date('2026-10-13T06:25:00.000Z');
      await client
        .post('/api/v1/alertas-panico')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...body, alertId: lateId, occurredAtDevice: '2026-10-13T06:10:00.000Z' })
        .expect(200);
      const late = await client
        .get(`/api/v1/alertas-panico/${lateId}`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      expect(panicAlertDetailSchema.parse(late.body)).toMatchObject({
        triggeredAt: '2026-10-13T06:10:00.000Z',
        receivedAt: '2026-10-13T06:25:00.000Z',
        channel: 'internet',
      });
      const staff = await prisma.user.findUniqueOrThrow({
        where: { firebaseUid: 'seed-norte-supervisor' },
      });
      const sms = jest
        .spyOn(app.get<SmsPort>(SMS_PORT), 'sendPanicAlert')
        .mockResolvedValue({ sent: true });
      await prisma.user.update({ where: { id: staff.id }, data: { phone: null } });
      await prisma.user.update({ where: { id: creator.id }, data: { phone: '+5493517654321' } });
      try {
        await app
          .get(PanicJobsService)
          .sendSms({ companyId: 'norte-company', alertId: lateId, reason: 'initial' });
        expect(sms).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5493517654321' }));
        expect(
          sms.mock.calls.every(
            ([input]) =>
              input.phone !== '' &&
              !input.message.includes(body.location.latitude.toString()) &&
              !input.message.includes(confirmedDetail.guard.name),
          ),
        ).toBe(true);
        expect(sms.mock.calls.some(([input]) => input.phone === staff.phone)).toBe(false);
        const skipped = await prisma.panicSmsDelivery.findUniqueOrThrow({
          where: {
            alertId_userId_reason: { alertId: lateId, userId: staff.id, reason: 'initial' },
          },
        });
        expect(skipped.status).toBe('skipped');
        for (const [authToken, status] of [
          ['token-supervisor', 200],
          ['token-other-supervisor', 404],
          ['token-south-admin', 404],
        ] as const)
          await client
            .get(`/api/v1/test-only/users/panic-sms/${skipped.id}`)
            .set('Authorization', `Bearer ${authToken}`)
            .expect(status);
      } finally {
        sms.mockRestore();
        await prisma.user.update({ where: { id: staff.id }, data: { phone: staff.phone } });
        await prisma.user.update({ where: { id: creator.id }, data: { phone: creator.phone } });
      }
    } finally {
      schedule.mockRestore();
      testNow = new Date('2026-10-13T12:00:00.000Z');
      notifications.mockRestore();
      realtime.mockRestore();
      await prisma.panicAlert.deleteMany({ where: { shiftId: { in: panicShiftIds } } });
      await prisma.shift.deleteMany({ where: { id: { in: panicShiftIds } } });
    }
  });

  it('clasifica, reclasifica y filtra incidentes sin exponerlos al cliente ni a otros predios', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2020-10-20T08:00:00Z'),
        endsAt: new Date('2020-10-20T11:00:00Z'),
        serviceDate: new Date('2020-10-20T00:00:00Z'),
        createdById: admin.id,
        assignments: {
          create: {
            guardId: northGuardId,
            assignedById: admin.id,
            startsAt: new Date('2020-10-20T08:00:00Z'),
            endsAt: new Date('2020-10-20T11:00:00Z'),
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id },
    });
    const incident = await prisma.incident.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        shiftId: shift.id,
        assignmentId: assignment.id,
        guardId: northGuardId,
        incidentId: randomUUID(),
        type: 'intrusion',
        occurredAtDevice: new Date('2020-10-20T09:00:00Z'),
        locationStatus: 'ok',
        simulation: 'not_simulated',
      },
    });
    const client = request(app.getHttpServer());
    const queuePath = '/api/v1/incidentes/cola';
    await client.get(queuePath).expect(401);
    await client.get(queuePath).set('Authorization', 'Bearer token-guard').expect(403);
    await client.get(queuePath).set('Authorization', 'Bearer token-client').expect(403);
    const queue = await client
      .get(queuePath)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(
      z
        .array(z.looseObject({ id: z.string() }))
        .parse(queue.body)
        .some((row) => row.id === incident.id),
    ).toBe(true);
    const count = await client
      .get(`${queuePath}/cantidad`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(z.object({ count: z.number() }).parse(count.body).count).toBeGreaterThan(0);
    await client
      .post(`/api/v1/incidentes/${incident.id}/clasificar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ classification: 'internal', internalComment: '' })
      .expect(400);
    await client
      .post(`/api/v1/incidentes/${incident.id}/clasificar`)
      .set('Authorization', 'Bearer token-client')
      .send({ classification: 'internal', internalComment: 'Comentario interno' })
      .expect(403);
    await client
      .post(`/api/v1/incidentes/${incident.id}/clasificar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ classification: 'internal', internalComment: 'Comentario interno' })
      .expect(201);
    expect(
      (await client.get(queuePath).set('Authorization', 'Bearer token-supervisor').expect(200))
        .body,
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: incident.id })]));
    await client
      .post(`/api/v1/incidentes/${incident.id}/reclasificar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ classification: 'client_visible', internalComment: 'Segundo comentario', reason: '' })
      .expect(400);
    await client
      .post(`/api/v1/incidentes/${incident.id}/reclasificar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({
        classification: 'client_visible',
        internalComment: 'Segundo comentario',
        clientNote: 'Nota pública',
        reason: 'El cliente pidió detalles',
      })
      .expect(201);
    const detail = await client
      .get(`/api/v1/incidentes/${incident.id}`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(
      z
        .object({
          classificationStatus: z.literal('client_visible'),
          classifications: z.array(
            z.looseObject({ decidedById: z.string(), decidedAt: z.string() }),
          ),
        })
        .loose()
        .parse(detail.body).classifications,
    ).toHaveLength(2);
    const filtered = await client
      .get(
        `/api/v1/incidentes?predio=${northAssignedSiteId}&tipo=intrusion&clasificacion=client_visible&desde=2020-10-20&hasta=2030-10-20&pagina=1`,
      )
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(
      z
        .object({ items: z.array(z.looseObject({ id: z.string() })) })
        .parse(filtered.body)
        .items.some((row) => row.id === incident.id),
    ).toBe(true);
    const unassignedShift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        startsAt: new Date('2020-10-21T08:00:00Z'),
        endsAt: new Date('2020-10-21T11:00:00Z'),
        serviceDate: new Date('2020-10-21T00:00:00Z'),
        createdById: admin.id,
        assignments: {
          create: {
            guardId: northGuardId,
            assignedById: admin.id,
            startsAt: new Date('2020-10-21T08:00:00Z'),
            endsAt: new Date('2020-10-21T11:00:00Z'),
          },
        },
      },
    });
    createdShiftIds.push(unassignedShift.id);
    const unassignedAssignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: unassignedShift.id },
    });
    const fallbackIncident = await prisma.incident.create({
      data: {
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        shiftId: unassignedShift.id,
        assignmentId: unassignedAssignment.id,
        guardId: northGuardId,
        incidentId: randomUUID(),
        type: 'other',
        description: 'Sin supervisor activo',
        occurredAtDevice: new Date('2020-10-21T09:00:00Z'),
        locationStatus: 'ok',
        simulation: 'not_simulated',
      },
    });
    expect(
      (await client.get(queuePath).set('Authorization', 'Bearer token-admin').expect(200)).body,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: fallbackIncident.id })]));
    expect(
      (await client.get(queuePath).set('Authorization', 'Bearer token-supervisor').expect(200))
        .body,
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: fallbackIncident.id })]));
    await client
      .get(`/api/v1/incidentes/${fallbackIncident.id}`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(404);
    await client
      .get(`/api/v1/incidentes/${incident.id}`)
      .set('Authorization', 'Bearer token-client')
      .expect(403);
    await client
      .get(`/api/v1/incidentes/${incident.id}`)
      .set('Authorization', 'Bearer token-south-admin')
      .expect(404);
  });

  it('administra puntos, valida ubicaciones, firma QRs y genera stickers PDF', async () => {
    const auth = { Authorization: 'Bearer token-admin' };
    const otherSiteAuth = { Authorization: 'Bearer token-south-admin' };
    const name = `Punto e2e ${randomUUID()}`;
    const body = {
      name,
      latitude: -34.6,
      longitude: -58.4,
      stickerLocation: 'portón trasero',
      isIndoor: true,
    };
    const created = await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(auth)
      .send(body)
      .expect(201);
    const checkpoint = z
      .object({ id: z.string(), toleranceRadiusMeters: z.number(), qrVersion: z.number() })
      .parse(created.body);
    createdCheckpointIds.push(checkpoint.id);
    expect(checkpoint).toMatchObject({ toleranceRadiusMeters: 30, qrVersion: 1 });
    const qrService = app.get(QrService);
    const originalQr = qrService.createPayload(checkpoint.id, 1);
    const verifyQrPath = (payload: string) =>
      `/api/v1/test-only/users/qr/verify?payload=${encodeURIComponent(payload)}`;
    const originalVerification = await request(app.getHttpServer())
      .get(verifyQrPath(originalQr))
      .set(auth)
      .expect(200);
    expect(z.object({ valid: z.literal(true) }).safeParse(originalVerification.body).success).toBe(
      true,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(auth)
      .send({ ...body, toleranceRadiusMeters: 5 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(auth)
      .send({ ...body, toleranceRadiusMeters: 250 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(auth)
      .send(body)
      .expect(409);
    const secondSiteName = name;
    const secondSitePoint = await request(app.getHttpServer())
      .post(`/api/v1/predios/${northUnassignedSiteId}/puntos`)
      .set(auth)
      .send({ ...body, name: secondSiteName, confirmFarLocation: true })
      .expect(201);
    createdCheckpointIds.push(z.object({ id: z.string() }).parse(secondSitePoint.body).id);

    const far = { ...body, name: `Lejano ${randomUUID()}`, latitude: 0, longitude: 0 };
    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(auth)
      .send(far)
      .expect(409);
    const rejectedBody: unknown = JSON.parse(JSON.stringify(rejected.body));
    expect(z.object({ code: z.string() }).parse(rejectedBody).code).toBe(
      'CHECKPOINT_LOCATION_REQUIRES_CONFIRMATION',
    );
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(auth)
      .send({ ...far, confirmFarLocation: true })
      .expect(201);
    createdCheckpointIds.push(z.object({ id: z.string() }).parse(confirmed.body).id);

    // El test altera temporalmente el fixture seed para verificar el predio dado de baja.
    const systemPrisma = app.get(PrismaService).systemPrisma;
    await systemPrisma.site.update({
      where: { id: northAssignedSiteId },
      data: { status: 'inactive' },
    });
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
        .set(auth)
        .send({ ...body, name: `Predio dado de baja ${randomUUID()}` })
        .expect(404);
    } finally {
      await systemPrisma.site.update({
        where: { id: northAssignedSiteId },
        data: { status: 'active' },
      });
    }

    const seededCheckpoint = await systemPrisma.checkpoint.findFirstOrThrow({
      where: { siteId: northAssignedSiteId, status: 'active' },
      orderBy: { name: 'asc' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/puntos/${seededCheckpoint.id}/baja`)
      .set(auth)
      .expect(409)
      .expect(({ body: result }) => {
        const parsedResult: unknown = JSON.parse(JSON.stringify(result));
        const rounds = z
          .object({ rounds: z.array(z.object({ id: z.string(), name: z.string() })) })
          .parse(parsedResult).rounds;
        expect(rounds.map(({ name }) => name)).toContain('Perimetral');
      });

    const regenerated = await request(app.getHttpServer())
      .post(`/api/v1/puntos/${checkpoint.id}/regenerar-qr`)
      .set(auth)
      .expect(201);
    const regeneratedBody: unknown = JSON.parse(JSON.stringify(regenerated.body));
    const regeneratedPayload = z
      .object({ checkpoint: z.object({ qrVersion: z.number() }), qrPayload: z.string() })
      .parse(regeneratedBody);
    expect(regeneratedPayload.checkpoint.qrVersion).toBe(2);
    expect(regeneratedPayload.qrPayload).toContain('.2.');
    const outdatedVerification = await request(app.getHttpServer())
      .get(verifyQrPath(originalQr))
      .set(auth)
      .expect(200);
    const outdatedBody: unknown = JSON.parse(JSON.stringify(outdatedVerification.body));
    expect(
      z.object({ valid: z.literal(false), reason: z.literal('outdated') }).safeParse(outdatedBody)
        .success,
    ).toBe(true);
    const currentVerification = await request(app.getHttpServer())
      .get(verifyQrPath(regeneratedPayload.qrPayload))
      .set(auth)
      .expect(200);
    expect(z.object({ valid: z.literal(true) }).safeParse(currentVerification.body).success).toBe(
      true,
    );
    const alteredId = `${checkpoint.id.startsWith('a') ? 'b' : 'a'}${checkpoint.id.slice(1)}`;
    const alteredQr = regeneratedPayload.qrPayload.replace(checkpoint.id, alteredId);
    const alteredVerification = await request(app.getHttpServer())
      .get(verifyQrPath(alteredQr))
      .set(auth)
      .expect(200);
    const alteredBody: unknown = JSON.parse(JSON.stringify(alteredVerification.body));
    expect(
      z.object({ valid: z.literal(false), reason: z.literal('signature') }).safeParse(alteredBody)
        .success,
    ).toBe(true);

    const prisma = app.get(PrismaService).systemPrisma;
    await prisma.checkpoint.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Punto PDF E2E ${index}`,
        latitude: -34.6,
        longitude: -58.4,
      })),
    });

    const pdfStarted = Date.now();
    const pdf = await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/stickers`)
      .set(auth)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    const pdfBody: unknown = pdf.body;
    expect(Buffer.isBuffer(pdfBody) ? pdfBody.byteLength : 0).toBeGreaterThan(1000);
    expect(Date.now() - pdfStarted).toBeLessThan(5000);

    const supervisor = { Authorization: 'Bearer token-supervisor' };
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(supervisor)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northUnassignedSiteId}/puntos`)
      .set(supervisor)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(supervisor)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set({ Authorization: 'Bearer token-client' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/puntos`)
      .set(otherSiteAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/stickers`)
      .set({ Authorization: 'Bearer token-guard' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/puntos/${checkpoint.id}/baja`)
      .set(auth)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/stickers?puntos=${checkpoint.id}`)
      .set(auth)
      .expect(404);
  }, 30000);

  it('GET /api/v1/health/live responde con el contrato compartido', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(liveHealthResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('revisa una ronda grave, conserva el historial y recalcula al invalidar registros', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const reviewNow = new Date('2026-10-12T12:00:00Z');
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const notifications = jest
      .spyOn(app.get(NotificationsService), 'notifySiteStaff')
      .mockResolvedValue(undefined);
    const reports = jest.spyOn(
      app.get<ReportRecalculationPort>(REPORT_RECALCULATION_PORT),
      'recalculate',
    );
    const checkpoints = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        prisma.checkpoint.create({
          data: {
            companyId: 'norte-company',
            siteId: northAssignedSiteId,
            name: `Punto revisión ${index} ${randomUUID()}`,
            latitude: -34.6,
            longitude: -58.4,
          },
        }),
      ),
    );
    createdCheckpointIds.push(...checkpoints.map((checkpoint) => checkpoint.id));
    const roundName = `Ronda revisión ${randomUUID()}`;
    createdRoundNames.push(roundName);
    const round = await prisma.round.create({
      data: { companyId: 'norte-company', siteId: northAssignedSiteId, name: roundName },
    });
    const version = await prisma.roundVersion.create({
      data: {
        roundId: round.id,
        versionNumber: 1,
        frequencyMinutes: 60,
        windowStartLocal: '00:00',
        windowEndLocal: '23:00',
        graceMinutes: 15,
        createdById: admin.id,
      },
    });
    await prisma.round.update({ where: { id: round.id }, data: { currentVersionId: version.id } });
    await prisma.roundVersionCheckpoint.createMany({
      data: checkpoints.map((checkpoint, position) => ({
        companyId: 'norte-company',
        roundVersionId: version.id,
        checkpointId: checkpoint.id,
        position,
      })),
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date(reviewNow.getTime() - 60 * 60_000),
        endsAt: new Date(reviewNow.getTime() + 60 * 60_000),
        serviceDate: new Date('2026-10-12T00:00:00Z'),
        createdById: admin.id,
        rounds: { create: { roundId: round.id, roundVersionId: version.id } },
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date(reviewNow.getTime() - 60 * 60_000),
            endsAt: new Date(reviewNow.getTime() + 60 * 60_000),
            assignedById: admin.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id },
    });
    const window = await prisma.roundWindowState.create({
      data: {
        companyId: 'norte-company',
        shiftId: shift.id,
        roundId: round.id,
        windowIndex: 0,
        startsAt: new Date(reviewNow.getTime() - 30 * 60_000),
        endsAt: new Date(reviewNow.getTime() + 30 * 60_000),
        graceEndsAt: new Date(reviewNow.getTime() + 45 * 60_000),
        expectedCount: 5,
      },
    });
    const records = [];
    for (const checkpoint of checkpoints) {
      records.push(
        await prisma.checkpointRecord.create({
          data: {
            companyId: 'norte-company',
            shiftId: shift.id,
            assignmentId: assignment.id,
            checkpointId: checkpoint.id,
            recordId: randomUUID(),
            method: 'qr',
            occurredAtDevice: reviewNow,
            locationStatus: 'ok',
            simulation: 'not_simulated',
            phoneNfc: 'on',
            countedFor: [{ roundId: round.id, windowIndex: 0 }],
            requestHash: randomUUID(),
          },
        }),
      );
    }
    const [firstRecord, secondRecord] = records;
    if (!firstRecord || !secondRecord) throw new Error('Faltan registros de la ronda de prueba');
    await prisma.recordFlag.create({
      data: {
        companyId: 'norte-company',
        checkpointRecordId: firstRecord.id,
        shiftId: shift.id,
        type: 'simulated_location',
        severity: 'grave',
      },
    });
    await app.get(TenantContext).run(
      {
        correlationId: randomUUID(),
        user: { userId: admin.id, companyId: 'norte-company', role: 'admin', status: 'active' },
      },
      () =>
        app
          .get(RoundWindowStateService)
          .recalculate(shift.id, [{ roundId: round.id, windowIndex: 0 }]),
    );
    expect(
      await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } }),
    ).toMatchObject({ status: 'in_review', severityLevel: 'grave', inReviewSince: testNow });
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'round_in_review' }),
    );
    const path = `/api/v1/ventanas-ronda/${window.id}`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer token-client')
      .expect(403);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer token-south-admin')
      .expect(404);
    const unassignedRoundName = `Ronda sin asignación ${randomUUID()}`;
    createdRoundNames.push(unassignedRoundName);
    const unassignedRound = await prisma.round.create({
      data: {
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        name: unassignedRoundName,
      },
    });
    const unassignedShift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        serviceDate: new Date('2026-10-12T00:00:00Z'),
        createdById: admin.id,
      },
    });
    createdShiftIds.push(unassignedShift.id);
    const unassignedWindow = await prisma.roundWindowState.create({
      data: {
        companyId: 'norte-company',
        shiftId: unassignedShift.id,
        roundId: unassignedRound.id,
        windowIndex: 0,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        graceEndsAt: window.graceEndsAt,
        status: 'in_review',
        expectedCount: 1,
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/ventanas-ronda/${unassignedWindow.id}`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/ventanas-ronda/${unassignedWindow.id}/validar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ comment: 'Sin acceso al predio' })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/ventanas-ronda/inexistente')
      .set('Authorization', 'Bearer token-admin')
      .expect(404);
    const queue = await request(app.getHttpServer())
      .get('/api/v1/ventanas-ronda/en-revision')
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    await request(app.getHttpServer()).get('/api/v1/ventanas-ronda/en-revision').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/ventanas-ronda/en-revision')
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    expect(z.object({ count: z.number() }).parse(queue.body).count).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .post(`${path}/validar`)
      .set('Authorization', 'Bearer token-client')
      .send({ comment: 'Sin permiso' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${path}/validar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ comment: 'Recorrido verificado por cámara' })
      .expect(201);
    expect(
      await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } }),
    ).toMatchObject({ status: 'complete', inReviewSince: null });
    await request(app.getHttpServer())
      .post(`${path}/validar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ comment: 'Segunda validación' })
      .expect(409);
    await prisma.recordFlag.create({
      data: {
        companyId: 'norte-company',
        checkpointRecordId: secondRecord.id,
        shiftId: shift.id,
        type: 'impossible_time',
        severity: 'grave',
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/registros-puntos/${firstRecord.id}/invalidar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ comment: 'Ubicación simulada' })
      .expect(201);
    expect(
      await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } }),
    ).toMatchObject({ status: 'incomplete', severityLevel: 'grave', recordedCount: 4 });
    expect(notifications).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .post(`/api/v1/registros-puntos/${firstRecord.id}/restituir`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ comment: 'Verificado por cámara' })
      .expect(201);
    for (const record of records)
      await request(app.getHttpServer())
        .post(`/api/v1/registros-puntos/${record.id}/invalidar`)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ comment: 'Registrado desde la garita' })
        .expect(201);
    expect(
      await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } }),
    ).toMatchObject({ status: 'not_done', recordedCount: 0 });
    const detail = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(z.object({ decisions: z.array(z.unknown()) }).parse(detail.body).decisions).toHaveLength(
      8,
    );
    expect(reports).toHaveBeenCalledTimes(8);
    expect(notifications).toHaveBeenCalledTimes(2);
    await prisma.shiftAssignment.updateMany({
      where: { shiftId: shift.id },
      data: { active: false, isCurrent: false },
    });
    reports.mockRestore();
    notifications.mockRestore();
  });

  it('protege los endpoints de supervisión y oculta turnos inexistentes', async () => {
    await request(app.getHttpServer()).get('/api/v1/supervision/turnos').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/supervision/turnos')
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/turnos/turno-inexistente/detalle').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/turnos/turno-inexistente/detalle')
      .set('Authorization', 'Bearer token-client')
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/turnos/turno-inexistente/detalle')
      .set('Authorization', 'Bearer token-admin')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/turnos/turno-inexistente/detalle')
      .set('Authorization', 'Bearer token-supervisor')
      .expect(404);
    const prisma = app.get(PrismaService).systemPrisma;
    const northAdmin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const southAdmin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-sur-admin' },
    });
    const foreignShifts = [
      {
        id: randomUUID(),
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        createdById: northAdmin.id,
      },
      {
        id: randomUUID(),
        companyId: 'sur-company',
        siteId: southSiteId,
        createdById: southAdmin.id,
      },
    ];
    await prisma.shift.createMany({
      data: foreignShifts.map((shift) => ({
        ...shift,
        startsAt: new Date('2026-10-13T10:00:00Z'),
        endsAt: new Date('2026-10-13T13:00:00Z'),
        serviceDate: new Date('2026-10-13T00:00:00Z'),
      })),
    });
    createdShiftIds.push(...foreignShifts.map(({ id }) => id));
    for (const shift of foreignShifts) {
      await request(app.getHttpServer())
        .get(`/api/v1/turnos/${shift.id}/detalle`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(404);
    }
    await request(app.getHttpServer())
      .get('/api/v1/supervision/turnos')
      .set('Authorization', 'Bearer token-admin')
      .expect(200);
  });

  it('mantiene la vista general bajo 300 ms con 100 turnos del mismo predio', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const shiftIds = Array.from({ length: 100 }, () => randomUUID());
    await prisma.shift.createMany({
      data: shiftIds.map((id) => ({
        id,
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-13T10:00:00Z'),
        endsAt: new Date('2026-10-13T13:00:00Z'),
        serviceDate: new Date('2026-10-13T00:00:00Z'),
        createdById: admin.id,
      })),
    });
    createdShiftIds.push(...shiftIds);
    const auth = { Authorization: 'Bearer token-admin' };
    const startedAt = performance.now();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/supervision/turnos?fecha=2026-10-13&predio=${northAssignedSiteId}`)
      .set(auth)
      .expect(200);
    const elapsedMs = performance.now() - startedAt;
    const actualShifts = z.array(z.object({ id: z.string() })).parse(response.body);
    process.stdout.write(`Supervision 100 turnos: ${elapsedMs.toFixed(2)} ms\n`);
    expect(actualShifts).toHaveLength(100);
    expect(elapsedMs).toBeLessThan(300);
  });

  it('marca idempotentemente como no presentado un turno vencido sin inicio', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const id = randomUUID();
    const shift = await prisma.shift.create({
      data: {
        id,
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2020-10-13T08:00:00Z'),
        endsAt: new Date('2020-10-13T11:00:00Z'),
        serviceDate: new Date('2020-10-13T00:00:00Z'),
        createdById: admin.id,
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2020-10-13T08:00:00Z'),
            endsAt: new Date('2020-10-13T11:00:00Z'),
            assignedById: admin.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    const execution = app.get(ShiftExecutionService);
    await expect(execution.markNoShow(id)).resolves.toBe(true);
    await expect(execution.markNoShow(id)).resolves.toBe(false);
    const updated = await prisma.shift.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe('no_show');
    expect(await prisma.shiftEvent.count({ where: { shiftId: id } })).toBe(0);
  });

  it('recalcula la ventana al registrar un punto contado', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const now = testNow;
    const checkpoint = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Punto supervisión ${randomUUID()}`,
        latitude: -34.6,
        longitude: -58.4,
      },
    });
    createdCheckpointIds.push(checkpoint.id);
    const roundName = `Ronda supervisión ${randomUUID()}`;
    createdRoundNames.push(roundName);
    const round = await prisma.round.create({
      data: { companyId: 'norte-company', siteId: northAssignedSiteId, name: roundName },
    });
    const version = await prisma.roundVersion.create({
      data: {
        roundId: round.id,
        versionNumber: 1,
        frequencyMinutes: 60,
        windowStartLocal: '00:00',
        windowEndLocal: '23:00',
        graceMinutes: 15,
        createdById: admin.id,
      },
    });
    await prisma.round.update({ where: { id: round.id }, data: { currentVersionId: version.id } });
    await prisma.roundVersionCheckpoint.create({
      data: {
        companyId: 'norte-company',
        roundVersionId: version.id,
        checkpointId: checkpoint.id,
        position: 0,
      },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date(now.getTime() - 60 * 60_000),
        endsAt: new Date(now.getTime() + 60 * 60_000),
        serviceDate: new Date('2026-10-13T00:00:00Z'),
        createdById: admin.id,
        rounds: { create: { roundId: round.id, roundVersionId: version.id } },
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date(now.getTime() - 60 * 60_000),
            endsAt: new Date(now.getTime() + 60 * 60_000),
            assignedById: admin.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id },
    });
    const window = await prisma.roundWindowState.create({
      data: {
        companyId: 'norte-company',
        shiftId: shift.id,
        roundId: round.id,
        windowIndex: 0,
        startsAt: new Date(now.getTime() - 30 * 60_000),
        endsAt: new Date(now.getTime() + 30 * 60_000),
        graceEndsAt: new Date(now.getTime() + 45 * 60_000),
        expectedCount: 1,
      },
    });
    await prisma.checkpointRecord.create({
      data: {
        companyId: 'norte-company',
        shiftId: shift.id,
        assignmentId: assignment.id,
        checkpointId: checkpoint.id,
        recordId: randomUUID(),
        method: 'qr',
        occurredAtDevice: now,
        locationStatus: 'ok',
        simulation: 'not_simulated',
        phoneNfc: 'on',
        countedFor: [{ roundId: round.id, windowIndex: 0 }],
        requestHash: 'supervision-e2e-record',
      },
    });
    const tenantContext = app.get(TenantContext);
    await tenantContext.run(
      {
        correlationId: randomUUID(),
        user: {
          userId: admin.id,
          companyId: 'norte-company',
          role: 'admin',
          status: 'active',
        },
      },
      () =>
        app
          .get(RoundWindowStateService)
          .recalculate(shift.id, [{ roundId: round.id, windowIndex: 0 }]),
    );
    await expect(
      prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } }),
    ).resolves.toMatchObject({ status: 'complete', recordedCount: 1 });
    await prisma.shiftAssignment.updateMany({
      where: { shiftId: shift.id },
      data: { active: false, isCurrent: false },
    });
  });

  it('autentica Socket.IO y entrega eventos solo en rooms de predios asignados', async () => {
    const server: unknown = app.getHttpServer();
    if (!isHttpServer(server)) throw new Error('No se abrió el servidor e2e');
    if (!server.listening) await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}${SOCKET_NAMESPACE}`;
    const supervisor = io(url, { auth: { token: 'token-supervisor' }, transports: ['websocket'] });
    const noToken = io(url, { transports: ['websocket'], reconnection: false, autoConnect: false });
    const sockets: ClientSocket[] = [supervisor, noToken];
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('El supervisor no conectó'));
        }, 4000);
        supervisor.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
        supervisor.once('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearInterval(interval);
          reject(new Error('El supervisor no ingresó a la room asignada'));
        }, 1000);
        const interval = setInterval(() => {
          const socket = app.get(RealtimeGateway).server.sockets.get(supervisor.id ?? '');
          if (socket?.rooms.has(`site:${northAssignedSiteId}`)) {
            clearTimeout(timeout);
            clearInterval(interval);
            resolve();
          }
        }, 10);
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Socket sin token siguió conectado'));
        }, 2000);
        noToken.once('disconnect', () => {
          clearTimeout(timeout);
          resolve();
        });
        noToken.once('connect_error', () => {
          clearTimeout(timeout);
          resolve();
        });
        noToken.connect();
      });
      let foreignEventReceived = false;
      supervisor.on('registro.nuevo', () => {
        foreignEventReceived = true;
      });
      const realtime = app.get<RealtimePort>(REALTIME_PORT);
      realtime.emitToSite('sur-company', southSiteId, 'registro.nuevo', {
        shiftId: 'foreign-shift',
        siteId: southSiteId,
        checkpointId: 'foreign-point',
        recordId: randomUUID(),
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(foreignEventReceived).toBe(false);
      const event = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('No llegó registro.nuevo dentro de 5 segundos'));
        }, 4500);
        supervisor.once('registro.nuevo', (payload: unknown) => {
          clearTimeout(timeout);
          resolve(payload);
        });
      });
      realtime.emitToSite('norte-company', northAssignedSiteId, 'registro.nuevo', {
        shiftId: 'north-shift',
        siteId: northAssignedSiteId,
        checkpointId: 'north-point',
        recordId: randomUUID(),
      });
      await expect(event).resolves.toMatchObject({ siteId: northAssignedSiteId });
    } finally {
      for (const socket of sockets) socket.disconnect();
    }
  });

  it('HU-18: registra, lista y elimina solo los dispositivos propios', async () => {
    const northAuth = { Authorization: 'Bearer token-admin' };
    const southAuth = { Authorization: 'Bearer token-south-admin' };
    const northToken = `e2e-web-${randomUUID()}`;
    const southToken = `e2e-web-${randomUUID()}`;
    notificationTokens.push(northToken, southToken);

    const created = await request(app.getHttpServer())
      .post('/api/v1/dispositivos')
      .set(northAuth)
      .send({ token: northToken, kind: 'web', platform: 'web' })
      .expect(201);
    const device = deviceSchema.strict().parse(created.body);
    await request(app.getHttpServer())
      .post('/api/v1/dispositivos')
      .send({ token: `e2e-web-unauth-${randomUUID()}`, kind: 'web', platform: 'web' })
      .expect(401);
    const own = await request(app.getHttpServer())
      .get('/api/v1/dispositivos')
      .set(northAuth)
      .expect(200);
    expect(own.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: device.id, platform: 'web' })]),
    );
    await request(app.getHttpServer()).get('/api/v1/dispositivos').expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/dispositivos/${device.id}`).expect(401);

    const south = await request(app.getHttpServer())
      .post('/api/v1/dispositivos')
      .set(southAuth)
      .send({ token: southToken, kind: 'web', platform: 'web' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/dispositivos/${z.object({ id: z.string() }).parse(south.body).id}`)
      .set(northAuth)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/dispositivos/${device.id}`)
      .set(northAuth)
      .expect(200);
  });

  it('HU-14: GET /api/v1/hora es público y no expone recursos de ninguna empresa', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/hora').expect(200);
    const body = serverTimeResponseSchema.strict().parse(response.body);
    expect(Number.isFinite(Date.parse(body.serverTime))).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('crea rondas, conserva las versiones anteriores y valida los permisos', async () => {
    const swagger = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const swaggerDocument: unknown = swagger.body as unknown;
    const swaggerPaths = z
      .object({ paths: z.record(z.string(), z.unknown()) })
      .parse(swaggerDocument).paths;
    expect(Object.keys(swaggerPaths)).toEqual(
      expect.arrayContaining([
        '/api/v1/predios/{id}/rondas',
        '/api/v1/rondas/{id}',
        '/api/v1/rondas/{id}/baja',
        '/api/v1/rondas/previsualizar-ventanas',
        '/api/v1/configuracion/predios',
        '/api/v1/predios/{id}/puntos',
        '/api/v1/puntos/{id}/etiqueta-nfc',
        '/api/v1/turnos',
        '/api/v1/turnos/{id}',
        '/api/v1/turnos/{id}/cancelar',
        '/api/v1/supervision/turnos',
        '/api/v1/turnos/{id}/detalle',
        '/api/v1/mis-turnos',
        '/api/v1/usuarios/{id}/turnos-futuros',
        '/api/v1/usuarios/{id}/desactivar',
        '/api/v1/predios/{id}/impacto-baja',
        '/api/v1/predios/{id}/baja',
        '/api/v1/clientes/{id}/impacto-baja',
        '/api/v1/clientes/{id}/baja',
      ]),
    );
    expect(z.record(z.string(), z.unknown()).parse(swaggerPaths['/api/v1/turnos'])).toHaveProperty(
      'get',
    );
    expect(z.record(z.string(), z.unknown()).parse(swaggerPaths['/api/v1/turnos'])).toHaveProperty(
      'post',
    );
    const auth = { Authorization: 'Bearer token-admin' };
    const points = await app.get(PrismaService).systemPrisma.checkpoint.findMany({
      where: { siteId: northAssignedSiteId, status: 'active' },
      take: 2,
      orderBy: { name: 'asc' },
    });
    const name = `Ronda e2e ${randomUUID()}`;
    createdRoundNames.push(name);
    const payload = {
      name,
      checkpointIds: points.map(({ id }) => id),
      frequencyMinutes: 30,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
    };
    for (const frequencyMinutes of [10, 1500]) {
      await request(app.getHttpServer())
        .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
        .set(auth)
        .send({ ...payload, name: `${name} frecuencia ${frequencyMinutes}`, frequencyMinutes })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .send({ ...payload, name: `${name} gracia`, graceMinutes: 20 })
      .expect(400);
    const otherSitePoint = await app.get(PrismaService).systemPrisma.checkpoint.findFirstOrThrow({
      where: { siteId: northUnassignedSiteId, status: 'active' },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .send({ ...payload, name: `${name} otro predio`, checkpointIds: [otherSitePoint.id] })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .send({ ...payload, checkpointIds: [] })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .send(payload)
      .expect(201);
    const id = z.object({ id: z.string() }).parse(created.body).id;
    const preview = await request(app.getHttpServer())
      .post('/api/v1/rondas/previsualizar-ventanas')
      .set(auth)
      .send({
        frequencyMinutes: 120,
        windowStartLocal: '22:00',
        windowEndLocal: '06:00',
        graceMinutes: 15,
      })
      .expect(200);
    const previewResponse: unknown = preview.body as unknown;
    const previewWindows = z
      .object({ windows: z.array(z.string()) })
      .parse(previewResponse).windows;
    expect(previewWindows).toHaveLength(4);
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .send(payload)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .send({
        ...payload,
        name: `${name} duplicados`,
        checkpointIds: [points[0]?.id, points[0]?.id],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/rondas/${id}`)
      .set(auth)
      .send({ ...payload, checkpointIds: [points[1]?.id] })
      .expect(200);
    const listed = await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set(auth)
      .expect(200);
    const round = z
      .array(z.unknown())
      .parse(listed.body)
      .find((item) => (item as { id?: string }).id === id);
    const versions = await app.get(PrismaService).systemPrisma.roundVersion.findMany({
      where: { roundId: id },
      include: { checkpoints: true },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]?.checkpoints).toHaveLength(2);
    expect(versions[1]?.checkpoints).toHaveLength(1);
    expect(round).toBeDefined();
    await request(app.getHttpServer()).post(`/api/v1/rondas/${id}/baja`).set(auth).expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northUnassignedSiteId}/rondas`)
      .set({ Authorization: 'Bearer token-supervisor' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${southSiteId}/rondas`)
      .set(auth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set({ Authorization: 'Bearer token-client' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .set({ Authorization: 'Bearer token-guard' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}/rondas`)
      .expect(401);
  });

  it('GET /api/v1/health/ready verifica PostgreSQL y Redis', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('agrega las cabeceras de seguridad de helmet', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('responde 404 fuera del prefijo de la API', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(404);
  });

  it('deniega peticiones sin token y tokens inválidos', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer inválido')
      .expect(401);
  });

  it('deniega usuarios desactivados', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer token-deactivated')
      .expect(403);
  });

  it('rechaza usuarios pendientes en endpoints protegidos antes del primer perfil', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/test-only/users/pending-protected')
      .set('Authorization', 'Bearer token-pending')
      .expect(403);
  });

  it('activa al usuario pendiente en su primer GET /auth/me', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer token-pending')
      .expect(200);
    expect(authMeResponseSchema.parse(response.body).status).toBe('active');
  });

  it('devuelve perfil y canales permitidos conforme al esquema compartido', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer token-admin')
      .expect(200);
    expect(authMeResponseSchema.safeParse(response.body).success).toBe(true);
    expect(authMeResponseSchema.parse(response.body).allowedChannels).toEqual(['web', 'mobile']);
  });

  it('bloquea endpoints sin roles declarados', async () => {
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await request(app.getHttpServer())
      .get('/api/v1/test-only/users/unannotated')
      .set('Authorization', 'Bearer token-admin')
      .expect(403);
    expect(
      loggerError.mock.calls.some(
        ([entry]) =>
          isLogEntry(entry) &&
          typeof entry.userId === 'string' &&
          entry.companyId === 'norte-company' &&
          entry.reason === 'endpoint sin roles declarados',
      ),
    ).toBe(true);
    loggerError.mockRestore();
  });

  it('deniega un rol no permitido y registra la denegación', async () => {
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await request(app.getHttpServer())
      .get('/api/v1/test-only/users/admin-only')
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    expect(
      loggerError.mock.calls.some(
        ([entry]) => isLogEntry(entry) && entry.reason === 'rol guard no permitido',
      ),
    ).toBe(true);
    loggerError.mockRestore();
  });

  it('permite al supervisor consultar personal, pero le deniega las mutaciones', async () => {
    const auth = { Authorization: 'Bearer token-supervisor' };
    await request(app.getHttpServer()).get('/api/v1/usuarios').set(auth).expect(200);
    await request(app.getHttpServer()).post('/api/v1/usuarios').set(auth).send({}).expect(403);
    await request(app.getHttpServer()).patch('/api/v1/usuarios/id').set(auth).send({}).expect(403);
    await request(app.getHttpServer()).post('/api/v1/usuarios/id/desactivar').set(auth).expect(403);
    await request(app.getHttpServer()).post('/api/v1/usuarios/id/reactivar').set(auth).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/usuarios/id/reenviar-invitacion')
      .set(auth)
      .expect(403);
  });

  it.each(['seed-norte-admin'])(
    'oculta usuarios que no son personal en todos los endpoints de gestión (%s)',
    async (firebaseUid) => {
      const user = await app.get(PrismaService).systemPrisma.user.findUniqueOrThrow({
        where: { firebaseUid },
        select: { id: true },
      });
      const base = `/api/v1/usuarios/${user.id}`;
      const auth = { Authorization: 'Bearer token-admin' };

      await request(app.getHttpServer()).get(base).set(auth).expect(404);
      await request(app.getHttpServer())
        .patch(base)
        .set(auth)
        .send({ firstName: 'Nombre actualizado' })
        .expect(404);
      await request(app.getHttpServer()).post(`${base}/desactivar`).set(auth).expect(404);
      await request(app.getHttpServer()).post(`${base}/reactivar`).set(auth).expect(404);
      await request(app.getHttpServer()).post(`${base}/reenviar-invitacion`).set(auth).expect(404);
    },
  );

  it.each(['token-guard', 'token-client'])('deniega el listado de personal a %s', async (token) => {
    await request(app.getHttpServer())
      .get('/api/v1/usuarios')
      .set({ Authorization: `Bearer ${token}` })
      .expect(403);
  });

  it('oculta en detalle personal que pertenece a otra empresa', async () => {
    const south = await app.get(PrismaService).systemPrisma.user.findFirstOrThrow({
      where: { companyId: 'sur-company', role: 'guard' },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/usuarios/${south.id}`)
      .set({ Authorization: 'Bearer token-admin' })
      .expect(404);
  });

  it('oculta usuarios de otra empresa con el mismo 404 que un id inexistente', async () => {
    const prisma = app.select(TestOnlyModule).get(PrismaService);
    const foreign = await prisma.systemPrisma.user.findFirstOrThrow({
      where: { companyId: 'sur-company' },
      select: { id: true },
    });
    const auth = { Authorization: 'Bearer token-admin' };
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const foreignResponse = await request(app.getHttpServer())
      .get(`/api/v1/test-only/users/${foreign.id}`)
      .set(auth)
      .expect(404);
    const missingResponse = await request(app.getHttpServer())
      .get('/api/v1/test-only/users/id-inexistente')
      .set(auth)
      .expect(404);
    expect(foreignResponse.body).toEqual(missingResponse.body);
    expect(
      loggerError.mock.calls.some(
        ([entry]) =>
          isLogEntry(entry) &&
          entry.reason === 'intento de acceso a recurso de otra empresa' &&
          typeof entry.userId === 'string' &&
          typeof entry.companyId === 'string' &&
          typeof entry.resourceId === 'string' &&
          typeof entry.model === 'string' &&
          typeof entry.endpoint === 'string' &&
          typeof entry.correlationId === 'string',
      ),
    ).toBe(true);
    loggerError.mockRestore();
  });

  it('rechaza modelos no registrados en findOwnedOrThrow', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/test-only/users/unregistered/irrelevante')
      .set('Authorization', 'Bearer token-admin')
      .expect(403);
  });

  it('filtra lecturas, actualizaciones y eliminaciones sin companyId manual', async () => {
    const headers = { Authorization: 'Bearer token-admin' };
    const visible = await request(app.getHttpServer())
      .get('/api/v1/test-only/users/all')
      .set(headers)
      .expect(200);
    const visibleUsers = z
      .array(z.object({ id: z.string(), companyId: z.string() }))
      .parse(visible.body);
    expect(visibleUsers.every((record) => record.companyId === 'norte-company')).toBe(true);

    const prisma = app.select(TestOnlyModule).get(PrismaService);
    const foreign = await prisma.systemPrisma.user.findFirstOrThrow({
      where: { companyId: 'sur-company' },
      select: { id: true, firstName: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/test-only/users/${foreign.id}`)
      .set(headers)
      .expect(200)
      .expect({ count: 0 });
    await request(app.getHttpServer())
      .delete(`/api/v1/test-only/users/${foreign.id}`)
      .set(headers)
      .expect(200)
      .expect({ count: 0 });
    await expect(
      prisma.systemPrisma.user.findUniqueOrThrow({ where: { id: foreign.id } }),
    ).resolves.toMatchObject({ firstName: foreign.firstName, companyId: 'sur-company' });
  });

  it('falla cerrado sin contexto y limita Company a la raíz tenant autenticada', async () => {
    const prisma = app.select(TestOnlyModule).get(PrismaService);
    await expect(prisma.tenantPrisma.user.findMany()).rejects.toBeInstanceOf(ForbiddenException);

    const response = await request(app.getHttpServer())
      .get('/api/v1/test-only/users/companies')
      .set('Authorization', 'Bearer token-admin')
      .expect(200);
    expect(z.array(z.object({ id: z.string() })).parse(response.body)).toEqual([
      { id: 'norte-company' },
    ]);
  });

  it('aplica el filtro de empresa dentro de tenantPrisma.$transaction', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/test-only/users/transaction')
      .set('Authorization', 'Bearer token-admin')
      .expect(200);
    const users = z.array(z.object({ id: z.string(), companyId: z.string() })).parse(response.body);
    expect(users.length).toBeGreaterThan(0);
    expect(users.every(({ companyId }) => companyId === 'norte-company')).toBe(true);
  });

  it('filtra los predios asignados en cada solicitud del supervisor y revoca el acceso inmediatamente', async () => {
    const headers = { Authorization: 'Bearer token-supervisor' };
    const visible = await request(app.getHttpServer())
      .get('/api/v1/predios')
      .set(headers)
      .expect(200);
    expect(
      z
        .array(z.object({ id: z.string(), company: z.object({ timezone: z.string() }) }))
        .parse(visible.body)
        .map(({ id }) => id),
    ).toContain(northAssignedSiteId);
    expect(
      z
        .array(z.object({ id: z.string(), company: z.object({ timezone: z.string() }) }))
        .parse(visible.body)
        .find(({ id }) => id === northAssignedSiteId)?.company.timezone,
    ).toBe('America/Argentina/Buenos_Aires');
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northUnassignedSiteId}`)
      .set(headers)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${southSiteId}`)
      .set(headers)
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
      .set('Authorization', 'Bearer token-admin')
      .send({ supervisorIds: [] })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}`)
      .set(headers)
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
      .set('Authorization', 'Bearer token-admin')
      .send({ supervisorIds: [northSupervisorId] })
      .expect(200);
  });

  it('no expone el total de predios no asignados en el conteo del cliente al supervisor', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/clientes')
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    const clients = z
      .array(z.object({ id: z.string(), _count: z.object({ sites: z.number() }) }))
      .parse(list.body);
    const northClient = await app.get(PrismaService).systemPrisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
    });
    const client = clients.find(({ id }) => id === northClient.id);
    expect(client?._count.sites).toBe(1);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/clientes/${northClient.id}`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    const detailBody = z
      .object({ _count: z.object({ sites: z.number() }), sites: z.array(z.unknown()) })
      .parse(detail.body);
    expect(detailBody._count.sites).toBe(1);
    expect(detailBody.sites).toHaveLength(1);
  });

  it('rechaza IDs de supervisores duplicados con 400 sin producir error de base de datos', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
      .set('Authorization', 'Bearer token-admin')
      .send({ supervisorIds: [northSupervisorId, northSupervisorId] })
      .expect(400);
  });

  it('filtra también los predios anidados cuando un servicio consulta clientes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/test-only/users/clients-with-sites')
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    const clients = z
      .array(z.object({ sites: z.array(z.object({ id: z.string() })) }))
      .parse(response.body);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.sites.map(({ id }) => id)).toEqual([northAssignedSiteId]);
  });

  it('lista las opciones de supervisor para el admin y los predios asignados para el usuario', async () => {
    const supervisors = await request(app.getHttpServer())
      .get('/api/v1/predios/supervisores-disponibles')
      .set('Authorization', 'Bearer token-admin')
      .expect(200);
    expect(
      z
        .array(z.object({ id: z.string(), status: z.string() }))
        .parse(supervisors.body)
        .some(({ id }) => id === northSupervisorId),
    ).toBe(true);
    await request(app.getHttpServer())
      .get('/api/v1/predios/supervisores-disponibles')
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    const assignedSites = await request(app.getHttpServer())
      .get(`/api/v1/usuarios/${northSupervisorId}/predios`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(
      z
        .array(z.object({ id: z.string(), hasOtherActiveSupervisor: z.boolean() }))
        .parse(assignedSites.body),
    ).toEqual([
      expect.objectContaining({ id: northAssignedSiteId, hasOtherActiveSupervisor: false }),
    ]);
  });

  it('rechaza coordenadas inválidas, roles no permitidos y usuarios que no sean supervisores', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const northClient = await prisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
    });
    await request(app.getHttpServer())
      .post('/api/v1/predios')
      .set('Authorization', 'Bearer token-admin')
      .send({
        clientId: northClient.id,
        name: 'Fuera de rango',
        address: 'Calle 1',
        latitude: 91,
        longitude: 0,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/clientes')
      .set('Authorization', 'Bearer token-guard')
      .send({ name: 'No', contactName: 'No', phone: '123', email: 'n@example.invalid' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/clientes')
      .set('Authorization', 'Bearer token-client')
      .send({ name: 'No', contactName: 'No', phone: '123', email: 'n@example.invalid' })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
      .set('Authorization', 'Bearer token-admin')
      .send({ supervisorIds: [northGuardId] })
      .expect(404);
  });

  it('no permite al admin de otra empresa consultar un cliente ajeno', async () => {
    const southClient = await app.get(PrismaService).systemPrisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'sur-company', name: 'Cliente sur' } },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/clientes/${southClient.id}`)
      .set('Authorization', 'Bearer token-admin')
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/predios/${northAssignedSiteId}`)
      .set('Authorization', 'Bearer token-south-admin')
      .expect(404);
  });

  it('impide solapamientos de asignaciones vigentes en PostgreSQL y libera el rango al cancelar', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const startsAt = new Date('2035-01-01T01:00:00.000Z');
    const endsAt = new Date('2035-01-01T09:00:00.000Z');
    const first = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt,
        endsAt,
        serviceDate: new Date('2035-01-01T00:00:00.000Z'),
        createdById: admin.id,
      },
    });
    const second = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        endsAt: new Date(endsAt.getTime() + 60 * 60 * 1000),
        serviceDate: new Date('2035-01-01T00:00:00.000Z'),
        createdById: admin.id,
      },
    });
    try {
      const assignment = {
        guardId: northGuardId,
        startsAt,
        endsAt,
        assignedById: admin.id,
      };
      await prisma.shiftAssignment.create({ data: { shiftId: first.id, ...assignment } });
      const overlapError: unknown = await prisma.shiftAssignment
        .create({ data: { shiftId: second.id, ...assignment } })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(isShiftOverlapViolation(overlapError)).toBe(true);
      await expect(
        prisma.shiftAssignment.create({
          data: { shiftId: second.id, ...assignment, guardId: null },
        }),
      ).resolves.toMatchObject({ guardId: null });
      await prisma.shiftAssignment.updateMany({
        where: { shiftId: first.id },
        data: { active: false },
      });
      await expect(
        prisma.shiftAssignment.create({ data: { shiftId: second.id, ...assignment } }),
      ).resolves.toMatchObject({ guardId: northGuardId });
    } finally {
      await prisma.shift.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    }
  });

  it('crea, edita y cancela turnos con ventanas esperadas y valida inicio, duración y cobertura', async () => {
    const notifications = jest
      .spyOn(app.get(NotificationsService), 'notifyUsers')
      .mockResolvedValue();
    const prisma = app.get(PrismaService).systemPrisma;
    const round = await prisma.round.findUniqueOrThrow({
      where: { siteId_name: { siteId: northAssignedSiteId, name: 'Perimetral' } },
    });
    const requestShift = {
      siteId: northAssignedSiteId,
      guardId: northGuardId,
      startsAt: '2026-10-14T23:00:00.000Z',
      endsAt: '2026-10-15T11:00:00.000Z',
      roundIds: [round.id],
    };
    const auth = { Authorization: 'Bearer token-admin' };
    const created = await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send(requestShift)
      .expect(201);
    const createdBody = z
      .object({
        id: z.string(),
        status: z.string(),
        windows: z.array(z.object({ shiftId: z.string().nullable() })),
      })
      .parse(created.body);
    createdShiftIds.push(createdBody.id);
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [northGuardId],
        kind: 'shift_assigned',
        payload: expect.objectContaining({
          kind: 'shift_assigned',
          link: `/turno/${createdBody.id}`,
        }) as unknown,
      }),
    );
    expect(createdBody.status).toBe('scheduled');
    expect(createdBody.windows.filter((window) => window.shiftId === createdBody.id)).toHaveLength(
      4,
    );

    const conflict = await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send(requestShift)
      .expect(409);
    expect(
      z
        .object({ code: z.literal('SHIFT_OVERLAP'), shift: z.object({ id: z.string() }) })
        .parse(conflict.body).shift.id,
    ).toBe(createdBody.id);

    await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send({
        ...requestShift,
        startsAt: '2026-10-14T11:00:00.000Z',
        endsAt: '2026-10-14T19:00:00.000Z',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send({ ...requestShift, startsAt: '2026-10-13T11:00:00.000Z' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send({ ...requestShift, endsAt: '2026-10-14T23:30:00.000Z' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send({ ...requestShift, endsAt: '2026-10-16T00:00:00.000Z' })
      .expect(400);

    const pending = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-pending' },
    });
    await prisma.user.update({ where: { id: pending.id }, data: { status: 'invitation_pending' } });
    const pendingShift = await request(app.getHttpServer())
      .post('/api/v1/turnos')
      .set(auth)
      .send({
        ...requestShift,
        guardId: pending.id,
        startsAt: '2026-10-16T23:00:00.000Z',
        endsAt: '2026-10-17T11:00:00.000Z',
      })
      .expect(201);
    const pendingId = z.object({ id: z.string() }).parse(pendingShift.body).id;
    createdShiftIds.push(pendingId);
    expect(
      z.object({ invitationPending: z.boolean() }).parse(pendingShift.body).invitationPending,
    ).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/v1/turnos/${createdBody.id}`)
      .set(auth)
      .send({ ...requestShift, endsAt: '2026-10-15T12:00:00.000Z' })
      .expect(200);
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [northGuardId],
        kind: 'shift_changed',
      }),
    );
    const mine = await request(app.getHttpServer())
      .get('/api/v1/mis-turnos')
      .set({ Authorization: 'Bearer token-guard' })
      .expect(200);
    expect(
      z
        .array(z.object({ id: z.string() }))
        .parse(mine.body)
        .map(({ id }) => id),
    ).toContain(createdBody.id);
    await request(app.getHttpServer())
      .post(`/api/v1/turnos/${createdBody.id}/cancelar`)
      .set(auth)
      .expect(201);
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [northGuardId],
        kind: 'shift_cancelled',
      }),
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/turnos/${pendingId}`)
      .set(auth)
      .send({
        ...requestShift,
        guardId: null,
        startsAt: '2026-10-16T23:00:00.000Z',
        endsAt: '2026-10-17T11:00:00.000Z',
      })
      .expect(200);
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [pending.id],
        kind: 'shift_removed',
      }),
    );
    for (const [input] of notifications.mock.calls)
      expect(JSON.stringify(input.payload)).not.toMatch(/Predio|Calle|Perimetral/);
    await request(app.getHttpServer())
      .patch(`/api/v1/turnos/${createdBody.id}`)
      .set(auth)
      .send(requestShift)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/turnos/${createdBody.id}/cancelar`)
      .set(auth)
      .expect(409);
    notifications.mockRestore();
  });

  it.each(['supervisor', 'guard', 'client'] as const)(
    'deniega al rol %s todas las operaciones de escritura de clientes y predios',
    async (role) => {
      const token = `token-${role}`;
      const auth = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService).systemPrisma;
      const client = await prisma.client.findUniqueOrThrow({
        where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
      });
      const body = {
        name: 'Sin permiso',
        contactName: 'Nadie',
        phone: '12345678',
        email: 'n@example.invalid',
      };
      await request(app.getHttpServer()).post('/api/v1/clientes').set(auth).send(body).expect(403);
      await request(app.getHttpServer())
        .patch(`/api/v1/clientes/${client.id}`)
        .set(auth)
        .send(body)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/clientes/${client.id}/baja`)
        .set(auth)
        .expect(403);
      const site = {
        clientId: client.id,
        name: 'Sin permiso',
        address: 'Calle 1',
        latitude: -34,
        longitude: -58,
      };
      await request(app.getHttpServer()).post('/api/v1/predios').set(auth).send(site).expect(403);
      await request(app.getHttpServer())
        .patch(`/api/v1/predios/${northAssignedSiteId}`)
        .set(auth)
        .send(site)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/predios/${northAssignedSiteId}/baja`)
        .set(auth)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
        .set(auth)
        .expect(403);
      await request(app.getHttpServer())
        .put(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
        .set(auth)
        .send({ supervisorIds: [] })
        .expect(403);
    },
  );

  it.each(['guard', 'client'] as const)(
    'deniega lecturas de clientes y predios al rol %s',
    async (role) => {
      const auth = { Authorization: `Bearer token-${role}` };
      const prisma = app.get(PrismaService).systemPrisma;
      const client = await prisma.client.findUniqueOrThrow({
        where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
      });
      await request(app.getHttpServer()).get('/api/v1/clientes').set(auth).expect(403);
      await request(app.getHttpServer()).get(`/api/v1/clientes/${client.id}`).set(auth).expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/predios')
        .set(auth)
        .expect(role === 'client' ? 200 : 403);
      await request(app.getHttpServer())
        .get(`/api/v1/predios/${northAssignedSiteId}`)
        .set(auth)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/predios/${northAssignedSiteId}/supervisores`)
        .set(auth)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/usuarios/${northSupervisorId}/predios`)
        .set(auth)
        .expect(403);
    },
  );

  it('marca un predio sin supervisores activos cuando la asignación sigue a un usuario desactivado', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    await prisma.user.update({ where: { id: northSupervisorId }, data: { status: 'deactivated' } });
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/predios')
        .set('Authorization', 'Bearer token-admin')
        .expect(200);
      const sites = z
        .array(z.object({ id: z.string(), hasActiveSupervisor: z.boolean() }))
        .parse(response.body);
      expect(sites.find(({ id }) => id === northAssignedSiteId)?.hasActiveSupervisor).toBe(false);
      await expect(
        prisma.siteSupervisor.count({
          where: { siteId: northAssignedSiteId, userId: northSupervisorId },
        }),
      ).resolves.toBe(1);
    } finally {
      await prisma.user.update({ where: { id: northSupervisorId }, data: { status: 'active' } });
    }
  });

  it('crea clientes con unicidad por empresa y da de baja en cascada los predios y sus asignaciones', async () => {
    const name = `Cliente e2e ${randomUUID()}`;
    const body = {
      name,
      contactName: 'Contacto E2E',
      phone: '+541112345678',
      email: 'e2e@example.invalid',
    };
    const createdClient = await request(app.getHttpServer())
      .post('/api/v1/clientes')
      .set('Authorization', 'Bearer token-admin')
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/clientes')
      .set('Authorization', 'Bearer token-admin')
      .send(body)
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/clientes')
      .set('Authorization', 'Bearer token-south-admin')
      .send(body)
      .expect(201);
    const clientId = z.object({ id: z.string() }).parse(createdClient.body).id;
    const siteBody = {
      clientId,
      name: 'Sede E2E',
      address: 'Calle 1',
      latitude: -34.6,
      longitude: -58.4,
    };
    const createdSite = await request(app.getHttpServer())
      .post('/api/v1/predios')
      .set('Authorization', 'Bearer token-admin')
      .send(siteBody)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/predios')
      .set('Authorization', 'Bearer token-admin')
      .send(siteBody)
      .expect(409);
    const siteId = z.object({ id: z.string() }).parse(createdSite.body).id;
    await request(app.getHttpServer())
      .put(`/api/v1/predios/${siteId}/supervisores`)
      .set('Authorization', 'Bearer token-admin')
      .send({ supervisorIds: [northSupervisorId] })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/clientes/${clientId}/baja`)
      .set('Authorization', 'Bearer token-admin')
      .expect(201);
    const prisma = app.get(PrismaService).systemPrisma;
    await expect(prisma.site.findUniqueOrThrow({ where: { id: siteId } })).resolves.toMatchObject({
      status: 'inactive',
    });
    await expect(prisma.siteSupervisor.count({ where: { siteId } })).resolves.toBe(0);
    await request(app.getHttpServer())
      .get('/api/v1/predios?estado=active')
      .set('Authorization', 'Bearer token-admin')
      .expect(200)
      .then(({ body: rows }) => {
        expect(
          z
            .array(z.object({ id: z.string() }))
            .parse(rows)
            .map(({ id }) => id),
        ).not.toContain(siteId);
      });
  });

  it('asigna la empresa del contexto al crear aunque data incluya otra empresa', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/test-only/users/create-spoofed')
      .set('Authorization', 'Bearer token-admin')
      .expect(201);
    expect(z.object({ id: z.string(), companyId: z.string() }).parse(created.body).companyId).toBe(
      'norte-company',
    );
  });

  it('actualiza campos de invitación propia y deja intacta una invitación ajena', async () => {
    const auth = { Authorization: 'Bearer token-admin' };
    await request(app.getHttpServer())
      .patch(`/api/v1/test-only/users/invitations/${northInvitationId}`)
      .set(auth)
      .expect(200)
      .expect({ count: 1 });
    await request(app.getHttpServer())
      .patch(`/api/v1/test-only/users/invitations/${southInvitationId}`)
      .set(auth)
      .expect(200)
      .expect({ count: 0 });

    const prisma = app.get(PrismaService).systemPrisma;
    await expect(
      prisma.invitation.findUniqueOrThrow({ where: { id: northInvitationId } }),
    ).resolves.toMatchObject({ sendStatus: 'sent', usedAt: new Date('2026-01-01T00:00:00.000Z') });
    await expect(
      prisma.invitation.findUniqueOrThrow({ where: { id: southInvitationId } }),
    ).resolves.toMatchObject({ sendStatus: 'pending', usedAt: null });
  });

  it.each(['query', 'execute', 'query-unsafe', 'execute-unsafe'])(
    'deniega SQL crudo en tenantPrisma (%s)',
    async (kind) => {
      await request(app.getHttpServer())
        .get(`/api/v1/test-only/users/raw/${kind}`)
        .set('Authorization', 'Bearer token-admin')
        .expect(403);
    },
  );

  it('asocia, reemplaza, mueve, rechaza otra empresa y quita etiquetas NFC', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const makePoint = async (siteId: string, label: string) => {
      const row = await prisma.checkpoint.create({
        data: {
          companyId: siteId === southSiteId ? 'sur-company' : 'norte-company',
          siteId,
          name: `NFC ${label} ${randomUUID()}`,
          latitude: -34.6,
          longitude: -58.4,
        },
      });
      createdNfcCheckpointIds.push(row.id);
      return row;
    };
    const pointA = await makePoint(northAssignedSiteId, 'A');
    const pointB = await makePoint(northAssignedSiteId, 'B');
    const southPoint = await makePoint(southSiteId, 'Sur');
    const base = request(app.getHttpServer());
    const put = (pointId: string, uid: string, confirmMove?: boolean) =>
      base
        .put(`/api/v1/puntos/${pointId}/etiqueta-nfc`)
        .set('Authorization', 'Bearer token-admin')
        .send({ uid, ...(confirmMove === undefined ? {} : { confirmMove }) });
    const freeUid = `04${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
    await put(pointA.id, freeUid.toLowerCase())
      .expect(200)
      .expect(({ body }) => {
        expect(z.object({ status: z.string() }).parse(body).status).toBe('active');
      });
    await put(pointA.id, `04:${freeUid.slice(2, 4)}-${freeUid.slice(4)}`).expect(200);
    const replacementUid = `05${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
    await put(pointA.id, replacementUid).expect(200);
    expect(
      await prisma.nfcTag.findFirstOrThrow({ where: { checkpointId: pointA.id, uid: freeUid } }),
    ).toMatchObject({ status: 'replaced', endedById: admin.id });
    await put(pointB.id, replacementUid).expect(409);
    await put(pointB.id, replacementUid, true).expect(200);
    expect(
      await prisma.nfcTag.findFirstOrThrow({
        where: { checkpointId: pointA.id, uid: replacementUid },
      }),
    ).toMatchObject({ status: 'replaced' });
    const foreignUid = `06${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
    await base
      .put(`/api/v1/puntos/${southPoint.id}/etiqueta-nfc`)
      .set('Authorization', 'Bearer token-south-admin')
      .send({ uid: foreignUid })
      .expect(200);
    await put(pointA.id, foreignUid)
      .expect(422)
      .expect(({ body }) => {
        expect(z.object({ message: z.string() }).parse(body).message).toBe(
          'Etiqueta no disponible',
        );
        expect(JSON.stringify(body)).not.toContain('sur-company');
      });
    await base
      .delete(`/api/v1/puntos/${pointB.id}/etiqueta-nfc`)
      .set('Authorization', 'Bearer token-admin')
      .expect(200);
    const nowReusable = await prisma.nfcTag.findFirstOrThrow({
      where: { checkpointId: pointB.id, uid: replacementUid },
    });
    expect(nowReusable.status).toBe('removed');
  });

  it('expone los predios de configuración y aplica permisos del modo NFC', async () => {
    const client = request(app.getHttpServer());
    await client.get('/api/v1/configuracion/predios').expect(401);
    await client
      .get('/api/v1/configuracion/predios')
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    await client
      .get('/api/v1/configuracion/predios')
      .set('Authorization', 'Bearer token-client')
      .expect(403);
    await client
      .get('/api/v1/configuracion/predios')
      .set('Authorization', 'Bearer token-admin')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: northAssignedSiteId }),
            expect.objectContaining({ id: northUnassignedSiteId }),
          ]),
        );
      });
    await client
      .get('/api/v1/configuracion/predios')
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200)
      .expect(({ body }) => {
        expect(
          z
            .array(z.object({ id: z.string() }))
            .parse(body)
            .map(({ id }) => id),
        ).toEqual([northAssignedSiteId]);
      });
    const pointOutsideAssignment = await app
      .get(PrismaService)
      .systemPrisma.checkpoint.findFirstOrThrow({ where: { siteId: northUnassignedSiteId } });
    await client
      .put(`/api/v1/puntos/${pointOutsideAssignment.id}/etiqueta-nfc`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ uid: 'A1B2C3D4' })
      .expect(404);
  });

  it('configura por APDU una etiqueta simulada, exige prueba SUN y aísla sesiones', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const point = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Secure NFC ${randomUUID()}`,
        latitude: -34.6,
        longitude: -58.4,
      },
    });
    createdNfcCheckpointIds.push(point.id);
    const uid = `04${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const version = `0404083000110504040201011105${uid}00000000000000`;
    const path = `/api/v1/puntos/${point.id}/etiqueta-segura/configuracion`;
    const client = request(app.getHttpServer());
    await client.post(path).send({ uid, version }).expect(401);
    await client
      .post(path)
      .set('Authorization', 'Bearer token-guard')
      .send({ uid, version })
      .expect(403);
    await client
      .post(path)
      .set('Authorization', 'Bearer token-client')
      .send({ uid, version })
      .expect(403);
    await client
      .post(path)
      .set('Authorization', 'Bearer token-south-admin')
      .send({ uid, version })
      .expect(404);
    const otherPoint = await prisma.checkpoint.findFirstOrThrow({
      where: { siteId: northUnassignedSiteId },
    });
    await client
      .post(`/api/v1/puntos/${otherPoint.id}/etiqueta-segura/configuracion`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ uid, version })
      .expect(404);
    const auth = { Authorization: 'Bearer token-admin' };
    const start = await client.post(path).set(auth).send({ uid, version }).expect(201);
    const startBody = z.object({ sessionId: z.string(), apdu: z.string() }).parse(start.body);
    expect(startBody.apdu).toBe('9071000002000000');
    expect(await prisma.nfcTag.findFirstOrThrow({ where: { uid } })).toMatchObject({
      status: 'removed',
      configurationStatus: 'incomplete',
      kind: 'basic',
    });
    const commandPath = `/api/v1/etiquetas-seguras/configuracion/${startBody.sessionId}/comando`;
    await client.post(commandPath).send({ response: '9100' }).expect(401);
    await client
      .post(commandPath)
      .set('Authorization', 'Bearer token-guard')
      .send({ response: '9100' })
      .expect(403);
    await client
      .post(commandPath)
      .set('Authorization', 'Bearer token-south-admin')
      .send({ response: '9100' })
      .expect(404);
    const rndB = Buffer.from('B9E2FC789B64BF237CCCAA20EC7E6E48', 'hex');
    const firstResponse = Buffer.concat([
      aesCbc(FACTORY_KEY, Buffer.alloc(16), rndB),
      Buffer.from('91AF', 'hex'),
    ]);
    const first = await client
      .post(commandPath)
      .set(auth)
      .send({ response: firstResponse.toString('hex') })
      .expect(201);
    const firstBody = z.object({ apdu: z.string() }).parse(first.body);
    const challenge = aesCbc(
      FACTORY_KEY,
      Buffer.alloc(16),
      Buffer.from(firstBody.apdu.slice(10, -2), 'hex'),
      true,
    );
    const rndA = challenge.subarray(0, 16);
    const ti = Buffer.from('9D00C4DF', 'hex');
    const rotated = Buffer.concat([rndA.subarray(1), rndA.subarray(0, 1)]);
    const secondResponse = Buffer.concat([
      aesCbc(FACTORY_KEY, Buffer.alloc(16), Buffer.concat([ti, rotated, Buffer.alloc(12)])),
      Buffer.from('9100', 'hex'),
    ]);
    let step = z.object({ apdu: z.string().nullable(), complete: z.boolean() }).parse(
      (
        await client
          .post(commandPath)
          .set(auth)
          .send({ response: secondResponse.toString('hex') })
          .expect(201)
      ).body,
    );
    const keys = sessionKeys(FACTORY_KEY, {
      rndA: rndA.toString('hex'),
      rndB: rndB.toString('hex'),
      ti: ti.toString('hex'),
    });
    for (let counter = 0; counter < 7; counter++) {
      expect(step.apdu).not.toBeNull();
      const ctr = Buffer.alloc(2);
      ctr.writeUInt16LE(counter + 1);
      const response =
        counter === 6
          ? '9100'
          : Buffer.concat([
              truncateMac(aesCmac(keys.mac, Buffer.concat([Buffer.from([0]), ctr, ti]))),
              Buffer.from('9100', 'hex'),
            ]).toString('hex');
      step = z
        .object({ apdu: z.string().nullable(), complete: z.boolean() })
        .parse((await client.post(commandPath).set(auth).send({ response }).expect(201)).body);
    }
    expect(step).toEqual({ apdu: null, complete: true });
    const masterHex =
      app.get(ConfigService).get<string>('NFC_MASTER_KEY') ??
      Buffer.alloc(16, 0x11).toString('hex');
    const master = Buffer.from(masterHex, 'hex');
    const uidBytes = Buffer.from(uid, 'hex');
    const counter = Buffer.from('010000', 'hex');
    const picc = Buffer.concat([Buffer.from([0xc7]), uidBytes, counter, Buffer.alloc(5)]);
    const encrypted = aesCbc(deriveTagKey(master, uidBytes, 2, 1), Buffer.alloc(16), picc);
    const sessionKey = aesCmac(
      deriveTagKey(master, uidBytes, 1, 1),
      Buffer.concat([Buffer.from('3CC300010080', 'hex'), uidBytes, counter]),
    );
    const proof = `garita:nfc?e=${encrypted.toString('hex')}&c=${truncateMac(aesCmac(sessionKey, Buffer.alloc(0))).toString('hex')}`;
    const confirmPath = `/api/v1/etiquetas-seguras/configuracion/${startBody.sessionId}/confirmar`;
    await client.post(confirmPath).set(auth).send({ sdmMessage: proof }).expect(201);
    expect(await prisma.nfcTag.findFirstOrThrow({ where: { uid } })).toMatchObject({
      status: 'active',
      kind: 'secure',
      configurationStatus: 'configured',
      lastCounter: 1,
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2028-01-10T10:00:00.000Z'),
        endsAt: new Date('2028-01-10T18:00:00.000Z'),
        serviceDate: new Date('2028-01-10T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        startedAt: new Date('2028-01-10T10:00:00.000Z'),
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2028-01-10T10:00:00.000Z'),
            endsAt: new Date('2028-01-10T18:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    const makeSun = (readCounter: number) => {
      const count = Buffer.alloc(3);
      count.writeUIntLE(readCounter, 0, 3);
      const encryptedPicc = aesCbc(
        deriveTagKey(master, uidBytes, 2, 1),
        Buffer.alloc(16),
        Buffer.concat([Buffer.from([0xc7]), uidBytes, count, Buffer.alloc(5)]),
      );
      const macKey = aesCmac(
        deriveTagKey(master, uidBytes, 1, 1),
        Buffer.concat([Buffer.from('3CC300010080', 'hex'), uidBytes, count]),
      );
      return `garita:nfc?e=${encryptedPicc.toString('hex')}&c=${truncateMac(aesCmac(macKey, Buffer.alloc(0))).toString('hex')}`;
    };
    const postRead = async (sdmMessage?: string) => {
      const recordId = randomUUID();
      await client
        .post('/api/v1/registros-puntos')
        .set('Authorization', 'Bearer token-guard')
        .send({
          recordId,
          shiftId: shift.id,
          method: 'nfc',
          scannedValue: uid,
          ...(sdmMessage ? { sdmMessage } : {}),
          occurredAtDevice: '2028-01-10T12:00:00.000Z',
          location: {
            status: 'ok',
            latitude: -34.6,
            longitude: -58.4,
            accuracyMeters: 5,
            simulation: 'not_simulated',
            takenAt: '2028-01-10T12:00:00.000Z',
          },
          phoneNfc: 'on',
        })
        .expect(200);
      return prisma.checkpointRecord.findUniqueOrThrow({
        where: { recordId },
        include: { flags: true },
      });
    };
    for (const count of [2, 3]) {
      const valid = await postRead(makeSun(count));
      expect(valid.sdmResult).toBe('valid');
      expect(
        valid.flags.some(
          (flag) => flag.type === 'tag_not_authentic' || flag.type === 'replayed_read',
        ),
      ).toBe(false);
    }
    const invalidSun = makeSun(4);
    const bad = await postRead(invalidSun.slice(0, -1) + (invalidSun.endsWith('0') ? '1' : '0'));
    expect(bad.sdmResult).toBe('invalid_signature');
    expect(bad.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tag_not_authentic', severity: 'grave' }),
      ]),
    );
    const missing = await postRead();
    expect(missing.sdmResult).toBe('missing');
    expect(missing.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tag_not_authentic', severity: 'grave' }),
      ]),
    );
    const replay = await postRead(makeSun(3));
    expect(replay.sdmResult).toBe('replayed');
    expect(replay.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'replayed_read', severity: 'grave' }),
      ]),
    );
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id, guardId: northGuardId },
    });
    const credentialService = app.get(ShiftCredentialService);
    const { token: credToken } = await credentialService.issueCredential({
      shiftId: shift.id,
      assignmentId: assignment.id,
      userId: northGuardId,
      companyId: 'norte-company',
      scheduledEnd: shift.endsAt,
    });
    const batchRecordId = randomUUID();
    await client
      .post('/api/v1/sincronizacion/eventos')
      .set('Authorization', `Bearer ${credToken}`)
      .send({
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: null,
        events: [
          {
            type: 'checkpoint_record',
            payload: {
              recordId: batchRecordId,
              shiftId: shift.id,
              method: 'nfc',
              scannedValue: uid,
              sdmMessage: makeSun(5),
              occurredAtDevice: '2028-01-10T12:05:00.000Z',
              location: {
                status: 'ok',
                latitude: -34.6,
                longitude: -58.4,
                accuracyMeters: 5,
                simulation: 'not_simulated',
                takenAt: '2028-01-10T12:05:00.000Z',
              },
              phoneNfc: 'on',
            },
          },
        ],
      })
      .expect(200);
    const batchSaved = await prisma.checkpointRecord.findUniqueOrThrow({
      where: { recordId: batchRecordId },
      include: { flags: true },
    });
    expect(batchSaved.sdmResult).toBe('valid');
    expect(
      batchSaved.flags.some(
        (flag) => flag.type === 'tag_not_authentic' || flag.type === 'replayed_read',
      ),
    ).toBe(false);
    const interruptedUid = `04${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    await client.post(path).set(auth).send({ uid: interruptedUid, version }).expect(201);
    expect(await prisma.nfcTag.findFirstOrThrow({ where: { uid: interruptedUid } })).toMatchObject({
      status: 'removed',
      configurationStatus: 'incomplete',
    });
    const southPoint = await prisma.checkpoint.create({
      data: {
        companyId: 'sur-company',
        siteId: southSiteId,
        name: `Secure sur ${randomUUID()}`,
        latitude: -34.6,
        longitude: -58.4,
      },
    });
    createdNfcCheckpointIds.push(southPoint.id);
    await prisma.nfcTag.create({
      data: {
        companyId: 'sur-company',
        checkpointId: southPoint.id,
        uid: `04${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        associatedById: actor.id,
        kind: 'secure',
        status: 'removed',
      },
    });
    const foreign = await prisma.nfcTag.findFirstOrThrow({
      where: { checkpointId: southPoint.id },
    });
    const foreignResponse = await client
      .post(path)
      .set(auth)
      .send({ uid: foreign.uid, version })
      .expect(422);
    expect(z.object({ message: z.string() }).parse(foreignResponse.body).message).toBe(
      'Etiqueta no disponible',
    );
  });

  it('permite a un supervisor de predio asignado iniciar, relevar APDU, confirmar y restablecer, aísla supervisores de otro predio y evalúa lecturas sin 500', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const point = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Supervisor Secure Point ${randomUUID()}`,
        latitude: -34.6037,
        longitude: -58.3816,
      },
    });
    createdNfcCheckpointIds.push(point.id);
    const otherSite = await prisma.site.create({
      data: {
        companyId: 'norte-company',
        clientId: northClientId,
        name: `Predio Supervisor B ${randomUUID()}`,
        address: 'Calle Test 123',
        latitude: -34.6037,
        longitude: -58.3816,
      },
    });
    createdSiteIds.push(otherSite.id);
    await prisma.siteSupervisor.create({
      data: {
        companyId: 'norte-company',
        siteId: otherSite.id,
        userId: otherSupervisorId,
      },
    });
    const uid = `04${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const client = request(app.getHttpServer());

    // (a.1) Sesión de relevo iniciada por el supervisor asignado al predio vía HTTP
    const startPath = `/api/v1/puntos/${point.id}/etiqueta-segura/configuracion`;
    const version = `0404083000110504040201011105${uid}00000000000000`;
    const start = await client
      .post(startPath)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ uid, version })
      .expect(201);
    const { sessionId, apdu } = z
      .object({ sessionId: z.string(), apdu: z.string() })
      .parse(start.body);
    expect(apdu).toBe('9071000002000000');

    const commandPath = `/api/v1/etiquetas-seguras/configuracion/${sessionId}/comando`;
    const confirmPath = `/api/v1/etiquetas-seguras/configuracion/${sessionId}/confirmar`;

    // (b) Supervisor de otro predio recibe 404 en comando y confirmar
    await client
      .post(commandPath)
      .set('Authorization', 'Bearer token-other-supervisor')
      .send({ response: '9100' })
      .expect(404);

    await client
      .post(confirmPath)
      .set('Authorization', 'Bearer token-other-supervisor')
      .send({ sdmMessage: 'garita:nfc?dummy=1' })
      .expect(404);

    // (a.2) Supervisor asignado al predio envía comandos de relevo APDU sin 500
    const rndB = Buffer.from('B9E2FC789B64BF237CCCAA20EC7E6E48', 'hex');
    const firstResponse = Buffer.concat([
      aesCbc(FACTORY_KEY, Buffer.alloc(16), rndB),
      Buffer.from('91AF', 'hex'),
    ]);
    const first = await client
      .post(commandPath)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ response: firstResponse.toString('hex') })
      .expect(201);
    const firstBody = z.object({ apdu: z.string() }).parse(first.body);
    const challenge = aesCbc(
      FACTORY_KEY,
      Buffer.alloc(16),
      Buffer.from(firstBody.apdu.slice(10, -2), 'hex'),
      true,
    );
    const rndA = challenge.subarray(0, 16);
    const ti = Buffer.from('9D00C4DF', 'hex');
    const rotated = Buffer.concat([rndA.subarray(1), rndA.subarray(0, 1)]);
    const secondResponse = Buffer.concat([
      aesCbc(FACTORY_KEY, Buffer.alloc(16), Buffer.concat([ti, rotated, Buffer.alloc(12)])),
      Buffer.from('9100', 'hex'),
    ]);
    let step = z.object({ apdu: z.string().nullable(), complete: z.boolean() }).parse(
      (
        await client
          .post(commandPath)
          .set('Authorization', 'Bearer token-supervisor')
          .send({ response: secondResponse.toString('hex') })
          .expect(201)
      ).body,
    );
    const keys = sessionKeys(FACTORY_KEY, {
      rndA: rndA.toString('hex'),
      rndB: rndB.toString('hex'),
      ti: ti.toString('hex'),
    });
    for (let counter = 0; counter < 7; counter++) {
      expect(step.apdu).not.toBeNull();
      const ctr = Buffer.alloc(2);
      ctr.writeUInt16LE(counter + 1);
      const response =
        counter === 6
          ? '9100'
          : Buffer.concat([
              truncateMac(aesCmac(keys.mac, Buffer.concat([Buffer.from([0]), ctr, ti]))),
              Buffer.from('9100', 'hex'),
            ]).toString('hex');
      step = z
        .object({ apdu: z.string().nullable(), complete: z.boolean() })
        .parse(
          (
            await client
              .post(commandPath)
              .set('Authorization', 'Bearer token-supervisor')
              .send({ response })
              .expect(201)
          ).body,
        );
    }
    expect(step).toEqual({ apdu: null, complete: true });

    // (a.3) Supervisor asignado al predio confirma configuración sin 500
    const masterHex =
      app.get(ConfigService).get<string>('NFC_MASTER_KEY') ??
      Buffer.alloc(16, 0x11).toString('hex');
    const master = Buffer.from(masterHex, 'hex');
    const uidBytes = Buffer.from(uid, 'hex');
    const counter = Buffer.from('010000', 'hex');
    const picc = Buffer.concat([Buffer.from([0xc7]), uidBytes, counter, Buffer.alloc(5)]);
    const encrypted = aesCbc(deriveTagKey(master, uidBytes, 2, 1), Buffer.alloc(16), picc);
    const sessionKey = aesCmac(
      deriveTagKey(master, uidBytes, 1, 1),
      Buffer.concat([Buffer.from('3CC300010080', 'hex'), uidBytes, counter]),
    );
    const proof = `garita:nfc?e=${encrypted.toString('hex')}&c=${truncateMac(aesCmac(sessionKey, Buffer.alloc(0))).toString('hex')}`;

    await client
      .post(confirmPath)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ sdmMessage: proof })
      .expect(201);

    const tag = await prisma.nfcTag.findFirstOrThrow({ where: { uid } });
    expect(tag).toMatchObject({
      status: 'active',
      kind: 'secure',
      configurationStatus: 'configured',
      lastCounter: 1,
    });

    // (c) Verificación de lectura segura con credenciales de supervisor evalúa marcas sin 500
    const makeSun = (readCounter: number) => {
      const count = Buffer.alloc(3);
      count.writeUIntLE(readCounter, 0, 3);
      const encryptedPicc = aesCbc(
        deriveTagKey(master, uidBytes, 2, 1),
        Buffer.alloc(16),
        Buffer.concat([Buffer.from([0xc7]), uidBytes, count, Buffer.alloc(5)]),
      );
      const macKey = aesCmac(
        deriveTagKey(master, uidBytes, 1, 1),
        Buffer.concat([Buffer.from('3CC300010080', 'hex'), uidBytes, count]),
      );
      return `garita:nfc?e=${encryptedPicc.toString('hex')}&c=${truncateMac(aesCmac(macKey, Buffer.alloc(0))).toString('hex')}`;
    };

    const nfcService = app.get(NfcTagsService);
    const tenantContext = app.get(TenantContext);
    const supervisorContext = {
      correlationId: randomUUID(),
      user: {
        userId: northSupervisorId,
        companyId: 'norte-company',
        role: 'supervisor' as const,
        status: 'active' as const,
      },
    };

    const validResult = await tenantContext.run(supervisorContext, () =>
      nfcService.verifyRead(tag.id, uid, makeSun(2)),
    );
    expect(validResult).toBe('valid');

    const replayedResult = await tenantContext.run(supervisorContext, () =>
      nfcService.verifyRead(tag.id, uid, makeSun(2)),
    );
    expect(replayedResult).toBe('replayed');

    const invalidSun = makeSun(3);
    const badSun = invalidSun.slice(0, -1) + (invalidSun.endsWith('0') ? '1' : '0');
    const badResult = await tenantContext.run(supervisorContext, () =>
      nfcService.verifyRead(tag.id, uid, badSun),
    );
    expect(badResult).toBe('invalid_signature');

    const otherSupervisorContext = {
      correlationId: randomUUID(),
      user: {
        userId: otherSupervisorId,
        companyId: 'norte-company',
        role: 'supervisor' as const,
        status: 'active' as const,
      },
    };
    const missingResult = await tenantContext.run(otherSupervisorContext, () =>
      nfcService.verifyRead(tag.id, uid, makeSun(4)),
    );
    expect(missingResult).toBe('missing');

    // (d) Restablecimiento de etiqueta segura por supervisor
    await prisma.nfcTag.update({
      where: { id: tag.id },
      data: { status: 'removed' },
    });

    const resetPath = `/api/v1/etiquetas-seguras/${tag.id}/restablecer`;
    await client.post(resetPath).set('Authorization', 'Bearer token-other-supervisor').expect(404);

    const resetResponse = await client
      .post(resetPath)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(201);
    expect(resetResponse.body).toEqual({ id: tag.id, configurationStatus: 'incomplete' });

    const resetTag = await prisma.nfcTag.findUniqueOrThrow({ where: { id: tag.id } });
    expect(resetTag.configurationStatus).toBe('incomplete');
  });

  it('la base limita las etiquetas activas por punto y por UID global', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const makePoint = async (name: string) => {
      const row = await prisma.checkpoint.create({
        data: {
          companyId: 'norte-company',
          siteId: northAssignedSiteId,
          name: `NFC índice ${name} ${randomUUID()}`,
          latitude: -34.6,
          longitude: -58.4,
        },
      });
      createdNfcCheckpointIds.push(row.id);
      return row;
    };
    const first = await makePoint('primero');
    const second = await makePoint('segundo');
    const admin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const uid = `07${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
    const active = (checkpointId: string, tagUid: string) =>
      prisma.nfcTag.create({
        data: {
          companyId: 'norte-company',
          checkpointId,
          uid: tagUid,
          associatedById: admin.id,
        },
      });
    const original = await active(first.id, uid);
    await expect(active(first.id, `${uid.slice(0, 6)}AB`)).rejects.toMatchObject({ code: 'P2002' });
    await expect(active(second.id, uid)).rejects.toMatchObject({ code: 'P2002' });
    await prisma.nfcTag.update({
      where: { id: original.id },
      data: { status: 'replaced', endedAt: new Date(), endedById: admin.id },
    });
    await expect(active(second.id, uid)).resolves.toMatchObject({ uid, status: 'active' });
  });

  it('exige y aplica la baja confirmada de predio y cliente cancelando turnos iniciados por horario', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const client = request(app.getHttpServer());
    const admin = { Authorization: 'Bearer token-admin' };
    const originalSiteStates = await prisma.site.findMany({
      where: {
        clientId: (await prisma.site.findUniqueOrThrow({ where: { id: northAssignedSiteId } }))
          .clientId,
      },
      select: { id: true, status: true },
    });
    const originalSupervisors = await prisma.siteSupervisor.findMany({
      where: { siteId: { in: originalSiteStates.map(({ id }) => id) } },
    });
    const round = await prisma.round.findFirst({ where: { siteId: northAssignedSiteId } });
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const createShift = async (startsAt: string, endsAt: string) => {
      const shift = await prisma.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: northAssignedSiteId,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          serviceDate: new Date('2026-10-14T00:00:00.000Z'),
          createdById: actor.id,
          assignments: {
            create: {
              guardId: northGuardId,
              startsAt: new Date(startsAt),
              endsAt: new Date(endsAt),
              assignedById: actor.id,
            },
          },
          ...(round ? { rounds: { create: [{ roundId: round.id }] } } : {}),
        },
      });
      createdShiftIds.push(shift.id);
      return shift;
    };
    const overdue = await createShift('2026-10-13T11:00:00.000Z', '2026-10-13T11:30:00.000Z');
    const future = await createShift('2026-10-20T00:00:00.000Z', '2026-10-20T08:00:00.000Z');
    const impactBody = (
      (await client
        .get(`/api/v1/predios/${northAssignedSiteId}/impacto-baja`)
        .set(admin)
        .expect(200)) as { body: unknown }
    ).body;
    const impact = z
      .object({
        shiftsToCancel: z.number(),
        weeklySchedulesToEnd: z.number(),
        inProgressShiftsToClose: z.number(),
      })
      .parse(impactBody);
    expect(impact.shiftsToCancel).toBeGreaterThanOrEqual(2);
    expect(impact.weeklySchedulesToEnd).toBe(0);
    expect(impact.inProgressShiftsToClose).toBe(0);
    await client
      .post(`/api/v1/predios/${northAssignedSiteId}/baja`)
      .set(admin)
      .send({})
      .expect(409);
    await client
      .post(`/api/v1/predios/${northAssignedSiteId}/baja`)
      .set(admin)
      .send({ confirm: true })
      .expect(201);
    await expect(
      prisma.shift.findMany({
        where: { id: { in: [overdue.id, future.id] } },
        select: { status: true },
      }),
    ).resolves.toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
    await expect(
      prisma.shiftAssignment.count({
        where: { shiftId: { in: [overdue.id, future.id] }, active: true },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.shift.findUniqueOrThrow({ where: { id: future.id } }),
    ).resolves.toMatchObject({
      cancelledById: actor.id,
      cancellationReason: 'Baja del predio',
    });
    await prisma.site.update({ where: { id: northAssignedSiteId }, data: { status: 'active' } });

    const clientRow = await prisma.client.findUniqueOrThrow({
      where: {
        id: (await prisma.site.findUniqueOrThrow({ where: { id: northAssignedSiteId } })).clientId,
      },
    });
    const restoreSiteSnapshot = async () => {
      await prisma.client.update({ where: { id: clientRow.id }, data: { status: 'active' } });
      for (const site of originalSiteStates)
        await prisma.site.update({ where: { id: site.id }, data: { status: site.status } });
      if (originalSupervisors.length)
        await prisma.siteSupervisor.createMany({
          data: originalSupervisors.map(({ companyId, siteId, userId }) => ({
            companyId,
            siteId,
            userId,
          })),
          skipDuplicates: true,
        });
    };
    const clientShift = await createShift('2026-10-21T00:00:00.000Z', '2026-10-21T08:00:00.000Z');
    await client.get(`/api/v1/clientes/${clientRow.id}/impacto-baja`).set(admin).expect(200);
    await client.post(`/api/v1/clientes/${clientRow.id}/baja`).set(admin).send({}).expect(409);
    await client
      .post(`/api/v1/clientes/${clientRow.id}/baja`)
      .set(admin)
      .send({ confirm: true })
      .expect(201);
    await expect(
      prisma.shift.findUniqueOrThrow({ where: { id: clientShift.id } }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    await restoreSiteSnapshot();
    await client
      .get(`/api/v1/clientes/${clientRow.id}/impacto-baja`)
      .set(admin)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ shiftsToCancel: 0, weeklySchedulesToEnd: 0 });
      });
    await client.post(`/api/v1/clientes/${clientRow.id}/baja`).set(admin).send({}).expect(201);
    await restoreSiteSnapshot();
    await client
      .get(`/api/v1/predios/${northAssignedSiteId}/impacto-baja`)
      .set(admin)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ shiftsToCancel: 0, weeklySchedulesToEnd: 0 });
      });
    await client
      .post(`/api/v1/predios/${northAssignedSiteId}/baja`)
      .set(admin)
      .send({})
      .expect(201);
    await restoreSiteSnapshot();
  });

  it('deriva turnos no superpuestos y confirma el conteo al dejarlos sin vigilador', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const client = request(app.getHttpServer());
    const admin = { Authorization: 'Bearer token-admin' };
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const sourceGuard = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-deactivated' },
    });
    await prisma.user.update({ where: { id: sourceGuard.id }, data: { status: 'active' } });
    const pending = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-pending' },
    });
    await prisma.user.update({ where: { id: pending.id }, data: { status: 'invitation_pending' } });
    const addShift = async (guardId: string, startsAt: string, endsAt: string) => {
      const shift = await prisma.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: northAssignedSiteId,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          serviceDate: new Date('2026-10-20T00:00:00.000Z'),
          createdById: actor.id,
          assignments: {
            create: {
              guardId,
              startsAt: new Date(startsAt),
              endsAt: new Date(endsAt),
              assignedById: actor.id,
            },
          },
        },
      });
      createdShiftIds.push(shift.id);
      return shift;
    };
    const overlapSource = await addShift(
      sourceGuard.id,
      '2026-10-20T00:00:00.000Z',
      '2026-10-20T08:00:00.000Z',
    );
    const freeSource = await addShift(
      sourceGuard.id,
      '2026-10-21T00:00:00.000Z',
      '2026-10-21T08:00:00.000Z',
    );
    const overlapTarget = await addShift(
      pending.id,
      '2026-10-20T01:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
    );
    await client
      .post(`/api/v1/usuarios/${sourceGuard.id}/desactivar`)
      .set(admin)
      .send({})
      .expect(409);
    const derived = await client
      .post(`/api/v1/usuarios/${sourceGuard.id}/desactivar`)
      .set(admin)
      .send({ deriveToUserId: pending.id })
      .expect(201);
    const derivedBody = z
      .object({ notDerived: z.array(z.object({ id: z.string() })) })
      .parse(derived.body);
    expect(derivedBody.notDerived.map(({ id }) => id)).toContain(overlapSource.id);
    await expect(
      prisma.shiftAssignment.count({
        where: { shiftId: freeSource.id, guardId: pending.id, active: true, isCurrent: true },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.shiftAssignment.count({
        where: { shiftId: overlapTarget.id, guardId: pending.id, active: true, isCurrent: true },
      }),
    ).resolves.toBe(1);
    await prisma.user.update({ where: { id: sourceGuard.id }, data: { status: 'active' } });
    await prisma.shiftAssignment.updateMany({
      where: { shiftId: { in: [overlapSource.id, freeSource.id] } },
      data: { active: true, isCurrent: true },
    });

    const mismatch = await client
      .post(`/api/v1/usuarios/${sourceGuard.id}/desactivar`)
      .set(admin)
      .send({ leaveUnassigned: true, confirmUnassignedCount: 99 })
      .expect(409);
    expect(z.object({ unassignedCount: z.number() }).parse(mismatch.body).unassignedCount).toBe(2);
    const released = await client
      .post(`/api/v1/usuarios/${sourceGuard.id}/desactivar`)
      .set(admin)
      .send({ leaveUnassigned: true, confirmUnassignedCount: 2 })
      .expect(201);
    expect(z.object({ unassignedCount: z.number() }).parse(released.body).unassignedCount).toBe(2);
    await expect(
      prisma.shift.count({
        where: { id: { in: [overlapSource.id, freeSource.id] }, status: 'unassigned' },
      }),
    ).resolves.toBe(2);
    await prisma.user.update({ where: { id: sourceGuard.id }, data: { status: 'deactivated' } });
  });

  it('valida el margen, la reasignación, la invitación pendiente y otro turno en curso', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const pendingGuard = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-pending' },
    });
    const makeShift = async (
      guardId: string,
      startsAt: string,
      endsAt: string,
      status: 'scheduled' | 'cancelled' | 'in_progress' = 'scheduled',
    ) => {
      const shift = await prisma.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: northAssignedSiteId,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          serviceDate: new Date('2026-10-13T00:00:00.000Z'),
          createdById: actor.id,
          status,
          ...(status === 'in_progress' ? { startedAt: new Date(startsAt) } : {}),
          assignments: {
            create: {
              guardId,
              startsAt: new Date(startsAt),
              endsAt: new Date(endsAt),
              assignedById: actor.id,
            },
          },
        },
      });
      createdShiftIds.push(shift.id);
      return shift;
    };
    const location = {
      status: 'ok',
      latitude: -34.6,
      longitude: -58.4,
      accuracyMeters: 5,
      simulation: 'not_simulated',
      takenAt: '2026-10-13T12:00:00.000Z',
    };
    const outOfMargin = await makeShift(
      northGuardId,
      '2026-10-13T17:00:00.000Z',
      '2026-10-13T18:00:00.000Z',
    );
    const outside = await client
      .post(`/api/v1/turnos/${outOfMargin.id}/iniciar`)
      .set('Authorization', 'Bearer token-guard')
      .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
      .expect(422);
    expect(z.object({ code: z.literal('OUTSIDE_START_MARGIN') }).parse(outside.body).code).toBe(
      'OUTSIDE_START_MARGIN',
    );

    const cancelled = await makeShift(
      northGuardId,
      '2026-10-13T16:00:00.000Z',
      '2026-10-13T17:00:00.000Z',
      'cancelled',
    );
    const notStartable = await client
      .post(`/api/v1/turnos/${cancelled.id}/iniciar`)
      .set('Authorization', 'Bearer token-guard')
      .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
      .expect(409);
    expect(z.object({ code: z.literal('SHIFT_NOT_STARTABLE') }).parse(notStartable.body).code).toBe(
      'SHIFT_NOT_STARTABLE',
    );

    const pendingShift = await makeShift(
      pendingGuard.id,
      '2026-10-13T14:00:00.000Z',
      '2026-10-13T15:00:00.000Z',
    );
    const pending = await client
      .post(`/api/v1/turnos/${pendingShift.id}/iniciar`)
      .set('Authorization', 'Bearer token-pending')
      .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
      .expect(403);
    expect(z.object({ code: z.literal('INVITATION_PENDING') }).parse(pending.body).code).toBe(
      'INVITATION_PENDING',
    );

    const reassigned = await makeShift(
      pendingGuard.id,
      '2026-10-13T15:00:00.000Z',
      '2026-10-13T16:00:00.000Z',
    );
    await prisma.shiftAssignment.updateMany({
      where: { shiftId: reassigned.id },
      data: { isCurrent: false, active: false },
    });
    await prisma.shiftAssignment.create({
      data: {
        shiftId: reassigned.id,
        guardId: northGuardId,
        startsAt: reassigned.startsAt,
        endsAt: reassigned.endsAt,
        assignedById: actor.id,
      },
    });
    const oldGuard = await client
      .post(`/api/v1/turnos/${reassigned.id}/iniciar`)
      .set('Authorization', 'Bearer token-pending')
      .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
      .expect(409);
    expect(z.object({ code: z.literal('SHIFT_REASSIGNED') }).parse(oldGuard.body).code).toBe(
      'SHIFT_REASSIGNED',
    );

    const inProgress = await makeShift(
      northGuardId,
      '2026-10-13T11:00:00.000Z',
      '2026-10-13T12:00:00.000Z',
      'in_progress',
    );
    const candidate = await makeShift(
      northGuardId,
      '2026-10-13T12:00:00.000Z',
      '2026-10-13T13:00:00.000Z',
    );
    const another = await client
      .post(`/api/v1/turnos/${candidate.id}/iniciar`)
      .set('Authorization', 'Bearer token-guard')
      .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
      .expect(409);
    expect(
      z.object({ code: z.literal('ANOTHER_SHIFT_IN_PROGRESS') }).parse(another.body).code,
    ).toBe('ANOTHER_SHIFT_IN_PROGRESS');
    await prisma.shiftAssignment.updateMany({
      where: {
        shiftId: { in: [outOfMargin.id, cancelled.id, reassigned.id, inProgress.id, candidate.id] },
      },
      data: { isCurrent: false, active: false },
    });
  });

  it('inicia y cierra turnos, conserva la respuesta y evita duplicar el evento del dispositivo', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const round = await prisma.round.findFirstOrThrow({
      where: { siteId: northAssignedSiteId, status: 'active' },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-13T12:00:00.000Z'),
        endsAt: new Date('2026-10-13T13:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: actor.id,
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2026-10-13T12:00:00.000Z'),
            endsAt: new Date('2026-10-13T13:00:00.000Z'),
            assignedById: actor.id,
          },
        },
        rounds: { create: { roundId: round.id } },
      },
    });
    createdShiftIds.push(shift.id);
    const auth = { Authorization: 'Bearer token-guard' };
    const startBody = {
      eventId: randomUUID(),
      occurredAtDevice: '2026-10-13T11:59:00.000Z',
      location: {
        status: 'ok',
        latitude: -34.6,
        longitude: -58.4,
        accuracyMeters: 8,
        simulation: 'not_simulated',
        takenAt: '2026-10-13T11:59:00.000Z',
      },
    };
    const started = await client
      .post(`/api/v1/turnos/${shift.id}/iniciar`)
      .set(auth)
      .send(startBody)
      .expect(201);
    const parsed = startShiftResponseSchema.parse(started.body);
    expect(parsed.status).toBe('in_progress');
    const replay = await client
      .post(`/api/v1/turnos/${shift.id}/iniciar`)
      .set(auth)
      .send(startBody)
      .expect(201);
    expect(replay.body).toEqual(started.body);
    await expect(
      prisma.shiftEvent.count({ where: { shiftId: shift.id, deviceEventId: startBody.eventId } }),
    ).resolves.toBe(1);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id },
    });
    await expect(
      prisma.shiftEvent.create({
        data: {
          companyId: 'norte-company',
          shiftId: shift.id,
          assignmentId: assignment.id,
          type: 'start',
          deviceEventId: startBody.eventId,
          occurredAt: new Date('2026-10-13T12:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const closeBody = {
      eventId: randomUUID(),
      occurredAtDevice: '2026-10-13T12:00:00.000Z',
      location: startBody.location,
    };
    await client.post(`/api/v1/turnos/${shift.id}/cerrar`).set(auth).send(closeBody).expect(400);
    const closed = await client
      .post(`/api/v1/turnos/${shift.id}/cerrar`)
      .set(auth)
      .send({ ...closeBody, reason: 'Relevo anticipado' })
      .expect(201);
    expect(closed.body).toMatchObject({ status: 'closed', closedEarly: true });
  });

  it('cierra por administración al desactivar forzadamente y conserva el cierre automático al recibir el real', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    const execution = app.get(ShiftExecutionService);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-13T09:00:00.000Z'),
        endsAt: new Date('2026-10-13T10:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        startedAt: new Date('2026-10-13T09:00:00.000Z'),
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2026-10-13T09:00:00.000Z'),
            endsAt: new Date('2026-10-13T10:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
      include: { assignments: true },
    });
    createdShiftIds.push(shift.id);
    await client
      .post(`/api/v1/usuarios/${northGuardId}/desactivar`)
      .set('Authorization', 'Bearer token-admin')
      .send({})
      .expect(409);
    testNow = new Date('2026-10-13T11:55:00.000Z');
    const futureShiftCount = await prisma.shift.count({
      where: {
        status: 'scheduled',
        startsAt: { gt: testNow },
        assignments: { some: { guardId: northGuardId, isCurrent: true, active: true } },
      },
    });
    const forced = await client
      .post(`/api/v1/usuarios/${northGuardId}/desactivar`)
      .set('Authorization', 'Bearer token-admin')
      .send({
        forceDeactivate: true,
        reason: 'Celular robado',
        ...(futureShiftCount
          ? { leaveUnassigned: true, confirmUnassignedCount: futureShiftCount }
          : {}),
      })
      .expect(201);
    testNow = new Date('2026-10-13T12:00:00.000Z');
    expect(z.object({ ok: z.literal(true) }).parse(forced.body).ok).toBe(true);
    await expect(
      prisma.shift.findUniqueOrThrow({ where: { id: shift.id } }),
    ).resolves.toMatchObject({
      status: 'closed',
      closedBy: 'admin',
      closeReason: 'Celular robado',
    });
    await expect(
      prisma.shiftEvent.findFirstOrThrow({ where: { shiftId: shift.id } }),
    ).resolves.toMatchObject({ type: 'admin_close', actorUserId: actor.id });
    await client
      .post(`/api/v1/turnos/${shift.id}/cerrar`)
      .set('Authorization', 'Bearer token-guard')
      .send({
        eventId: randomUUID(),
        occurredAtDevice: '2026-10-13T11:59:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-13T11:59:00.000Z',
        },
      })
      .expect(201);
    await expect(
      prisma.shiftEvent.findFirstOrThrow({ where: { shiftId: shift.id, type: 'close' } }),
    ).resolves.toMatchObject({ countsForCompliance: false });
    await prisma.user.update({ where: { id: northGuardId }, data: { status: 'active' } });

    const automatic = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-13T10:00:00.000Z'),
        endsAt: new Date('2026-10-13T11:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        startedAt: new Date('2026-10-13T10:00:00.000Z'),
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2026-10-13T10:00:00.000Z'),
            endsAt: new Date('2026-10-13T11:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
    });
    createdShiftIds.push(automatic.id);
    testNow = new Date('2026-10-13T13:00:00.000Z');
    await expect(execution.autoClose(automatic.id)).resolves.toBe(true);
    const lateClose = await client
      .post(`/api/v1/turnos/${automatic.id}/cerrar`)
      .set('Authorization', 'Bearer token-guard')
      .send({
        eventId: randomUUID(),
        occurredAtDevice: '2026-10-13T12:59:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-13T12:59:00.000Z',
        },
      })
      .expect(201);
    testNow = new Date('2026-10-13T12:00:00.000Z');
    expect(z.object({ status: z.literal('closed') }).parse(lateClose.body).status).toBe('closed');
    await expect(
      prisma.shift.findUniqueOrThrow({ where: { id: automatic.id } }),
    ).resolves.toMatchObject({
      status: 'closed',
      autoClosedAt: new Date('2026-10-13T13:00:00.000Z'),
      closedAt: new Date('2026-10-13T12:59:00.000Z'),
    });
    await expect(
      prisma.shiftEvent.count({ where: { shiftId: automatic.id, type: 'auto_close' } }),
    ).resolves.toBe(1);
  });

  it('cierra turnos en curso al dar de baja un predio y los cuenta en el impacto', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    const notifications = jest
      .spyOn(app.get(NotificationsService), 'notifyUsers')
      .mockResolvedValue();
    const sms = jest.spyOn(app.get<SmsPort>(SMS_PORT), 'sendShiftClosed').mockResolvedValue();
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const pendingGuard = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-pending' },
    });
    await prisma.user.update({ where: { id: pendingGuard.id }, data: { phone: '+541100000000' } });
    const site = await prisma.site.create({
      data: {
        companyId: 'norte-company',
        clientId: (
          await prisma.client.findUniqueOrThrow({
            where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
          })
        ).id,
        name: `HU10-${randomUUID()}`,
        address: 'Domicilio de prueba',
        latitude: -34.6,
        longitude: -58.4,
      },
    });
    createdSiteIds.push(site.id);
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: site.id,
        startsAt: new Date('2026-10-13T11:00:00.000Z'),
        endsAt: new Date('2026-10-13T13:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        startedAt: new Date('2026-10-13T11:00:00.000Z'),
        assignments: {
          create: {
            guardId: pendingGuard.id,
            startsAt: new Date('2026-10-13T11:00:00.000Z'),
            endsAt: new Date('2026-10-13T13:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    await client.get(`/api/v1/turnos/${shift.id}/datos`).expect(401);
    await client
      .get(`/api/v1/turnos/${shift.id}/datos`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(404);
    await client
      .get(`/api/v1/turnos/${shift.id}/estado`)
      .set('Authorization', 'Bearer token-client')
      .expect(403);
    const auth = { Authorization: 'Bearer token-admin' };
    const impact = await client
      .get(`/api/v1/predios/${site.id}/impacto-baja`)
      .set(auth)
      .expect(200);
    expect(
      z.object({ inProgressShiftsToClose: z.number() }).parse(impact.body).inProgressShiftsToClose,
    ).toBe(1);
    await client
      .post(`/api/v1/predios/${site.id}/baja`)
      .set(auth)
      .send({ confirm: true })
      .expect(201);
    await expect(
      prisma.shift.findUniqueOrThrow({ where: { id: shift.id } }),
    ).resolves.toMatchObject({
      status: 'closed',
      closedBy: 'admin',
      closeReason: 'baja del predio',
    });
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [pendingGuard.id],
        kind: 'shift_closed_site_removed',
      }),
    );
    expect(sms).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftId: shift.id,
        guardId: pendingGuard.id,
        phone: '+541100000000',
      }),
    );
    await prisma.user.update({
      where: { id: pendingGuard.id },
      data: { phone: pendingGuard.phone },
    });
    notifications.mockRestore();
    sms.mockRestore();
  });

  it('protege endpoints de turnos, impacto y desactivación por rol y tenant', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    await client.get(`/api/v1/predios/${northAssignedSiteId}/impacto-baja`).expect(401);
    await client.post(`/api/v1/usuarios/${northGuardId}/desactivar`).send({}).expect(401);
    await client.get('/api/v1/turnos').set('Authorization', 'Bearer token-guard').expect(403);
    await client.get('/api/v1/turnos').set('Authorization', 'Bearer token-client').expect(403);
    await client
      .get(`/api/v1/predios/${northUnassignedSiteId}/impacto-baja`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(403);
    await client
      .get(`/api/v1/predios/${northAssignedSiteId}/impacto-baja`)
      .set('Authorization', 'Bearer token-south-admin')
      .expect(404);
    await client
      .get(`/api/v1/turnos?predio=${northUnassignedSiteId}`)
      .set('Authorization', 'Bearer token-supervisor')
      .expect(404);
    await client
      .post(`/api/v1/usuarios/${northGuardId}/desactivar`)
      .set('Authorization', 'Bearer token-supervisor')
      .send({})
      .expect(403);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const makeShift = async (guardId: string) => {
      const shift = await prisma.shift.create({
        data: {
          companyId: 'norte-company',
          siteId: northAssignedSiteId,
          startsAt: new Date('2026-10-22T00:00:00.000Z'),
          endsAt: new Date('2026-10-22T08:00:00.000Z'),
          serviceDate: new Date('2026-10-22T00:00:00.000Z'),
          createdById: actor.id,
          assignments: {
            create: {
              guardId,
              startsAt: new Date('2026-10-22T00:00:00.000Z'),
              endsAt: new Date('2026-10-22T08:00:00.000Z'),
              assignedById: actor.id,
            },
          },
        },
      });
      createdShiftIds.push(shift.id);
      return shift;
    };
    const owned = await makeShift(northGuardId);
    const other = await makeShift(
      (await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-pending' } })).id,
    );
    await client.post(`/api/v1/turnos/${owned.id}/iniciar`).send({}).expect(401);
    await client
      .post(`/api/v1/turnos/${other.id}/iniciar`)
      .set('Authorization', 'Bearer token-guard')
      .send({
        eventId: randomUUID(),
        occurredAtDevice: '2026-10-13T12:00:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-13T12:00:00.000Z',
        },
      })
      .expect(403);
    await client
      .get(`/api/v1/turnos/${owned.id}`)
      .set('Authorization', 'Bearer token-guard')
      .expect(200);
    await client
      .get(`/api/v1/turnos/${other.id}`)
      .set('Authorization', 'Bearer token-guard')
      .expect(403);
    const mine = await client
      .get('/api/v1/mis-turnos')
      .set('Authorization', 'Bearer token-guard')
      .expect(200);
    const mineIds = z
      .array(z.object({ id: z.string() }))
      .parse(mine.body)
      .map(({ id }) => id);
    expect(mineIds).toContain(owned.id);
    expect(mineIds).not.toContain(other.id);
  });

  it('registra pasos por puntos de control con QR, valida predio, imputa a ventanas y registra intentos rechazados (HU-11)', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    const qrService = app.get(QrService);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });

    const cpGalpon = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Galpón 1-${randomUUID()}`,
        latitude: -34.601,
        longitude: -58.401,
        qrVersion: 1,
      },
    });
    createdCheckpointIds.push(cpGalpon.id);

    const cpPorton = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Portón trasero-${randomUUID()}`,
        latitude: -34.602,
        longitude: -58.402,
        qrVersion: 1,
      },
    });
    createdCheckpointIds.push(cpPorton.id);

    const cpOtro = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Oficina-${randomUUID()}`,
        latitude: -34.603,
        longitude: -58.403,
        qrVersion: 1,
      },
    });
    createdCheckpointIds.push(cpOtro.id);

    const cpOtroPredio = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        name: `Planta Norte-${randomUUID()}`,
        latitude: -34.65,
        longitude: -58.45,
        qrVersion: 1,
      },
    });
    createdCheckpointIds.push(cpOtroPredio.id);

    const round1Name = `Perimetral-${randomUUID()}`;
    createdRoundNames.push(round1Name);
    const r1 = await prisma.round.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: round1Name,
        versions: {
          create: {
            versionNumber: 1,
            frequencyMinutes: 120,
            graceMinutes: 15,
            windowStartLocal: '22:00',
            windowEndLocal: '06:00',
            createdById: actor.id,
            checkpoints: {
              create: [
                { companyId: 'norte-company', checkpointId: cpGalpon.id, position: 0 },
                { companyId: 'norte-company', checkpointId: cpPorton.id, position: 1 },
              ],
            },
          },
        },
      },
      include: { versions: true },
    });
    const firstV1 = r1.versions[0];
    if (!firstV1) {
      throw new Error('Version 1 no creada');
    }
    const r1VersionId = firstV1.id;
    await prisma.round.update({
      where: { id: r1.id },
      data: { currentVersionId: r1VersionId },
    });

    const round2Name = `Interna-${randomUUID()}`;
    createdRoundNames.push(round2Name);
    const r2 = await prisma.round.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: round2Name,
        versions: {
          create: {
            versionNumber: 1,
            frequencyMinutes: 120,
            graceMinutes: 15,
            windowStartLocal: '22:00',
            windowEndLocal: '06:00',
            createdById: actor.id,
            checkpoints: {
              create: [
                { companyId: 'norte-company', checkpointId: cpGalpon.id, position: 0 },
                { companyId: 'norte-company', checkpointId: cpOtro.id, position: 1 },
              ],
            },
          },
        },
      },
      include: { versions: true },
    });
    const firstV2 = r2.versions[0];
    if (!firstV2) {
      throw new Error('Version 2 no creada');
    }
    const r2VersionId = firstV2.id;
    await prisma.round.update({
      where: { id: r2.id },
      data: { currentVersionId: r2VersionId },
    });

    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-14T01:00:00.000Z'),
        endsAt: new Date('2026-10-14T09:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        startedAt: new Date('2026-10-14T01:00:00.000Z'),
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2026-10-14T01:00:00.000Z'),
            endsAt: new Date('2026-10-14T09:00:00.000Z'),
            assignedById: actor.id,
          },
        },
        rounds: {
          create: [
            { roundId: r1.id, roundVersionId: r1VersionId },
            { roundId: r2.id, roundVersionId: r2VersionId },
          ],
        },
      },
    });
    createdShiftIds.push(shift.id);

    const guardAuth = { Authorization: 'Bearer token-guard' };
    const defaultLocation = {
      status: 'ok' as const,
      latitude: -34.601,
      longitude: -58.401,
      accuracyMeters: 5,
      simulation: 'not_simulated' as const,
      takenAt: '2026-10-14T01:30:00.000Z',
    };

    // 1. Punto compartido cuenta para dos rondas (CA9, BDD 7) y es idempotente por recordId
    testNow = new Date('2026-10-14T01:30:00.000Z');
    const qrGalpon = qrService.createPayload(cpGalpon.id, cpGalpon.qrVersion);
    const recordId1 = randomUUID();
    const req1 = {
      recordId: recordId1,
      shiftId: shift.id,
      method: 'qr' as const,
      scannedValue: qrGalpon,
      occurredAtDevice: '2026-10-14T01:30:00.000Z',
      location: defaultLocation,
      phoneNfc: 'on' as const,
    };

    const res1 = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send(req1)
      .expect(200);

    const parsed1 = checkpointRecordResponseSchema.parse(res1.body);
    expect(parsed1.result).toBe('recorded');
    if (parsed1.result === 'recorded') {
      expect(parsed1.recordId).toBe(recordId1);
      expect(parsed1.checkpointId).toBe(cpGalpon.id);
      expect(parsed1.outOfWindow).toBe(false);
      expect(parsed1.countedFor).toHaveLength(2);
      expect(parsed1.countedFor).toContainEqual({ roundId: r1.id, windowIndex: 0, late: false });
      expect(parsed1.countedFor).toContainEqual({ roundId: r2.id, windowIndex: 0, late: false });
    }

    const replay1 = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send(req1)
      .expect(200);
    expect(replay1.body).toEqual(res1.body);

    const conflict1 = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({ ...req1, occurredAtDevice: '2026-10-14T01:31:00.000Z' })
      .expect(409);
    expect(conflict1.body).toMatchObject({ code: 'RECORD_ID_CONFLICT' });

    // 2. Comprobar que estado refleja los pendientes (BDD 1)
    const estado1 = await client
      .get(`/api/v1/turnos/${shift.id}/estado`)
      .set(guardAuth)
      .expect(200);
    const r1State1 = (
      estado1.body as { rounds: { roundId: string; pendingCheckpointIds: string[] }[] }
    ).rounds.find((r) => r.roundId === r1.id);
    expect(r1State1?.pendingCheckpointIds).toEqual([cpPorton.id]);

    testNow = new Date('2026-10-14T01:45:00.000Z');
    const qrPorton = qrService.createPayload(cpPorton.id, cpPorton.qrVersion);
    const recordIdPorton = randomUUID();
    const resPorton = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recordIdPorton,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrPorton,
        occurredAtDevice: '2026-10-14T01:45:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resPorton.body).toMatchObject({
      result: 'recorded',
      checkpointId: cpPorton.id,
      outOfWindow: false,
    });

    const estado2 = await client
      .get(`/api/v1/turnos/${shift.id}/estado`)
      .set(guardAuth)
      .expect(200);
    const r1State2 = (
      estado2.body as { rounds: { roundId: string; pendingCheckpointIds: string[] }[] }
    ).rounds.find((r) => r.roundId === r1.id);
    expect(r1State2?.pendingCheckpointIds).toEqual([]);

    // 3. Punto ya registrado en la ventana (CA4, BDD 4) -> not_generated already_recorded
    testNow = new Date('2026-10-14T02:30:00.000Z');
    const recordIdRepetido = randomUUID();
    const resRepetido = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recordIdRepetido,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrPorton,
        occurredAtDevice: '2026-10-14T02:30:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resRepetido.body).toEqual({
      result: 'not_generated',
      recordId: recordIdRepetido,
      cause: 'already_recorded',
      retryAfterUtc: null,
    });

    // 4. Registro durante la gracia (CA6, BDD 5) -> late: true
    testNow = new Date('2026-10-14T03:10:00.000Z');
    const qrOtro = qrService.createPayload(cpOtro.id, cpOtro.qrVersion);
    const recordIdGracia = randomUUID();
    const resGracia = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recordIdGracia,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrOtro,
        occurredAtDevice: '2026-10-14T03:10:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resGracia.body).toEqual({
      result: 'recorded',
      recordId: recordIdGracia,
      checkpointId: cpOtro.id,
      countedFor: [{ roundId: r2.id, windowIndex: 0, late: true }],
      outOfWindow: false,
    });

    // 5. Escaneo antes del tiempo mínimo (CA7, BDD 6) -> too_soon con retryAfterUtc
    testNow = new Date('2026-10-14T03:11:00.000Z');
    const recordIdTooSoon = randomUUID();
    const resTooSoon = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recordIdTooSoon,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrOtro,
        occurredAtDevice: '2026-10-14T03:11:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resTooSoon.body).toEqual({
      result: 'not_generated',
      recordId: recordIdTooSoon,
      cause: 'too_soon',
      retryAfterUtc: '2026-10-14T04:10:00.000Z',
    });

    // 6. Fuera de ventana (CA5) -> outOfWindow: true, countedFor: []
    testNow = new Date('2026-10-14T00:00:00.000Z');
    const recordIdFuera = randomUUID();
    const resFuera = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recordIdFuera,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrGalpon,
        occurredAtDevice: '2026-10-14T00:00:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resFuera.body).toEqual({
      result: 'recorded',
      recordId: recordIdFuera,
      checkpointId: cpGalpon.id,
      countedFor: [],
      outOfWindow: true,
    });
    const dbRecordFuera = await prisma.checkpointRecord.findUniqueOrThrow({
      where: { recordId: recordIdFuera },
    });
    expect(dbRecordFuera.outOfWindow).toBe(true);
    expect(dbRecordFuera.countedFor).toEqual([]);

    // 7. QR inválidos guardados como InvalidScanAttempt (CA2, BDD 2)
    // a) QR mal formado
    const recMalformado = randomUUID();
    const resMalformado = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recMalformado,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: 'invalid-qr-content',
        occurredAtDevice: '2026-10-14T01:30:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resMalformado.body).toEqual({
      result: 'rejected',
      recordId: recMalformado,
      reason: 'malformed',
    });
    const attemptMalformado = await prisma.invalidScanAttempt.findUniqueOrThrow({
      where: { recordId: recMalformado },
    });
    expect(attemptMalformado.reason).toBe('malformed');
    expect(attemptMalformado.highlighted).toBe(false);

    // b) QR con firma alterada
    const recAlterado = randomUUID();
    const signatureStart = qrGalpon.lastIndexOf('.') + 1;
    const signatureMiddle = signatureStart + Math.floor((qrGalpon.length - signatureStart) / 2);
    const originalSignatureCharacter = qrGalpon[signatureMiddle];
    const replacementSignatureCharacter = originalSignatureCharacter === 'A' ? 'B' : 'A';
    const qrAlterado =
      qrGalpon.slice(0, signatureMiddle) +
      replacementSignatureCharacter +
      qrGalpon.slice(signatureMiddle + 1);
    const resAlterado = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recAlterado,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrAlterado,
        occurredAtDevice: '2026-10-14T01:30:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resAlterado.body).toEqual({
      result: 'rejected',
      recordId: recAlterado,
      reason: 'signature',
    });

    // c) QR de versión regenerada (destacado highlighted=true)
    await prisma.checkpoint.update({
      where: { id: cpPorton.id },
      data: { qrVersion: 2 },
    });
    const recOutdated = randomUUID();
    const resOutdated = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recOutdated,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrPorton,
        occurredAtDevice: '2026-10-14T01:30:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resOutdated.body).toEqual({
      result: 'rejected',
      recordId: recOutdated,
      reason: 'outdated_version',
    });
    const attemptOutdated = await prisma.invalidScanAttempt.findUniqueOrThrow({
      where: { recordId: recOutdated },
    });
    expect(attemptOutdated.reason).toBe('outdated_version');
    expect(attemptOutdated.highlighted).toBe(true);

    // d) QR de otro predio (BDD 2)
    const qrOtroPredio = qrService.createPayload(cpOtroPredio.id, cpOtroPredio.qrVersion);
    const recOtroPredio = randomUUID();
    const resOtroPredio = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: recOtroPredio,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrOtroPredio,
        occurredAtDevice: '2026-10-14T01:30:00.000Z',
        location: defaultLocation,
        phoneNfc: 'on',
      })
      .expect(200);
    expect(resOtroPredio.body).toEqual({
      result: 'rejected',
      recordId: recOtroPredio,
      reason: 'other_site',
    });

    // HU-12: misma imputación con NFC, UID vigente descargable e intentos durables.
    const nfcUid = randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase();
    const nfcTag = await prisma.nfcTag.create({
      data: {
        companyId: 'norte-company',
        checkpointId: cpGalpon.id,
        uid: nfcUid,
        status: 'active',
        associatedById: actor.id,
      },
    });
    const downloaded = await client
      .get(`/api/v1/turnos/${shift.id}/datos`)
      .set(guardAuth)
      .expect(200);
    expect(
      z
        .object({
          checkpoints: z.array(z.object({ id: z.string(), nfcUid: z.string().nullable() })),
        })
        .parse(downloaded.body).checkpoints,
    ).toContainEqual({ id: cpGalpon.id, nfcUid });
    const nfcRequest = {
      ...req1,
      recordId: randomUUID(),
      method: 'nfc',
      scannedValue: nfcUid.toLowerCase().match(/../g)?.join(':'),
      occurredAtDevice: '2026-10-14T08:30:00.000Z',
    };
    const nfcResponse = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send(nfcRequest)
      .expect(200);
    expect(nfcResponse.body).toMatchObject({
      result: 'recorded',
      checkpointId: cpGalpon.id,
      outOfWindow: false,
    });
    const parsedNfc = checkpointRecordResponseSchema.parse(nfcResponse.body);
    expect(parsedNfc.result).toBe('recorded');
    if (parsedNfc.result === 'recorded')
      expect(parsedNfc.countedFor).toEqual(
        expect.arrayContaining([
          { roundId: r1.id, windowIndex: 3, late: false },
          { roundId: r2.id, windowIndex: 3, late: false },
        ]),
      );
    expect(
      await prisma.checkpointRecord.findUniqueOrThrow({ where: { recordId: nfcRequest.recordId } }),
    ).toMatchObject({ method: 'nfc', phoneNfc: 'on' });
    expect(
      (await client.post('/api/v1/registros-puntos').set(guardAuth).send(nfcRequest).expect(200))
        .body,
    ).toEqual(nfcResponse.body);
    await prisma.nfcTag.update({ where: { id: nfcTag.id }, data: { status: 'replaced' } });
    const foreignUid = randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase();
    await prisma.nfcTag.create({
      data: {
        companyId: 'norte-company',
        checkpointId: cpOtroPredio.id,
        uid: foreignUid,
        status: 'active',
        associatedById: actor.id,
      },
    });
    for (const [uid, reason] of [
      [nfcUid, 'tag_replaced'],
      [foreignUid, 'tag_not_associated'],
      ['DEADBEEF', 'tag_not_associated'],
      ['invalid', 'tag_not_associated'],
    ] as const) {
      const attempt = { ...nfcRequest, recordId: randomUUID(), scannedValue: uid };
      const rejected = await client
        .post('/api/v1/registros-puntos')
        .set(guardAuth)
        .send(attempt)
        .expect(200);
      expect(rejected.body).toMatchObject({ result: 'rejected', reason });
      const savedAttempt = await prisma.invalidScanAttempt.findUniqueOrThrow({
        where: { recordId: attempt.recordId },
      });
      expect(savedAttempt).toMatchObject({
        method: 'nfc',
        reason,
        occurredAtDevice: new Date(attempt.occurredAtDevice),
      });
      expect(Number(savedAttempt.latitude)).toBe(defaultLocation.latitude);
      expect(
        await prisma.checkpointRecord.findUnique({ where: { recordId: attempt.recordId } }),
      ).toBeNull();
      expect(
        (await client.post('/api/v1/registros-puntos').set(guardAuth).send(attempt).expect(200))
          .body,
      ).toEqual(rejected.body);
    }

    // 8. Turno no en curso -> 409 SHIFT_NOT_IN_PROGRESS
    const scheduledShift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-25T01:00:00.000Z'),
        endsAt: new Date('2026-10-25T09:00:00.000Z'),
        serviceDate: new Date('2026-10-25T00:00:00.000Z'),
        createdById: actor.id,
        status: 'scheduled',
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2026-10-25T01:00:00.000Z'),
            endsAt: new Date('2026-10-25T09:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
    });
    createdShiftIds.push(scheduledShift.id);

    const resScheduled = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        ...req1,
        recordId: randomUUID(),
        shiftId: scheduledShift.id,
      })
      .expect(409);
    expect(resScheduled.body).toMatchObject({ code: 'SHIFT_NOT_IN_PROGRESS' });

    // 9. Permisos
    await client.post('/api/v1/registros-puntos').send(req1).expect(401);
    await client
      .post('/api/v1/registros-puntos')
      .set('Authorization', 'Bearer token-admin')
      .send(req1)
      .expect(403);
    await client
      .post('/api/v1/registros-puntos')
      .set('Authorization', 'Bearer token-supervisor')
      .send(req1)
      .expect(403);
    await client
      .post('/api/v1/registros-puntos')
      .set('Authorization', 'Bearer token-client')
      .send(req1)
      .expect(403);

    const otherGuardShift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-14T01:00:00.000Z'),
        endsAt: new Date('2026-10-14T09:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        assignments: {
          create: {
            guardId: (
              await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-pending' } })
            ).id,
            startsAt: new Date('2026-10-14T01:00:00.000Z'),
            endsAt: new Date('2026-10-14T09:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
    });
    createdShiftIds.push(otherGuardShift.id);
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({ ...req1, recordId: randomUUID(), shiftId: otherGuardShift.id })
      .expect(409);

    const southShift = await prisma.shift.create({
      data: {
        companyId: 'sur-company',
        siteId: southSiteId,
        startsAt: new Date('2026-10-14T01:00:00.000Z'),
        endsAt: new Date('2026-10-14T09:00:00.000Z'),
        serviceDate: new Date('2026-10-13T00:00:00.000Z'),
        createdById: (
          await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-sur-admin' } })
        ).id,
        status: 'in_progress',
      },
    });
    createdShiftIds.push(southShift.id);
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({ ...req1, recordId: randomUUID(), shiftId: southShift.id })
      .expect(404);
  });

  it('detecta registros sospechosos (HU-15), guarda marcas y expone endpoints de consulta y velocidad', async () => {
    const client = request(app.getHttpServer());
    const prisma = app.get(PrismaService).systemPrisma;
    const qrService = app.get(QrService);

    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });

    // 1. Predio y puntos para la prueba
    const cpTagged = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Punto Con Tag E2E ${randomUUID()}`,
        latitude: -34.6037,
        longitude: -58.3816,
        toleranceRadiusMeters: 30,
        isIndoor: false,
      },
    });
    createdCheckpointIds.push(cpTagged.id);

    const validUid = randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase();
    const tag = await prisma.nfcTag.create({
      data: {
        companyId: 'norte-company',
        checkpointId: cpTagged.id,
        uid: validUid,
        status: 'active',
        associatedById: northSupervisorId,
      },
    });

    const cpFar = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        name: `Punto Lejano E2E ${randomUUID()}`,
        latitude: -34.6037 + 500 / 111195,
        longitude: -58.3816,
        toleranceRadiusMeters: 30,
        isIndoor: false,
      },
    });
    createdCheckpointIds.push(cpFar.id);

    const qrTagged = qrService.createPayload(cpTagged.id, cpTagged.qrVersion);
    const qrFar = qrService.createPayload(cpFar.id, cpFar.qrVersion);

    // Turno en progreso en el predio asignado
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-11-25T01:00:00.000Z'),
        endsAt: new Date('2026-11-25T09:00:00.000Z'),
        serviceDate: new Date('2026-11-25T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
        startedAt: new Date('2026-11-25T01:00:00.000Z'),
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt: new Date('2026-11-25T01:00:00.000Z'),
            endsAt: new Date('2026-11-25T09:00:00.000Z'),
            assignedById: actor.id,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);

    const guardAuth = { Authorization: 'Bearer token-guard' };
    const supervisorAuth = { Authorization: 'Bearer token-supervisor' };
    const adminAuth = { Authorization: 'Bearer token-admin' };

    // Registro 1: Fuera de rango (80m, precisión 10m, radio 30m) y QR en punto con etiqueta activa (phoneNfc: 'on')
    const rec1Id = randomUUID();
    const evaluator = app.get(MarcasService);
    let evaluationMs = 0;
    const originalEvaluate = evaluator.evaluateRecord.bind(evaluator);
    const evaluationSpy = jest
      .spyOn(evaluator, 'evaluateRecord')
      .mockImplementation(async (record) => {
        const startedAt = performance.now();
        await originalEvaluate(record);
        evaluationMs = performance.now() - startedAt;
      });
    const firstRecordRequest = {
      recordId: rec1Id,
      shiftId: shift.id,
      method: 'qr',
      scannedValue: qrTagged,
      occurredAtDevice: '2026-11-25T02:00:00.000Z',
      location: {
        status: 'ok',
        latitude: -34.6037 + 80 / 111195,
        longitude: -58.3816,
        accuracyMeters: 10,
        simulation: 'not_simulated',
        takenAt: '2026-11-25T02:00:00.000Z',
      },
      phoneNfc: 'on',
    };
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send(firstRecordRequest)
      .expect(200);

    expect(evaluationMs).toBeLessThan(100);
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send(firstRecordRequest)
      .expect(200);
    expect(evaluationSpy).toHaveBeenCalledTimes(1);
    evaluationSpy.mockRestore();

    // Registro 2: Ubicación simulada (simulation: 'simulated')
    const rec2Id = randomUUID();
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: rec2Id,
        shiftId: shift.id,
        method: 'nfc',
        scannedValue: tag.uid,
        occurredAtDevice: '2026-11-25T02:05:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'simulated',
          takenAt: '2026-11-25T02:05:00.000Z',
        },
        phoneNfc: 'on',
      })
      .expect(200);

    // Registro 3: Celular sin NFC (phoneNfc: 'unsupported') en punto con tag -> NO se marca (CA7)
    const rec3Id = randomUUID();
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: rec3Id,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrTagged,
        occurredAtDevice: '2026-11-25T02:10:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          takenAt: '2026-11-25T02:10:00.000Z',
        },
        phoneNfc: 'unsupported',
      })
      .expect(200);

    // Registro 4: mismo instante que rec3 a 500m; el intervalo cero implica velocidad imposible.
    const rec4Id = randomUUID();
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: rec4Id,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrFar,
        occurredAtDevice: '2026-11-25T02:10:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6037 + 500 / 111195,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          takenAt: '2026-11-25T02:10:00.000Z',
        },
        phoneNfc: 'on',
      })
      .expect(200);

    // 2. Consulta de registros marcados (GET /turnos/:id/registros)
    // Sin autenticación -> 401
    await client.get(`/api/v1/turnos/${shift.id}/registros`).expect(401);

    // Rol guard -> 403 (el vigilador no ve marcas)
    await client.get(`/api/v1/turnos/${shift.id}/registros`).set(guardAuth).expect(403);

    // Rol client -> 403
    await client
      .get(`/api/v1/turnos/${shift.id}/registros`)
      .set('Authorization', 'Bearer token-client')
      .expect(403);

    // Turno inexistente -> 404
    await client.get('/api/v1/turnos/shift-inexistente/registros').set(supervisorAuth).expect(404);

    // Turno de otra empresa
    const southShift = await prisma.shift.create({
      data: {
        companyId: 'sur-company',
        siteId: southSiteId,
        startsAt: new Date('2026-10-25T01:00:00.000Z'),
        endsAt: new Date('2026-10-25T09:00:00.000Z'),
        serviceDate: new Date('2026-10-25T00:00:00.000Z'),
        createdById: (
          await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-sur-admin' } })
        ).id,
        status: 'in_progress',
      },
    });
    createdShiftIds.push(southShift.id);

    await client.get(`/api/v1/turnos/${southShift.id}/registros`).set(supervisorAuth).expect(404);

    const unassignedSiteShift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northUnassignedSiteId,
        startsAt: new Date('2026-11-25T01:00:00.000Z'),
        endsAt: new Date('2026-11-25T09:00:00.000Z'),
        serviceDate: new Date('2026-11-25T00:00:00.000Z'),
        createdById: actor.id,
        status: 'in_progress',
      },
    });
    createdShiftIds.push(unassignedSiteShift.id);
    await client
      .get(`/api/v1/turnos/${unassignedSiteShift.id}/registros`)
      .set(supervisorAuth)
      .expect(404);

    // Consulta exitosa por supervisor asignado
    const resSupervisor = await client
      .get(`/api/v1/turnos/${shift.id}/registros`)
      .set(supervisorAuth)
      .expect(200);

    const shiftRecords = shiftRecordsResponseSchema.parse(resSupervisor.body as unknown);
    expect(shiftRecords).toMatchObject({
      shiftId: shift.id,
      phoneWithoutNfc: true,
    });
    const detail = await client
      .get(`/api/v1/turnos/${shift.id}/detalle`)
      .set(supervisorAuth)
      .expect(200);
    expect(detail.body).toMatchObject({ id: shift.id, phoneWithoutNfc: true });
    expect(shiftRecords.records).toHaveLength(4);
    const recordForId = (recordId: string) => {
      const record = shiftRecords.records.find((candidate) => candidate.recordId === recordId);
      if (!record) throw new Error(`No se encontró el registro ${recordId}`);
      return record;
    };

    const r1 = recordForId(rec1Id);
    expect(r1.flags).toContainEqual(
      expect.objectContaining({ type: 'out_of_range', severity: 'media' }),
    );
    expect(r1.flags).toContainEqual(
      expect.objectContaining({
        type: 'qr_on_tagged_point',
        severity: 'media',
        reason: 'nfc_on',
      }),
    );

    const r2 = recordForId(rec2Id);
    expect(r2.flags).toContainEqual(
      expect.objectContaining({ type: 'simulated_location', severity: 'grave' }),
    );

    const r3 = recordForId(rec3Id);
    expect(r3.flags).toHaveLength(0); // Sin marca por celular sin NFC

    const r4 = recordForId(rec4Id);
    expect(r4.flags).toContainEqual(
      expect.objectContaining({ type: 'impossible_time', severity: 'grave' }),
    );

    // Filtro marcados=true
    const resMarcados = await client
      .get(`/api/v1/turnos/${shift.id}/registros?marcados=true`)
      .set(supervisorAuth)
      .expect(200);
    const markedRecords = shiftRecordsResponseSchema.parse(resMarcados.body as unknown);
    expect(markedRecords.records).toHaveLength(3);
    expect(markedRecords.records.some((record) => record.recordId === rec3Id)).toBe(false);

    // Filtro por gravedad=grave
    const resGraves = await client
      .get(`/api/v1/turnos/${shift.id}/registros?marcados=true&gravedad=grave`)
      .set(supervisorAuth)
      .expect(200);
    const graveRecords = shiftRecordsResponseSchema.parse(resGraves.body as unknown);
    expect(graveRecords.records).toHaveLength(2);
    expect(
      graveRecords.records.every((record) =>
        record.flags.every((flag) => flag.severity === 'grave'),
      ),
    ).toBe(true);

    // 3. Configuración de velocidad máxima de recorrido (PATCH /predios/:id/recorrido)
    // Sin autenticación -> 401
    await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .send({ maxSpeedProfile: 'walking' })
      .expect(401);

    // Rol guard -> 403
    await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .set(guardAuth)
      .send({ maxSpeedProfile: 'walking' })
      .expect(403);

    // Supervisor no asignado -> 404
    await client
      .patch(`/api/v1/predios/${northUnassignedSiteId}/recorrido`)
      .set(supervisorAuth)
      .send({ maxSpeedProfile: 'walking' })
      .expect(404);

    // Predio de otra empresa -> 404
    await client
      .patch(`/api/v1/predios/${southSiteId}/recorrido`)
      .set(supervisorAuth)
      .send({ maxSpeedProfile: 'walking' })
      .expect(404);

    // Validación 5-120: menor a 5 -> 400
    await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .set(supervisorAuth)
      .send({ maxSpeedProfile: 'walking', maxSpeedKmh: 4 })
      .expect(400);

    // Validación 5-120: mayor a 120 -> 400
    await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .set(supervisorAuth)
      .send({ maxSpeedProfile: 'walking', maxSpeedKmh: 121 })
      .expect(400);

    // Perfil custom sin indicar velocidad -> 400
    await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .set(supervisorAuth)
      .send({ maxSpeedProfile: 'custom' })
      .expect(400);

    // Actualización exitosa por supervisor asignado
    const resSpeedSup = await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .set(supervisorAuth)
      .send({ maxSpeedProfile: 'vehicle' })
      .expect(200);
    const vehicleSpeed = siteResponseSchema.parse(resSpeedSup.body as unknown);
    expect(vehicleSpeed.maxSpeedProfile).toBe('vehicle');
    expect(vehicleSpeed.maxSpeedKmh).toBe(60);

    // Actualización exitosa por admin con perfil custom
    const resSpeedAdmin = await client
      .patch(`/api/v1/predios/${northAssignedSiteId}/recorrido`)
      .set(adminAuth)
      .send({ maxSpeedProfile: 'custom', maxSpeedKmh: 45 })
      .expect(200);
    const customSpeed = siteResponseSchema.parse(resSpeedAdmin.body as unknown);
    expect(customSpeed.maxSpeedProfile).toBe('custom');
    expect(customSpeed.maxSpeedKmh).toBe(45);

    // 4. Evaluador roto no impide guardar el registro (CA5)
    const marcasService = app.get(MarcasService);
    const spy = jest
      .spyOn(marcasService, 'evaluateRecord')
      .mockRejectedValueOnce(new Error('Fallo crítico forzado'));
    const rec5Id = randomUUID();
    const resBroken = await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: rec5Id,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrFar,
        occurredAtDevice: '2026-11-25T02:15:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6037 + 500 / 111195,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          takenAt: '2026-11-25T02:15:00.000Z',
        },
        phoneNfc: 'on',
      })
      .expect(200);
    expect(checkpointRecordResponseSchema.parse(resBroken.body as unknown).result).toBe('recorded');
    spy.mockRestore();

    const savedInDb = await prisma.checkpointRecord.findUnique({
      where: { recordId: rec5Id },
    });
    expect(savedInDb).not.toBeNull();
  });

  it('HU-34: permisos de los tres endpoints de conectividad', async () => {
    const http = request(app.getHttpServer());
    const conn = { type: 'without_signal', minutesToSignal: 180, marginMinutes: 20 };
    for (const endpoint of ['get', 'put', 'simulate'] as const) {
      const call = (id: string, token?: string) => {
        const url = `/api/v1/predios/${id}/conectividad`;
        const req =
          endpoint === 'put'
            ? http.put(url).send(conn)
            : endpoint === 'simulate'
              ? http
                  .get(`${url}/simular`)
                  .query({ inicio: '2031-01-01T13:00:00-03:00', fin: '2031-01-01T15:00:00-03:00' })
              : http.get(url);
        return token ? req.set('Authorization', `Bearer ${token}`) : req;
      };
      await call(northAssignedSiteId).expect(401);
      await call(northAssignedSiteId, 'token-guard').expect(403);
      await call(northAssignedSiteId, 'token-client').expect(403);
      await call(southSiteId, 'token-admin').expect(404);
      await call(northUnassignedSiteId, 'token-supervisor').expect(404);
    }
  });

  it('HU-34 CA1-CA4: ventana inclusiva, snapshot y cierre max con job BullMQ', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const http = request(app.getHttpServer());
    const previousNow = testNow;
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const client = await prisma.client.findFirstOrThrow({ where: { companyId: 'norte-company' } });
    const site = await prisma.site.create({
      data: {
        companyId: 'norte-company',
        clientId: client.id,
        name: `Conectividad ${randomUUID()}`,
        address: 'Campo',
        latitude: -34,
        longitude: -58,
        supervisors: { create: { companyId: 'norte-company', userId: northSupervisorId } },
      },
    });
    const guard = await prisma.user.create({
      data: {
        companyId: 'norte-company',
        firebaseUid: 'e2e-connectivity-guard',
        firstName: 'Prueba',
        lastName: 'Conectividad',
        email: 'connectivity@e2e.invalid',
        role: 'guard',
        status: 'active',
      },
    });
    const ids: string[] = [];
    const queue = app.get<Queue>(getQueueToken(SHIFT_AUTO_CLOSE_QUEUE));
    try {
      const url = `/api/v1/predios/${site.id}/conectividad`;
      const conn = { type: 'without_signal', minutesToSignal: 180, marginMinutes: 20 };
      await http
        .put(url)
        .set('Authorization', 'Bearer token-admin')
        .send({ ...conn, minutesToSignal: 0 })
        .expect(400);
      for (const invalid of [
        { minutesToSignal: 721 },
        { marginMinutes: 181 },
        { minutesToSignal: -1 },
        { marginMinutes: -1 },
      ])
        await http
          .put(url)
          .set('Authorization', 'Bearer token-admin')
          .send({ ...conn, ...invalid })
          .expect(400);
      const startedSaving = performance.now();
      await http.put(url).set('Authorization', 'Bearer token-admin').send(conn).expect(200);
      expect(performance.now() - startedSaving).toBeLessThan(1000);
      const get = await http.get(url).set('Authorization', 'Bearer token-supervisor').expect(200);
      expect(get.body).toEqual(conn);
      const simulation = await http
        .get(`${url}/simular`)
        .set('Authorization', 'Bearer token-supervisor')
        .query({ inicio: '2031-01-01T13:00:00-03:00', fin: '2031-01-01T15:00:00-03:00' })
        .expect(200);
      expect(simulation.body).toEqual({
        startFrom: '2031-01-01T12:40:00.000Z',
        syncDeadline: '2031-01-01T21:20:00.000Z',
      });
      await http
        .get(`${url}/simular`)
        .set('Authorization', 'Bearer token-admin')
        .query({ inicio: 'bad', fin: 'bad' })
        .expect(400);
      await http
        .get(`${url}/simular`)
        .set('Authorization', 'Bearer token-admin')
        .query({ inicio: '2031-01-02T13:00:00Z', fin: '2031-01-01T15:00:00Z' })
        .expect(400);
      const make = async (day: number) => {
        const startsAt = new Date(`2031-01-0${day}T16:00:00Z`);
        const endsAt = new Date(`2031-01-0${day}T18:00:00Z`);
        const shift = await prisma.shift.create({
          data: {
            companyId: 'norte-company',
            siteId: site.id,
            startsAt,
            endsAt,
            serviceDate: new Date(`2031-01-0${day}T00:00:00Z`),
            createdById: actor.id,
            assignments: {
              create: { guardId: guard.id, startsAt, endsAt, assignedById: actor.id },
            },
          },
        });
        ids.push(shift.id);
        return shift;
      };
      const shift = await make(1);
      const next = await make(2);
      const body = {
        eventId: randomUUID(),
        occurredAtDevice: '2031-01-01T12:00:00Z',
        location: {
          status: 'disabled',
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          simulation: 'unavailable',
          takenAt: null,
        },
      };
      testNow = new Date('2031-01-01T12:00:00Z');
      const rejected = await http
        .post(`/api/v1/turnos/${shift.id}/iniciar`)
        .set('Authorization', 'Bearer token-connectivity')
        .send(body)
        .expect(422);
      expect(rejected.body).toMatchObject({
        code: 'OUTSIDE_START_MARGIN',
        startFrom: '2031-01-01T12:40:00.000Z',
        timezone: 'America/Argentina/Buenos_Aires',
      });
      testNow = new Date('2031-01-01T12:40:00Z');
      await http
        .post(`/api/v1/turnos/${shift.id}/iniciar`)
        .set('Authorization', 'Bearer token-connectivity')
        .send(body)
        .expect(201);
      const snapshot = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
      expect(snapshot).toMatchObject({
        connectivityType: 'without_signal',
        minutesToSignal: 180,
        marginMinutes: 20,
        syncDeadlineAt: new Date('2031-01-01T21:20:00Z'),
      });
      const job = await queue.getJob(`shift-auto-close-${shift.id}`);
      expect(job?.delay).toBe(520 * 60_000);
      await http
        .put(url)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ ...conn, marginMinutes: 60 })
        .expect(200);
      const data = await http
        .get(`/api/v1/turnos/${shift.id}/datos`)
        .set('Authorization', 'Bearer token-connectivity')
        .expect(200);
      expect(startShiftResponseSchema.shape.data.parse(data.body).shift.syncDeadlineAt).toBe(
        '2031-01-01T21:20:00.000Z',
      );
      const port = app.get<SyncDeadlinePort>(SYNC_DEADLINE_PORT);
      // Use an authenticated endpoint for tenant queries; system auto-close consumes the frozen snapshot.
      expect(typeof port.deadlineForShift).toBe('function');
      testNow = new Date('2031-01-01T21:19:59Z');
      await expect(app.get(ShiftExecutionService).autoClose(shift.id)).resolves.toBe(false);
      testNow = new Date('2031-01-01T21:20:00Z');
      await expect(app.get(ShiftExecutionService).autoClose(shift.id)).resolves.toBe(true);
      // Next shift picks the new margin: 13:00 minus four hours is 09:00.
      testNow = new Date('2031-01-02T12:00:00Z');
      const nextStart = await http
        .post(`/api/v1/turnos/${next.id}/iniciar`)
        .set('Authorization', 'Bearer token-connectivity')
        .send({ ...body, eventId: randomUUID(), occurredAtDevice: testNow.toISOString() })
        .expect(201);
      expect(startShiftResponseSchema.parse(nextStart.body).data.shift.syncDeadlineAt).toBe(
        '2031-01-02T22:00:00.000Z',
      );
    } finally {
      testNow = previousNow;
      for (const id of ids) await (await queue.getJob(`shift-auto-close-${id}`))?.remove();
      await prisma.shift.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.delete({ where: { id: guard.id } });
      await prisma.siteSupervisor.deleteMany({ where: { siteId: site.id } });
      await prisma.site.delete({ where: { id: site.id } });
    }
  }, 30000);

  it('HU-27 nuevos endpoints requieren token, administrador y cliente de la empresa', async () => {
    const prisma = app.get(PrismaService).systemPrisma;

    const north = await prisma.client.findFirstOrThrow({ where: { companyId: 'norte-company' } });

    const south = await prisma.client.findFirstOrThrow({ where: { companyId: 'sur-company' } });

    for (const method of ['get', 'post'] as const) {
      await request(app.getHttpServer())
        [method](`/api/v1/clientes/${north.id}/usuarios`)

        .send({})

        .expect(401);

      await request(app.getHttpServer())
        [method](`/api/v1/clientes/${north.id}/usuarios`)

        .set('Authorization', 'Bearer token-supervisor')

        .send({})

        .expect(403);

      await request(app.getHttpServer())
        [method](`/api/v1/clientes/${south.id}/usuarios`)

        .set('Authorization', 'Bearer token-admin')

        .send({ firstName: 'Marta', lastName: 'Ruiz', email: 'hu27-permisos@example.invalid' })

        .expect(404);
    }
  });

  it('reasigna por HTTP, conserva el historial y arbitra la carrera con el inicio', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const savedNow = testNow;
    const source = await prisma.user.upsert({
      where: { firebaseUid: 'tenant-test-reassignment-source' },
      create: {
        companyId: 'norte-company',
        firebaseUid: 'tenant-test-reassignment-source',
        email: 'tenant-test-reassignment-source@example.invalid',
        firstName: 'Pedro',
        lastName: 'Original',
        role: 'guard',
        status: 'active',
      },
      update: { status: 'active' },
    });
    const replacement = await prisma.user.upsert({
      where: { firebaseUid: 'tenant-test-replacement' },
      create: {
        companyId: 'norte-company',
        firebaseUid: 'tenant-test-replacement',
        email: 'tenant-test-replacement@example.invalid',
        firstName: 'Juan',
        lastName: 'Reemplazo',
        role: 'guard',
        status: 'active',
      },
      update: { status: 'active' },
    });
    const round = await prisma.round.findUniqueOrThrow({
      where: { siteId_name: { siteId: northAssignedSiteId, name: 'Perimetral' } },
    });
    const notices = jest.spyOn(app.get<NoticesPort>(NOTICES_PORT), 'resolve');
    const notifications = jest
      .spyOn(app.get(NotificationsService), 'notifyUsers')
      .mockResolvedValue();
    const client = request(app.getHttpServer());
    const makeShift = async (start: string, end: string, guardId: string | null = source.id) => {
      const currentNow = testNow;
      testNow = new Date(Date.parse(start) - 60 * 60_000);
      try {
        const response = await client
          .post('/api/v1/turnos')
          .set('Authorization', 'Bearer token-supervisor')
          .send({
            siteId: northAssignedSiteId,
            guardId,
            startsAt: start,
            endsAt: end,
            roundIds: [round.id],
          })
          .expect(201);
        const { id } = z.object({ id: z.string() }).parse(response.body);
        createdShiftIds.push(id);
        return await prisma.shift.findUniqueOrThrow({ where: { id } });
      } finally {
        testNow = currentNow;
      }
    };
    try {
      testNow = new Date('2030-01-01T20:20:00Z');
      const shift = await makeShift('2030-01-01T20:00:00Z', '2030-01-02T08:00:00Z');
      const old = await prisma.shiftAssignment.findFirstOrThrow({ where: { shiftId: shift.id } });
      const path = `/api/v1/turnos/${shift.id}/reasignar`;
      for (const suffix of ['asignaciones', 'reemplazos']) {
        const readPath = `/api/v1/turnos/${shift.id}/${suffix}`;
        await client.get(readPath).expect(401);
        for (const token of ['token-guard', 'token-client'])
          await client.get(readPath).set('Authorization', `Bearer ${token}`).expect(403);
        for (const token of ['token-other-supervisor', 'token-south-admin'])
          await client.get(readPath).set('Authorization', `Bearer ${token}`).expect(404);
      }
      await client.post(path).send({ guardId: replacement.id }).expect(401);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-reassignment-source')
        .send({ guardId: replacement.id })
        .expect(403);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-client')
        .send({ guardId: replacement.id })
        .expect(403);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-other-supervisor')
        .send({ guardId: replacement.id })
        .expect(404);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-south-admin')
        .send({ guardId: replacement.id })
        .expect(404);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: source.id })
        .expect(400);
      const pending = await prisma.user.findUniqueOrThrow({
        where: { firebaseUid: 'seed-norte-pending' },
      });
      await client
        .post(path)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: pending.id })
        .expect(400);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: replacement.id, startsAt: '2030-01-02T09:00:00Z' })
        .expect(400);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: replacement.id, startsAt: '2030-01-01T20:19:00Z' })
        .expect(400);
      const availablePath = `/api/v1/turnos/${shift.id}/reemplazos`;
      const available = await client
        .get(availablePath)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      const availableIds = z
        .array(z.object({ id: z.string() }))
        .parse(available.body)
        .map(({ id }) => id);
      expect(availableIds).toContain(replacement.id);
      expect(availableIds).not.toContain(source.id);
      expect(availableIds).not.toContain(pending.id);
      await client
        .get(`${availablePath}?startsAt=invalid`)
        .set('Authorization', 'Bearer token-admin')
        .expect(400);
      const overlapped = await makeShift(
        '2030-01-01T22:00:00Z',
        '2030-01-02T08:00:00Z',
        replacement.id,
      );
      const unavailable = await client
        .get(availablePath)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      expect(
        z
          .array(z.object({ id: z.string() }))
          .parse(unavailable.body)
          .map(({ id }) => id),
      ).not.toContain(replacement.id);
      await client
        .post(path)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ guardId: replacement.id })
        .expect(409);
      const beforeCancel = testNow;
      testNow = new Date('2030-01-01T19:00:00Z');
      await client
        .post(`/api/v1/turnos/${overlapped.id}/cancelar`)
        .set('Authorization', 'Bearer token-admin')
        .send({})
        .expect(201);
      testNow = beforeCancel;
      const openNotice = await prisma.notice.create({
        data: {
          companyId: 'norte-company',
          siteId: shift.siteId,
          shiftId: shift.id,
          kind: 'shift_not_started',
          subjectId: old.id,
          key: noticeKey('shift_not_started', old.id),
        },
      });
      const requestedAt = performance.now();
      const assigned = await client
        .post(path)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ guardId: replacement.id, startsAt: '2030-01-01T21:00:00Z' })
        .expect(201);
      expect(performance.now() - requestedAt).toBeLessThan(1000);
      expect(z.object({ assignmentId: z.string() }).parse(assigned.body).assignmentId).toBeTruthy();
      expect(
        await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: old.id } }),
      ).toMatchObject({ result: 'absent', isCurrent: false });
      expect(await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).toMatchObject({
        individuallyModified: true,
      });
      expect(notices).toHaveBeenCalledWith({
        companyId: 'norte-company',
        kind: 'shift_not_started',
        subjectId: old.id,
        resolution: 'reassigned',
      });
      const resolvedNotice = await prisma.notice.findUniqueOrThrow({
        where: { id: openNotice.id },
      });
      expect(resolvedNotice).toMatchObject({ status: 'resolved', resolution: 'reassigned' });
      expect(resolvedNotice.resolvedAt).toBeInstanceOf(Date);
      expect(notifications).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: [source.id], kind: 'shift_reassigned_from_you' }),
      );
      expect(notifications).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: [replacement.id], kind: 'shift_reassigned_to_you' }),
      );
      const history = await client
        .get(`/api/v1/turnos/${shift.id}/asignaciones`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      expect(
        z
          .array(z.object({ result: z.string(), assignedBy: z.object({ firstName: z.string() }) }))
          .parse(history.body),
      ).toHaveLength(2);
      const location = {
        status: 'ok',
        latitude: -34.6,
        longitude: -58.4,
        accuracyMeters: 5,
        simulation: 'not_simulated',
        takenAt: '2030-01-01T21:10:00Z',
      };
      testNow = new Date('2030-01-01T21:10:00Z');
      await client
        .post(`/api/v1/turnos/${shift.id}/iniciar`)
        .set('Authorization', 'Bearer token-reassignment-source')
        .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
        .expect(409);
      const started = await client
        .post(`/api/v1/turnos/${shift.id}/iniciar`)
        .set('Authorization', 'Bearer token-replacement')
        .send({ eventId: randomUUID(), occurredAtDevice: testNow.toISOString(), location })
        .expect(201);
      expect(z.object({ lateStartMinutes: z.number() }).parse(started.body).lateStartMinutes).toBe(
        10,
      );
      await client
        .post(path)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: source.id })
        .expect(409);
      await client
        .post(`/api/v1/turnos/${shift.id}/cerrar`)
        .set('Authorization', 'Bearer token-replacement')
        .send({
          eventId: randomUUID(),
          occurredAtDevice: testNow.toISOString(),
          location,
          reason: 'Fin de la prueba',
        })
        .expect(201);
      testNow = new Date('2030-01-02T20:10:00Z');
      const race = await makeShift('2030-01-02T20:00:00Z', '2030-01-03T08:00:00Z');
      const [startRace, reassignRace] = await Promise.all([
        client
          .post(`/api/v1/turnos/${race.id}/iniciar`)
          .set('Authorization', 'Bearer token-reassignment-source')
          .send({
            eventId: randomUUID(),
            occurredAtDevice: testNow.toISOString(),
            location: { ...location, takenAt: testNow.toISOString() },
          }),
        client
          .post(`/api/v1/turnos/${race.id}/reasignar`)
          .set('Authorization', 'Bearer token-admin')
          .send({ guardId: replacement.id }),
      ]);
      expect([startRace.status, reassignRace.status].sort()).toEqual([201, 409]);
      expect(
        z
          .object({ code: z.string() })
          .parse((startRace.status === 409 ? startRace : reassignRace).body).code,
      ).toBeTruthy();
      await prisma.shift.update({ where: { id: race.id }, data: { status: 'closed' } });

      testNow = new Date('2030-01-04T20:20:00Z');
      const repeated = await makeShift('2030-01-04T20:00:00Z', '2030-01-05T08:00:00Z');
      await client
        .post(`/api/v1/turnos/${repeated.id}/reasignar`)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: replacement.id, startsAt: '2030-01-04T21:00:00Z' })
        .expect(201);
      testNow = new Date('2030-01-04T20:40:00Z');
      await client
        .post(`/api/v1/turnos/${repeated.id}/reasignar`)
        .set('Authorization', 'Bearer token-admin')
        .send({ guardId: source.id })
        .expect(201);
      const repeatedHistory = await prisma.shiftAssignment.findMany({
        where: { shiftId: repeated.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(repeatedHistory.map((assignment) => assignment.result)).toEqual([
        'absent',
        'replaced',
        'scheduled',
      ]);
      const repeatedDetail = await client
        .get(`/api/v1/turnos/${repeated.id}/detalle`)
        .set('Authorization', 'Bearer token-supervisor')
        .expect(200);
      expect(
        z
          .object({ assignments: z.array(z.object({ id: z.string() })) })
          .parse(repeatedDetail.body)
          .assignments.map(({ id }) => id),
      ).toEqual(repeatedHistory.map(({ id }) => id));
      testNow = new Date('2030-01-04T21:05:00Z');
      await client
        .post(`/api/v1/turnos/${repeated.id}/reasignar`)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ guardId: replacement.id })
        .expect(201);
      expect(
        (
          await prisma.shiftAssignment.findMany({
            where: { shiftId: repeated.id },
            orderBy: { createdAt: 'asc' },
          })
        ).map(({ result }) => result),
      ).toEqual(['absent', 'replaced', 'absent', 'scheduled']);

      testNow = new Date('2030-01-06T20:05:00Z');
      const early = await makeShift('2030-01-06T20:00:00Z', '2030-01-07T08:00:00Z');
      await client
        .post(`/api/v1/turnos/${early.id}/iniciar`)
        .set('Authorization', 'Bearer token-reassignment-source')
        .send({
          eventId: randomUUID(),
          occurredAtDevice: testNow.toISOString(),
          location: { ...location, takenAt: testNow.toISOString() },
        })
        .expect(201);
      testNow = new Date('2030-01-06T21:00:00Z');
      await client
        .post(`/api/v1/turnos/${early.id}/cerrar`)
        .set('Authorization', 'Bearer token-reassignment-source')
        .send({
          eventId: randomUUID(),
          occurredAtDevice: testNow.toISOString(),
          reason: 'Me descompuse',
          location: { ...location, takenAt: testNow.toISOString() },
        })
        .expect(201);
      expect(
        await prisma.shiftAssignment.findFirstOrThrow({
          where: { shiftId: early.id, isCurrent: true },
        }),
      ).toMatchObject({ result: 'closed_early' });
      await client
        .post(`/api/v1/turnos/${early.id}/reasignar`)
        .set('Authorization', 'Bearer token-supervisor')
        .send({ guardId: replacement.id, startsAt: '2030-01-06T22:00:00Z' })
        .expect(201);
      const earlyHistory = await prisma.shiftAssignment.findMany({
        where: { shiftId: early.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(earlyHistory.map((assignment) => assignment.result)).toEqual([
        'closed_early',
        'scheduled',
      ]);
      expect(notices).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'shift_closed_early',
          subjectId: earlyHistory[0]?.id,
          resolution: 'covered',
        }),
      );
      testNow = new Date('2030-01-06T22:10:00Z');
      const restartEventId = randomUUID();
      const restartBody = {
        eventId: restartEventId,
        occurredAtDevice: testNow.toISOString(),
        location: { ...location, takenAt: testNow.toISOString() },
      };
      const restarted = await client
        .post(`/api/v1/turnos/${early.id}/iniciar`)
        .set('Authorization', 'Bearer token-replacement')
        .send(restartBody)
        .expect(201);
      const replayed = await client
        .post(`/api/v1/turnos/${early.id}/iniciar`)
        .set('Authorization', 'Bearer token-replacement')
        .send(restartBody)
        .expect(201);
      expect(
        z.object({ lateStartMinutes: z.number() }).parse(restarted.body).lateStartMinutes,
      ).toBe(10);
      expect(z.object({ startedAt: z.string() }).parse(replayed.body).startedAt).toBe(
        testNow.toISOString(),
      );

      testNow = new Date('2030-01-08T20:20:00Z');
      const unassigned = await makeShift('2030-01-08T20:00:00Z', '2030-01-09T08:00:00Z', null);
      const site = await prisma.site.findUniqueOrThrow({ where: { id: northAssignedSiteId } });
      try {
        await prisma.site.update({
          where: { id: site.id },
          data: { connectivityType: 'without_signal', minutesToSignal: 200 },
        });
        const response = await client
          .post(`/api/v1/turnos/${unassigned.id}/reasignar`)
          .set('Authorization', 'Bearer token-supervisor')
          .send({ guardId: replacement.id, startsAt: '2030-01-09T07:00:00Z' })
          .expect(201);
        expect(z.object({ warning: z.string() }).parse(response.body).warning).toBe(
          'replacement_late',
        );
        expect(notices).toHaveBeenCalledWith({
          companyId: 'norte-company',
          kind: 'shift_without_guard',
          subjectId: unassigned.id,
          resolution: 'guard_assigned',
        });
      } finally {
        await prisma.site.update({
          where: { id: site.id },
          data: { connectivityType: site.connectivityType, minutesToSignal: site.minutesToSignal },
        });
      }
    } finally {
      testNow = savedNow;
      notices.mockRestore();
      notifications.mockRestore();
    }
  }, 60_000);
  it('marca visto por usuario, es idempotente y respeta permisos por HTTP', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-13T10:00:00Z'),
        endsAt: new Date('2026-10-13T11:00:00Z'),
        serviceDate: new Date('2026-10-13T00:00:00Z'),
        createdById: northSupervisorId,
      },
    });
    createdShiftIds.push(shift.id);
    const notice = await prisma.notice.create({
      data: {
        companyId: shift.companyId,
        siteId: shift.siteId,
        shiftId: shift.id,
        kind: 'shift_unsynced',
        subjectId: shift.id,
        key: noticeKey('shift_unsynced', shift.id),
      },
    });
    const http = request(app.getHttpServer());
    const path = `/api/v1/avisos/${notice.id}`;
    const seenPath = `${path}/marcar-visto`;
    await http.post(seenPath).expect(401);
    for (const token of ['token-guard', 'token-client']) {
      await http.post(seenPath).set('Authorization', `Bearer ${token}`).expect(403);
    }
    for (const token of ['token-other-supervisor', 'token-south-admin']) {
      await http.post(seenPath).set('Authorization', `Bearer ${token}`).expect(404);
    }
    await http
      .post('/api/v1/avisos/no-existe/marcar-visto')
      .set('Authorization', 'Bearer token-admin')
      .expect(404);
    const assignment = await prisma.siteSupervisor.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        userId: otherSupervisorId,
      },
    });
    try {
      const list = async (token: string) =>
        noticesListResponseSchema.parse(
          (
            await http
              .get('/api/v1/avisos?estado=open')
              .set('Authorization', `Bearer ${token}`)
              .expect(200)
          ).body,
        );
      const beforeFirst = await list('token-supervisor');
      const beforeOther = await list('token-other-supervisor');
      expect(beforeFirst.items.find((item) => item.id === notice.id)?.seenAt).toBeNull();
      expect(beforeOther.items.find((item) => item.id === notice.id)?.seenAt).toBeNull();
      const first = noticeSchema.parse(
        (await http.post(seenPath).set('Authorization', 'Bearer token-supervisor').expect(200))
          .body,
      );
      const second = noticeSchema.parse(
        (await http.post(seenPath).set('Authorization', 'Bearer token-supervisor').expect(200))
          .body,
      );
      expect(first.seenAt).not.toBeNull();
      expect(second.seenAt).toBe(first.seenAt);
      expect(await prisma.noticeView.count({ where: { noticeId: notice.id } })).toBe(1);
      const afterFirst = await list('token-supervisor');
      const afterOther = await list('token-other-supervisor');
      expect(afterFirst.unseenOpenCount).toBe(beforeFirst.unseenOpenCount - 1);
      expect(afterFirst.openCount).toBe(beforeFirst.openCount);
      expect(afterOther.unseenOpenCount).toBe(beforeOther.unseenOpenCount);
      expect(afterFirst.items.find((item) => item.id === notice.id)?.seenAt).toBe(first.seenAt);
      expect(
        noticeSchema.parse(
          (await http.get(path).set('Authorization', 'Bearer token-other-supervisor').expect(200))
            .body,
        ).seenAt,
      ).toBeNull();
      expect(
        noticeSchema.parse(
          (await http.get(path).set('Authorization', 'Bearer token-supervisor').expect(200)).body,
        ).seenAt,
      ).toBe(first.seenAt);
      await http.post(seenPath).set('Authorization', 'Bearer token-admin').expect(200);
      expect(await prisma.noticeView.count({ where: { noticeId: notice.id } })).toBe(2);
    } finally {
      await prisma.siteSupervisor.delete({ where: { id: assignment.id } });
    }
  });

  it('aísla avisos por HTTP y cierra sin datos solo el turno avisado', async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northAssignedSiteId,
        startsAt: new Date('2026-10-13T10:00:00Z'),
        endsAt: new Date('2026-10-13T11:00:00Z'),
        serviceDate: new Date('2026-10-13T00:00:00Z'),
        createdById: northSupervisorId,
        status: 'auto_closed',
        startedAt: new Date('2026-10-13T10:00:00Z'),
        syncDeadlineAt: new Date('2026-10-13T11:30:00Z'),
      },
    });
    createdShiftIds.push(shift.id);
    const roundName = `Aviso sin datos ${randomUUID()}`;
    const round = await prisma.round.create({
      data: { companyId: shift.companyId, siteId: shift.siteId, name: roundName },
    });
    createdRoundNames.push(roundName);
    const window = await prisma.roundWindowState.create({
      data: {
        companyId: shift.companyId,
        shiftId: shift.id,
        roundId: round.id,
        windowIndex: 0,
        startsAt: new Date('2026-10-13T10:00:00Z'),
        endsAt: new Date('2026-10-13T11:00:00Z'),
        graceEndsAt: new Date('2026-10-13T11:15:00Z'),
        expectedCount: 1,
        status: 'pending_sync',
      },
    });
    const notices = app.get<NoticesPort>(NOTICES_PORT);
    const notify = jest
      .spyOn(app.get(NotificationsService), 'notifySiteStaff')
      .mockResolvedValue(undefined);
    const input = {
      companyId: shift.companyId,
      siteId: shift.siteId,
      shiftId: shift.id,
      kind: 'shift_unsynced' as const,
      subjectId: shift.id,
    };
    await notices.raise(input);
    await notices.raise(input);
    expect(notify).toHaveBeenCalledTimes(1);
    notify.mockRestore();
    expect(await prisma.notice.count({ where: { key: `shift_unsynced:${shift.id}` } })).toBe(1);
    const http = request(app.getHttpServer());
    const list = '/api/v1/avisos';
    const detail = `${list}/${(await prisma.notice.findUniqueOrThrow({ where: { key: `shift_unsynced:${shift.id}` } })).id}`;
    const close = `/api/v1/turnos/${shift.id}/cerrar-sin-datos`;
    for (const url of [list, detail, close]) {
      const call = url === close ? http.post(url).send({ reason: 'Celular roto' }) : http.get(url);
      await call.expect(401);
      const forbidden =
        url === close
          ? http
              .post(url)
              .set('Authorization', 'Bearer token-client')
              .send({ reason: 'Celular roto' })
          : http.get(url).set('Authorization', 'Bearer token-client');
      await forbidden.expect(403);
      const guardCall =
        url === close
          ? http
              .post(url)
              .set('Authorization', 'Bearer token-guard')
              .send({ reason: 'Celular roto' })
          : http.get(url).set('Authorization', 'Bearer token-guard');
      await guardCall.expect(403);
      const hidden =
        url === close
          ? http
              .post(url)
              .set('Authorization', 'Bearer token-other-supervisor')
              .send({ reason: 'Celular roto' })
          : http.get(url).set('Authorization', 'Bearer token-other-supervisor');
      if (url === list) {
        const response = await hidden.expect(200);
        expect(
          z.object({ items: z.array(z.object({ shiftId: z.string() })) }).parse(response.body)
            .items,
        ).not.toEqual(expect.arrayContaining([expect.objectContaining({ shiftId: shift.id })]));
      } else await hidden.expect(404);
    }
    await http.get(detail).set('Authorization', 'Bearer token-south-admin').expect(404);
    await http
      .post(close)
      .set('Authorization', 'Bearer token-south-admin')
      .send({ reason: 'Celular roto' })
      .expect(404);
    await http.get(list).set('Authorization', 'Bearer token-supervisor').expect(200);
    await http.get(detail).set('Authorization', 'Bearer token-supervisor').expect(200);
    await http
      .post(close)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ reason: 'abcd' })
      .expect(400);
    await http
      .post(close)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ reason: 'Celular roto' })
      .expect(201);
    await http
      .post(close)
      .set('Authorization', 'Bearer token-supervisor')
      .send({ reason: 'Celular roto' })
      .expect(409);
    expect(
      (await prisma.notice.findUniqueOrThrow({ where: { key: `shift_unsynced:${shift.id}` } }))
        .resolution,
    ).toBe('closed_without_data');
    expect(
      (await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).closedWithoutDataById,
    ).toBe(northSupervisorId);
    expect(
      (await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } })).status,
    ).toBe('not_done');
    const overview = await http
      .get('/api/v1/supervision/turnos?fecha=2026-10-13')
      .set('Authorization', 'Bearer token-supervisor')
      .expect(200);
    expect(
      z
        .array(
          z.object({ id: z.string(), syncStatus: z.object({ status: z.string() }).nullable() }),
        )
        .parse(overview.body)
        .find((item) => item.id === shift.id)?.syncStatus?.status,
    ).toBe('cerrado_sin_datos');
  });

  it.each([true, false])(
    'espera sincronización y procesa el lote tardío sin falsas alarmas (aviso previo: %s)',
    async (missedBeforeBatch) => {
      const previousNow = testNow;
      const notify = jest
        .spyOn(app.get(NotificationsService), 'notifySiteStaff')
        .mockResolvedValue(undefined);
      testNow = new Date('2026-10-13T11:30:00Z');
      const prisma = app.get(PrismaService).systemPrisma;
      const guard = await prisma.user.create({
        data: {
          companyId: 'norte-company',
          firebaseUid: `tenant-test-notices-${randomUUID()}`,
          email: `notices-${randomUUID()}@example.invalid`,
          firstName: 'Prueba',
          lastName: 'Avisos',
          role: 'guard',
          status: 'active',
        },
      });
      try {
        const checkpoint = await prisma.checkpoint.create({
          data: {
            companyId: 'norte-company',
            siteId: northAssignedSiteId,
            name: `Avisos ${randomUUID()}`,
            latitude: -34.6,
            longitude: -58.4,
          },
        });
        createdCheckpointIds.push(checkpoint.id);
        const checkpointId = checkpoint.id;
        const roundName = `Lote avisos ${randomUUID()}`;
        const round = await prisma.round.create({
          data: { companyId: 'norte-company', siteId: northAssignedSiteId, name: roundName },
        });
        createdRoundNames.push(roundName);
        const version = await prisma.roundVersion.create({
          data: {
            roundId: round.id,
            versionNumber: 1,
            frequencyMinutes: 60,
            windowStartLocal: '07:00',
            windowEndLocal: '08:00',
            graceMinutes: 15,
            createdById: northSupervisorId,
            checkpoints: { create: { companyId: 'norte-company', checkpointId, position: 0 } },
          },
        });
        await prisma.round.update({
          where: { id: round.id },
          data: { currentVersionId: version.id },
        });
        const shift = await prisma.shift.create({
          data: {
            companyId: 'norte-company',
            siteId: northAssignedSiteId,
            startsAt: new Date('2026-10-13T10:00:00Z'),
            endsAt: new Date('2026-10-13T11:00:00Z'),
            serviceDate: new Date('2026-10-13T00:00:00Z'),
            createdById: northSupervisorId,
            status: 'auto_closed',
            startedAt: new Date('2026-10-13T10:00:00Z'),
            syncDeadlineAt: testNow,
            connectivityType: 'without_signal',
            assignments: {
              create: {
                guardId: guard.id,
                assignedById: northSupervisorId,
                startsAt: new Date('2026-10-13T10:00:00Z'),
                endsAt: new Date('2026-10-13T11:00:00Z'),
              },
            },
            rounds: { create: { roundId: round.id, roundVersionId: version.id } },
          },
        });
        createdShiftIds.push(shift.id);
        const assignment = await prisma.shiftAssignment.findFirstOrThrow({
          where: { shiftId: shift.id },
        });
        await prisma.shiftEvent.create({
          data: {
            companyId: shift.companyId,
            shiftId: shift.id,
            assignmentId: assignment.id,
            type: 'start',
            occurredAt: shift.startsAt,
          },
        });
        const window = await prisma.roundWindowState.create({
          data: {
            companyId: shift.companyId,
            shiftId: shift.id,
            roundId: round.id,
            windowIndex: 0,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            graceEndsAt: new Date('2026-10-13T11:15:00Z'),
            expectedCount: 1,
          },
        });
        const windows = app.get(RoundWindowStateService);
        await windows.recalculateExpired();
        expect(
          (await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } })).status,
        ).toBe('pending_sync');
        expect(
          await prisma.notice.count({ where: { shiftId: shift.id, kind: 'round_missed' } }),
        ).toBe(0);
        expect(
          await prisma.notice.count({ where: { shiftId: shift.id, kind: 'shift_unsynced' } }),
        ).toBe(1);
        const { token } = await app.get(ShiftCredentialService).issueCredential({
          shiftId: shift.id,
          assignmentId: assignment.id,
          userId: guard.id,
          companyId: shift.companyId,
          scheduledEnd: shift.endsAt,
        });
        if (!missedBeforeBatch) {
          await request(app.getHttpServer())
            .post(`/api/v1/turnos/${shift.id}/cerrar-sin-datos`)
            .set('Authorization', 'Bearer token-supervisor')
            .send({ reason: 'Celular perdido' })
            .expect(201);
          expect(
            (await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } })).status,
          ).toBe('not_done');
        }
        if (missedBeforeBatch) {
          await request(app.getHttpServer())
            .post('/api/v1/avisos-conexion')
            .set('Authorization', `Bearer ${token}`)
            .send({
              shiftId: shift.id,
              pendingCount: 0,
              syncedUntil: window.graceEndsAt.toISOString(),
              sentAtDevice: testNow.toISOString(),
            })
            .expect(200);
          expect(
            (await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } })).status,
          ).toBe('not_done');
          expect(
            await prisma.notice.count({
              where: { shiftId: shift.id, kind: 'round_missed', status: 'open' },
            }),
          ).toBe(1);
        }
        const recordId = randomUUID();
        const batch = await request(app.getHttpServer())
          .post('/api/v1/sincronizacion/eventos')
          .set('Authorization', `Bearer ${token}`)
          .send({
            shiftId: shift.id,
            pendingCount: 0,
            syncedUntil: window.graceEndsAt.toISOString(),
            events: [
              {
                type: 'checkpoint_record',
                payload: {
                  recordId,
                  shiftId: shift.id,
                  method: 'qr',
                  scannedValue: app
                    .get(QrService)
                    .createPayload(checkpoint.id, checkpoint.qrVersion),
                  occurredAtDevice: '2026-10-13T10:30:00Z',
                  location: {
                    status: 'ok',
                    latitude: -34.6,
                    longitude: -58.4,
                    accuracyMeters: 5,
                    simulation: 'not_simulated',
                    takenAt: '2026-10-13T10:30:00Z',
                  },
                  phoneNfc: 'on',
                },
              },
            ],
          })
          .expect(200);
        expect(
          z.object({ results: z.array(z.object({ status: z.string() })) }).parse(batch.body)
            .results[0]?.status,
        ).toBe('accepted');
        expect(
          (await prisma.roundWindowState.findUniqueOrThrow({ where: { id: window.id } })).status,
        ).toBe('complete');
        expect(
          await prisma.notice.count({
            where: {
              shiftId: shift.id,
              kind: 'round_missed',
              status: 'resolved',
              resolution: 'data_arrived',
            },
          }),
        ).toBe(missedBeforeBatch ? 1 : 0);
        expect(
          await prisma.notice.count({
            where: {
              shiftId: shift.id,
              kind: 'shift_unsynced',
              status: missedBeforeBatch ? 'open' : 'resolved',
            },
          }),
        ).toBe(1);
        const response = await request(app.getHttpServer())
          .get('/api/v1/avisos?tipo=shift_unsynced')
          .set('Authorization', 'Bearer token-supervisor')
          .expect(200);
        expect(
          z.object({ items: z.array(z.object({ shiftId: z.string() })) }).parse(response.body)
            .items,
        ).toEqual(expect.arrayContaining([expect.objectContaining({ shiftId: shift.id })]));
        await prisma.shiftAssignment.update({
          where: { id: assignment.id },
          data: { active: false },
        });
      } finally {
        notify.mockRestore();
        testNow = previousNow;
      }
    },
  );
});
