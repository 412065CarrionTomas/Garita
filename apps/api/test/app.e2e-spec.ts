import {
  authMeResponseSchema,
  liveHealthResponseSchema,
  startShiftResponseSchema,
  checkpointRecordResponseSchema,
  shiftRecordsResponseSchema,
  siteResponseSchema,
  USER_ROLES,
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
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { QrService } from '../src/modules/checkpoints/qr.service';
import { CheckpointsModule } from '../src/modules/checkpoints/checkpoints.module';
import { Roles } from '../src/modules/auth/auth.decorators';
import { TenantResourceService } from '../src/modules/auth/tenant-resource.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ShiftExecutionService } from '../src/modules/shift-execution/shift-execution.service';
import { MarcasService } from '../src/modules/marcas/marcas.service';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';

function isLogEntry(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
  let northSupervisorId: string;
  let northGuardId: string;
  const createdRoundNames: string[] = [];
  const createdCheckpointIds: string[] = [];
  const createdShiftIds: string[] = [];
  const createdSiteIds: string[] = [];
  let testNow = new Date('2026-10-13T12:00:00.000Z');
  const createdNfcCheckpointIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TestOnlyModule],
    })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (token: string) => {
          if (token === 'token-admin') return Promise.resolve({ uid: 'seed-norte-admin' });
          if (token === 'token-deactivated')
            return Promise.resolve({ uid: 'seed-norte-deactivated' });
          if (token === 'token-pending') return Promise.resolve({ uid: 'seed-norte-pending' });
          if (token === 'token-guard') return Promise.resolve({ uid: 'seed-norte-guard' });
          if (token === 'token-supervisor')
            return Promise.resolve({ uid: 'seed-norte-supervisor' });
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
    await prisma.nfcTag.deleteMany({ where: { checkpointId: { in: createdNfcCheckpointIds } } });
    await prisma.checkpoint.deleteMany({ where: { id: { in: createdNfcCheckpointIds } } });
    const northClient = await prisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
    });
    const southClient = await prisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'sur-company', name: 'Cliente sur' } },
    });
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
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService).systemPrisma;
    await prisma.recordFlag.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.checkpointRecord.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
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
    await app.close();
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

  it.each(['seed-norte-admin', 'seed-norte-client'])(
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
    await request(app.getHttpServer())
      .patch(`/api/v1/turnos/${createdBody.id}`)
      .set(auth)
      .send(requestShift)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/turnos/${createdBody.id}/cancelar`)
      .set(auth)
      .expect(409);
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
      await request(app.getHttpServer()).get('/api/v1/predios').set(auth).expect(403);
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
    const actor = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    const pendingGuard = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-pending' },
    });
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
    const qrSignatureStart = qrGalpon.lastIndexOf('.') + 1;
    const qrSignatureFirstCharacter = qrGalpon[qrSignatureStart];
    const qrAlterado = `${qrGalpon.slice(0, qrSignatureStart)}${
      qrSignatureFirstCharacter === 'A' ? 'B' : 'A'
    }${qrGalpon.slice(qrSignatureStart + 1)}`;
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

    // Registro 4: Tiempo imposible (punto lejano a 500m, 30s de diferencia respecto a rec3 -> 60 km/h > 10 km/h a pie)
    const rec4Id = randomUUID();
    await client
      .post('/api/v1/registros-puntos')
      .set(guardAuth)
      .send({
        recordId: rec4Id,
        shiftId: shift.id,
        method: 'qr',
        scannedValue: qrFar,
        occurredAtDevice: '2026-11-25T02:10:30.000Z',
        location: {
          status: 'ok',
          latitude: -34.6037 + 500 / 111195,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          takenAt: '2026-11-25T02:10:30.000Z',
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
});
