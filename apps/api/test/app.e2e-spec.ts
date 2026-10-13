import { authMeResponseSchema, liveHealthResponseSchema, USER_ROLES } from '@garita/shared';
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
      })
      .overrideProvider(CLOCK)
      .useValue({ now: () => new Date('2026-10-13T12:00:00.000Z') })
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
    await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
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
      ]),
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
        .array(z.object({ id: z.string() }))
        .parse(visible.body)
        .map(({ id }) => id),
    ).toContain(northAssignedSiteId);
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
      await expect(
        prisma.shiftAssignment.create({ data: { shiftId: second.id, ...assignment } }),
      ).rejects.toThrow();
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
});
