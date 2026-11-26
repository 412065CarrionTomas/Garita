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
          { currentFor: { status: 'active', site: { shifts: { some: { assignments: own } } } } },
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
