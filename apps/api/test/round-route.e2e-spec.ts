import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { roundRouteSchema, type LngLat } from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { SuspensionProcessor } from '../src/modules/subscriptions/suspension.processor';
import { NullRouting, ROUTING_PORT } from '../src/modules/routing/routing.port';

describe('Recorrido ideal de la ronda por HTTP', () => {
  let app: INestApplication<App>;
  let siteId = '';
  let checkpointIds: string[] = [];
  let points: LngLat[] = [];
  const as = (uid: string) => ({ Authorization: `Bearer ${uid}` });
  const prefix = `Ronda recorrido e2e ${randomUUID()}`;
  const base = {
    frequencyMinutes: 60,
    windowStartLocal: '22:00',
    windowEndLocal: '06:00',
    graceMinutes: 15,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({ verifyIdToken: (uid: string) => Promise.resolve({ uid }) })
      .overrideProvider(SuspensionProcessor)
      .useValue({})
      .overrideProvider(ROUTING_PORT)
      .useValue(new NullRouting())
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    const db = app.get(PrismaService).systemPrisma;
    const admin = await db.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
      select: { companyId: true },
    });
    const site = await db.site.findFirstOrThrow({
      where: {
        companyId: admin.companyId,
        status: 'active',
        checkpoints: { some: { status: 'active' } },
      },
      select: { id: true, checkpoints: { where: { status: 'active' }, take: 3 } },
    });
    siteId = site.id;
    checkpointIds = site.checkpoints.map(({ id }) => id);
    points = site.checkpoints.map((c) => [Number(c.longitude), Number(c.latitude)]);
    expect(checkpointIds.length).toBeGreaterThanOrEqual(2);
  });

  afterAll(async () => {
    const db = app.get(PrismaService).systemPrisma;
    const rounds = await db.round.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true },
    });
    const roundIds = rounds.map(({ id }) => id);
    const versionIds = (
      await db.roundVersion.findMany({ where: { roundId: { in: roundIds } }, select: { id: true } })
    ).map(({ id }) => id);
    await db.roundVersionCheckpoint.deleteMany({ where: { roundVersionId: { in: versionIds } } });
    await db.round.updateMany({
      where: { id: { in: roundIds } },
      data: { currentVersionId: null },
    });
    await db.roundVersion.deleteMany({ where: { id: { in: versionIds } } });
    await db.round.deleteMany({ where: { id: { in: roundIds } } });
    await app.close();
  });

  it('calcula y guarda el recorrido; sin clave de ruteo los tramos quedan rectos', async () => {
    const [first, second] = points;
    if (!first || !second) throw new Error('Faltan puntos');
    const gate: LngLat = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
    const ids = checkpointIds.slice(0, 2);
    const created = await request(app.getHttpServer())
      .post(`/api/v1/predios/${siteId}/rondas`)
      .set(as('seed-norte-admin'))
      .send({
        ...base,
        name: `${prefix} mixta`,
        checkpointIds: ids,
        route: {
          closed: false,
          legs: [
            {
              waypoints: [gate],
              sections: [
                { mode: 'streets', via: [] },
                { mode: 'manual', via: [] },
              ],
            },
          ],
        },
      })
      .expect(201);
    const version = await app.get(PrismaService).systemPrisma.roundVersion.findFirstOrThrow({
      where: { roundId: (created.body as { id: string }).id },
    });
    const route = roundRouteSchema.parse(version.route);
    expect(route.closed).toBe(false);
    expect(route.legs[0]?.sections).toEqual([
      { mode: 'streets', via: [], geometry: [first, gate], fallback: true },
      { mode: 'manual', via: [], geometry: [gate, second], fallback: false },
    ]);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/predios/${siteId}/rondas`)
      .set(as('seed-norte-admin'))
      .expect(200);
    const round = (listed.body as { name: string; currentVersion: { route: unknown } }[]).find(
      (item) => item.name === `${prefix} mixta`,
    );
    expect(roundRouteSchema.parse(round?.currentVersion.route).legs).toHaveLength(1);
  });

  it('sin recorrido usa un circuito por calles que vuelve al inicio', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/predios/${siteId}/rondas`)
      .set(as('seed-norte-admin'))
      .send({ ...base, name: `${prefix} por defecto`, checkpointIds })
      .expect(201);
    const version = await app.get(PrismaService).systemPrisma.roundVersion.findFirstOrThrow({
      where: { roundId: (created.body as { id: string }).id },
    });
    const route = roundRouteSchema.parse(version.route);
    expect(route.closed).toBe(true);
    expect(route.legs).toHaveLength(checkpointIds.length);
    expect(route.legs.at(-1)?.to).toEqual(points[0]);
  });

  it('rechaza un recorrido a más de 25 km del predio o con tramos de más', async () => {
    const leg = (via: LngLat[] = []) => ({ waypoints: [], sections: [{ mode: 'streets', via }] });
    const ids = checkpointIds.slice(0, 2);
    const http = request(app.getHttpServer());
    const far = await http
      .post(`/api/v1/predios/${siteId}/rondas`)
      .set(as('seed-norte-admin'))
      .send({
        ...base,
        name: `${prefix} lejos`,
        checkpointIds: ids,
        route: { closed: false, legs: [leg([[0, 0]])] },
      })
      .expect(400);
    expect(JSON.stringify(far.body)).toContain('25 km');
    await http
      .post(`/api/v1/predios/${siteId}/rondas`)
      .set(as('seed-norte-admin'))
      .send({
        ...base,
        name: `${prefix} tramos`,
        checkpointIds: ids,
        route: { closed: false, legs: [leg(), leg()] },
      })
      .expect(400);
  });
});
