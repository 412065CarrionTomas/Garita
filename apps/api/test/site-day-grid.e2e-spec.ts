import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { siteDayGridResponseSchema } from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { SuspensionProcessor } from '../src/modules/subscriptions/suspension.processor';

describe('Casilleros de cumplimiento por HTTP', () => {
  let app: INestApplication<App>;
  const as = (uid: string) => ({ Authorization: `Bearer ${uid}` });
  const path = '/api/v1/reportes/rondas/casilleros';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (uid: string) => Promise.resolve({ uid }) })
      .overrideProvider(SuspensionProcessor)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('devuelve un casillero por día para cada predio con rondas', async () => {
    const response = await request(app.getHttpServer())
      .get(`${path}?desde=2026-11-10&hasta=2026-11-24`)
      .set(as('seed-norte-admin'))
      .expect(200);
    const grid = siteDayGridResponseSchema.parse(response.body);
    expect(grid.days).toHaveLength(14);
    for (const site of grid.sites) expect(site.cells.map((cell) => cell.day)).toEqual(grid.days);
  });

  it('valida el período y los roles, y limita al supervisor a sus predios', async () => {
    const http = request(app.getHttpServer());
    await http
      .get(`${path}?desde=2026-10-01&hasta=2026-11-02`)
      .set(as('seed-norte-admin'))
      .expect(400);
    await http.get(path).set(as('seed-norte-admin')).expect(400);
    await http
      .get(`${path}?desde=2026-11-10&hasta=2026-11-24`)
      .set(as('seed-norte-guard'))
      .expect(403);
    const db = app.get(PrismaService).systemPrisma;
    const supervisor = await db.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-supervisor' },
      select: { siteAssignments: { select: { siteId: true } } },
    });
    const allowed = new Set(supervisor.siteAssignments.map((assignment) => assignment.siteId));
    const response = await http
      .get(`${path}?desde=2026-11-10&hasta=2026-11-24`)
      .set(as('seed-norte-supervisor'))
      .expect(200);
    const grid = siteDayGridResponseSchema.parse(response.body);
    expect(grid.sites.every((site) => allowed.has(site.id))).toBe(true);
  });
});
