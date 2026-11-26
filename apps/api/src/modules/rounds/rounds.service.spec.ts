import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { RouteBuilder } from '../routing/route-builder';
import { RoundsService } from './rounds.service';

describe('round versions for the guard', () => {
  const findMany = jest.fn();
  const service = new RoundsService(
    { tenantPrisma: { roundVersion: { findMany } } } as unknown as PrismaService,
    {} as TenantResourceService,
    {} as RouteBuilder,
    { now: () => new Date() },
  );
  const guard = { userId: 'guard', companyId: 'company', role: 'guard', status: 'active' } as const;
  const checkpoint = (id: string, lat: string) => ({
    checkpoint: {
      id,
      name: `Punto ${id}`,
      latitude: new Prisma.Decimal(lat),
      longitude: new Prisma.Decimal('-64.1'),
      isIndoor: false,
    },
  });

  it('only reads versions of the guard shifts and maps points in route order', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'v3',
        frequencyMinutes: 60,
        windowStartLocal: '22:00',
        windowEndLocal: '06:00',
        route: { invalid: true },
        round: { id: 'r1', name: 'Perimetral' },
        checkpoints: [checkpoint('a', '-31.4'), checkpoint('b', '-31.5')],
      },
    ]);
    const versions = await service.versionsForGuard(['v3', 'other'], guard);
    const own = { some: { guardId: 'guard', isCurrent: true } };
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      where: {
        id: { in: ['v3', 'other'] },
        OR: [
          { shifts: { some: { shift: { assignments: own } } } },
          { currentFor: { shifts: { some: { shift: { assignments: own } } } } },
          {
            currentFor: {
              status: 'active',
              site: { status: 'active', shifts: { some: { assignments: own } } },
            },
          },
        ],
      },
    });
    expect(versions).toEqual([
      {
        id: 'v3',
        roundId: 'r1',
        name: 'Perimetral',
        frequencyMinutes: 60,
        windowStartLocal: '22:00',
        windowEndLocal: '06:00',
        checkpoints: [
          { id: 'a', name: 'Punto a', latitude: -31.4, longitude: -64.1, isIndoor: false },
          { id: 'b', name: 'Punto b', latitude: -31.5, longitude: -64.1, isIndoor: false },
        ],
        route: null,
      },
    ]);
  });

  it('with a suspended account only reads versions pinned to the still visible shifts', async () => {
    findMany.mockResolvedValueOnce([]);
    await service.versionsForGuard(['v3'], {
      ...guard,
      suspension: { shiftIds: ['running'], panicIds: [] },
    });
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      where: { id: { in: ['v3'] }, shifts: { some: { shiftId: { in: ['running'] } } } },
    });
  });
});

describe('round speed', () => {
  it('saves the round speed in the new version and routes with its profile', async () => {
    const versionCreate = jest.fn().mockResolvedValue({ id: 'v2' });
    const tx = {
      roundVersion: {
        findFirstOrThrow: jest.fn().mockResolvedValue({ versionNumber: 1 }),
        create: versionCreate,
      },
      round: { update: jest.fn().mockResolvedValue({ id: 'r1' }) },
    };
    const tenantPrisma = {
      checkpoint: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            latitude: new Prisma.Decimal('-31.4'),
            longitude: new Prisma.Decimal('-64.1'),
          },
        ]),
      },
      site: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          latitude: new Prisma.Decimal('-31.4'),
          longitude: new Prisma.Decimal('-64.1'),
          maxSpeedProfile: 'walking',
        }),
      },
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    };
    const build = jest.fn().mockResolvedValue({ route: { closed: true, legs: [] }, failures: [] });
    const service = new RoundsService(
      { tenantPrisma } as unknown as PrismaService,
      {
        findOwnedOrThrow: jest.fn().mockResolvedValue({ siteId: 's1' }),
      } as unknown as TenantResourceService,
      { build } as unknown as RouteBuilder,
      { now: () => new Date() },
    );
    const user = { userId: 'u', companyId: 'c', role: 'admin', status: 'active' } as const;
    const input = {
      name: 'Perímetro',
      checkpointIds: ['p1'],
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
    };

    await service.update('r1', { ...input, speedProfile: 'vehicle' }, user);
    expect(build).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'vehicle');
    expect(versionCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ speedProfile: 'vehicle', maxSpeedKmh: 60 }) as unknown,
    });

    // Sin velocidad propia: nada en la versión y el recorrido con el perfil del predio.
    await service.update('r1', input, user);
    expect(build).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'walking');
    expect(versionCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ speedProfile: null, maxSpeedKmh: null }) as unknown,
    });
  });
});

describe('round list', () => {
  it('only counts scheduled shifts that have not ended yet', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'r1', _count: { shifts: 2 } }]);
    const now = new Date('2026-11-26T12:00:00.000Z');
    const service = new RoundsService(
      { tenantPrisma: { round: { findMany } } } as unknown as PrismaService,
      { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService,
      {} as RouteBuilder,
      { now: () => now },
    );
    await expect(service.list('s1')).resolves.toEqual([{ id: 'r1', scheduledShifts: 2 }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: {
              shifts: {
                where: {
                  roundVersionId: null,
                  shift: { status: { in: ['scheduled', 'unassigned'] }, endsAt: { gte: now } },
                },
              },
            },
          },
        }) as unknown,
      }),
    );
  });
});
