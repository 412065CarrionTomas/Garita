import { ShiftSchedulesService } from './shift-schedules.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { ShiftsService } from '../shifts/shifts.service';

describe('schedule list', () => {
  const findMany = jest.fn().mockResolvedValue([
    {
      id: 'schedule',
      siteId: 'site',
      guardId: 'guard',
      weekdays: [1, 2],
      startTime: '22:00',
      endTime: '06:00',
      roundIds: ['round-1', 'round-gone'],
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-12-08T00:00:00Z'),
      status: 'active',
      site: { name: 'Ferreyra' },
      guard: { firstName: 'Lucas', lastName: 'Fernández' },
    },
  ]);
  const count = jest.fn((args: { where: { status?: string } }) =>
    Promise.resolve(args.where.status === 'active' ? 3 : 7),
  );
  const groupBy = jest
    .fn()
    .mockResolvedValueOnce([{ scheduleId: 'schedule', _count: { _all: 9 } }])
    .mockResolvedValueOnce([{ scheduleId: 'schedule', _count: { _all: 2 } }]);
  const service = new ShiftSchedulesService(
    {
      tenantPrisma: {
        company: {
          findFirstOrThrow: jest
            .fn()
            .mockResolvedValue({ timezone: 'America/Argentina/Buenos_Aires' }),
        },
        shiftSchedule: { findMany, count },
        shift: { groupBy },
        round: { findMany: jest.fn().mockResolvedValue([{ id: 'round-1', name: 'Perimetral' }]) },
      },
    } as unknown as PrismaService,
    {} as TenantResourceService,
    {} as ShiftsService,
    // 26/11 a las 02:00 en Buenos Aires.
    { now: () => new Date('2026-11-26T05:00:00Z') },
    { notifyUsers: jest.fn(), notifySiteStaff: jest.fn() },
  );

  it('skips the shift counts when nothing matches', async () => {
    findMany.mockResolvedValueOnce([]);
    groupBy.mockClear();
    await expect(service.list({ q: 'nadie', pagina: 1, porPagina: 20 })).resolves.toEqual({
      items: [],
      total: 7,
      pagina: 1,
      expiring: 3,
    });
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('filters expiring schedules and adds names, days to end and shift counts', async () => {
    const result = await service.list({ estado: 'por_vencer', pagina: 2, porPagina: 10 });
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      skip: 10,
      take: 10,
      where: {
        AND: [
          {
            status: 'active',
            endDate: { gte: new Date('2026-11-26'), lte: new Date('2026-12-10') },
          },
        ],
      },
    });
    expect(result).toEqual({
      expiring: 3,
      total: 7,
      pagina: 2,
      items: [
        expect.objectContaining({
          id: 'schedule',
          endDate: '2026-12-08',
          siteName: 'Ferreyra',
          guardName: 'Lucas Fernández',
          roundNames: ['Perimetral'],
          daysToEnd: 12,
          upcomingCount: 9,
          modifiedCount: 2,
        }),
      ],
    });
  });
});
