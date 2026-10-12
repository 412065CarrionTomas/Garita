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
import { CHECKPOINT_USAGE_PORT } from '../src/modules/checkpoints/checkpoints-usage.port';

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
  let activeRounds: { id: string; name: string }[] = [];
  const createdCheckpointIds: string[] = [];

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
      .overrideProvider(CHECKPOINT_USAGE_PORT)
      .useValue({ findActiveRoundsUsing: () => Promise.resolve(activeRounds) })
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    const prisma = app.get(PrismaService).systemPrisma;
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

    activeRounds = [{ id: 'round-1', name: 'Perimetral' }];
    await request(app.getHttpServer())
      .post(`/api/v1/puntos/${checkpoint.id}/baja`)
      .set(auth)
      .expect(409)
      .expect(({ body: result }) => {
        const parsedResult: unknown = JSON.parse(JSON.stringify(result));
        expect(
          z
            .object({ rounds: z.array(z.object({ id: z.string(), name: z.string() })) })
            .parse(parsedResult).rounds,
        ).toContainEqual({ id: 'round-1', name: 'Perimetral' });
      });
    activeRounds = [];

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
});
