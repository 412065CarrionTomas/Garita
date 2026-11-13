import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { TenantContext } from '../src/modules/auth/tenant-context';
import { NfcTagsController } from '../src/modules/nfc-tags/nfc-tags.controller';
import { NfcTagsService } from '../src/modules/nfc-tags/nfc-tags.service';

// Isolated HTTP boundary and PostgreSQL regression, without Firebase or external jobs.
describe('WD audit integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }), PrismaModule],
      controllers: [NfcTagsController],
      providers: [{ provide: NfcTagsService, useValue: { associate: jest.fn() } }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  it.each(['invalid', '04A102', '04A1020'])('UID %s responde HTTP 400', async (uid) => {
    await request(app.getHttpServer() as unknown as Server)
      .put('/puntos/point/etiqueta-nfc')
      .send({ uid })
      .expect(400);
  });
  it('indice parcial permite reutilizar nombre retirado y rechaza duplicados activos', async () => {
    // System fixture lookup only; application operations below run in a tenant context.
    const site = await prisma.systemPrisma.site.findFirstOrThrow({
      where: { companyId: 'norte-company' },
    });
    const context = app.get(TenantContext);
    await context.run(
      {
        correlationId: 'wd-test',
        user: { userId: 'test', companyId: site.companyId, role: 'admin', status: 'active' },
      },
      async () => {
        const name = `WD-${randomUUID()}`;
        const data = {
          companyId: site.companyId,
          siteId: site.id,
          name,
          latitude: -34,
          longitude: -58,
        };
        const first = await prisma.tenantPrisma.checkpoint.create({ data });
        try {
          await expect(prisma.tenantPrisma.checkpoint.create({ data })).rejects.toMatchObject({
            code: 'P2002',
          });
          await prisma.tenantPrisma.checkpoint.update({
            where: { id: first.id },
            data: { status: 'inactive' },
          });
          const second = await prisma.tenantPrisma.checkpoint.create({ data });
          expect(second.id).not.toBe(first.id);
          expect(
            await prisma.tenantPrisma.checkpoint.count({ where: { siteId: site.id, name } }),
          ).toBe(2);
        } finally {
          await prisma.tenantPrisma.checkpoint.deleteMany({ where: { siteId: site.id, name } });
        }
      },
    );
  });
});
