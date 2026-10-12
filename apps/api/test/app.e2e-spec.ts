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
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
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
  ) {}

  @Get('unannotated')
  unannotated(): { ok: true } {
    return { ok: true };
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
  imports: [PrismaModule],
  controllers: [TestOnlyUserController],
  providers: [TenantResourceService],
})
class TestOnlyModule {}

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';

// Requiere PostgreSQL y Redis en ejecución (docker compose up -d).
describe('Aplicación (e2e)', () => {
  let app: INestApplication<App>;
  let northInvitationId: string;
  let southInvitationId: string;

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
          return Promise.reject(new Error('Token inválido'));
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    const prisma = app.get(PrismaService).systemPrisma;
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
    await prisma.invitation.deleteMany({
      where: { tokenHash: { in: ['e2e-north-invitation', 'e2e-south-invitation'] } },
    });
    await prisma.user.updateMany({
      where: { firebaseUid: 'seed-norte-pending' },
      data: { status: 'invitation_pending' },
    });
    await app.close();
  });

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
