import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  adminSummaryCatalog,
  favoritesResponseSchema,
  VIEW_PREFERENCE_CONFLICT_CODE,
  viewPreferenceResponseSchema,
} from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { SuspensionProcessor } from '../src/modules/subscriptions/suspension.processor';

describe('Vistas personalizables y favoritos por HTTP', () => {
  let app: INestApplication<App>;
  let db: PrismaService['systemPrisma'];
  let userIds: string[] = [];
  let northSiteIds: string[] = [];
  let southSiteId: string;
  const as = (uid: string) => ({ Authorization: `Bearer ${uid}` });
  const viewPath = '/api/v1/mis-preferencias/vistas/admin-summary';
  const sitesPath = '/api/v1/mis-favoritos/admin-summary/site';
  const layoutOf = (res: request.Response) => viewPreferenceResponseSchema.parse(res.body).layout;
  const idsOf = (res: request.Response) => favoritesResponseSchema.parse(res.body).ids;

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
    db = app.get(PrismaService).systemPrisma;
    const users = await db.user.findMany({
      where: { firebaseUid: { in: ['seed-norte-admin', 'seed-sur-admin'] } },
      select: { id: true },
    });
    userIds = users.map((user) => user.id);
    const north = await db.site.findMany({
      where: { companyId: 'norte-company', status: 'active' },
      select: { id: true },
      take: 2,
    });
    northSiteIds = north.map((site) => site.id);
    southSiteId = (
      await db.site.findFirstOrThrow({
        where: { companyId: 'sur-company' },
        select: { id: true },
      })
    ).id;
  });
  beforeEach(async () => {
    await db.userViewPreference.deleteMany({ where: { userId: { in: userIds } } });
    await db.userFavorite.deleteMany({ where: { userId: { in: userIds } } });
  });
  afterAll(async () => {
    await db.userViewPreference.deleteMany({ where: { userId: { in: userIds } } });
    await db.userFavorite.deleteMany({ where: { userId: { in: userIds } } });
    await app.close();
  });

  it('guarda, controla la concurrencia, aísla por empresa y restablece el diseño', async () => {
    const http = request(app.getHttpServer());
    const layout = adminSummaryCatalog.defaultLayout;
    expect((await http.get(viewPath).set(as('seed-norte-admin')).expect(200)).body).toEqual({
      layout: null,
      updatedAt: null,
    });

    const first = await http
      .put(viewPath)
      .set(as('seed-norte-admin'))
      .send({ layout, baseUpdatedAt: null })
      .expect(200);
    const saved = viewPreferenceResponseSchema.parse(first.body);
    expect(saved.layout).toEqual(layout);

    const duplicate = await http
      .put(viewPath)
      .set(as('seed-norte-admin'))
      .send({ layout, baseUpdatedAt: null })
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: VIEW_PREFERENCE_CONFLICT_CODE });

    const moved = structuredClone(layout);
    const attention = moved.items.find((item) => item.id === 'attention');
    if (attention) attention.presentation = 'column';
    const second = await http
      .put(viewPath)
      .set(as('seed-norte-admin'))
      .send({ layout: moved, baseUpdatedAt: saved.updatedAt })
      .expect(200);
    await http
      .put(viewPath)
      .set(as('seed-norte-admin'))
      .send({ layout: moved, baseUpdatedAt: saved.updatedAt })
      .expect(409);
    const read = viewPreferenceResponseSchema.parse(
      (await http.get(viewPath).set(as('seed-norte-admin')).expect(200)).body,
    );
    expect(read).toEqual(viewPreferenceResponseSchema.parse(second.body));

    expect(layoutOf(await http.get(viewPath).set(as('seed-sur-admin')).expect(200))).toBeNull();

    await http.delete(viewPath).set(as('seed-norte-admin')).expect(204);
    expect(layoutOf(await http.get(viewPath).set(as('seed-norte-admin')).expect(200))).toBeNull();
  });

  it('rechaza diseños inválidos, pantallas desconocidas y roles sin acceso', async () => {
    const http = request(app.getHttpServer());
    const overlapped = structuredClone(adminSummaryCatalog.defaultLayout);
    const shifts = overlapped.items.find((item) => item.id === 'shiftsToday');
    if (shifts) shifts.y = 0;
    const invalid = await http
      .put(viewPath)
      .set(as('seed-norte-admin'))
      .send({ layout: overlapped, baseUpdatedAt: null })
      .expect(400);
    expect(JSON.stringify(invalid.body)).toContain('overlap');
    await http
      .put(viewPath)
      .set(as('seed-norte-admin'))
      .send({ layout: adminSummaryCatalog.defaultLayout, baseUpdatedAt: null, extra: true })
      .expect(400);
    await http.get('/api/v1/mis-preferencias/vistas/otra').set(as('seed-norte-admin')).expect(404);
    await http.get(viewPath).expect(401);
    await http.get(viewPath).set(as('seed-norte-supervisor')).expect(403);
    await http.get(viewPath).set(as('seed-norte-guard')).expect(403);
  });

  it('fija predios visibles en orden y no deja fijar los de otra empresa', async () => {
    const http = request(app.getHttpServer());
    expect(northSiteIds.length).toBeGreaterThan(0);
    const ordered = [...northSiteIds].reverse();
    await http.put(sitesPath).set(as('seed-norte-admin')).send({ ids: ordered }).expect(200);
    expect((await http.get(sitesPath).set(as('seed-norte-admin')).expect(200)).body).toEqual({
      ids: ordered,
    });
    await http
      .put(sitesPath)
      .set(as('seed-norte-admin'))
      .send({ ids: [...ordered, southSiteId] })
      .expect(400);
    expect(idsOf(await http.get(sitesPath).set(as('seed-norte-admin')).expect(200))).toEqual(
      ordered,
    );
    expect(idsOf(await http.get(sitesPath).set(as('seed-sur-admin')).expect(200))).toEqual([]);
    await http
      .get('/api/v1/mis-favoritos/admin-summary/otro')
      .set(as('seed-norte-admin'))
      .expect(404);
    await http.put(sitesPath).set(as('seed-norte-admin')).send({ ids: [] }).expect(200);
    expect(idsOf(await http.get(sitesPath).set(as('seed-norte-admin')).expect(200))).toEqual([]);
  });
});
