import { ReportsService } from './reports.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';

describe('ReportsService.points', () => {
  const user = { userId: 'u1', companyId: 'c1', role: 'admin' as const, status: 'active' as const };
  it.each([
    [7, 'concentrated'],
    [6, 'distributed'],
  ] as const)(
    'clasifica %i de diez registros marcados, contando una vez cada registro',
    async (sameGuard, distribution) => {
      const records = Array.from({ length: 10 }, (_, index) => ({
        checkpointId: 'p1',
        checkpoint: { name: 'Galpón 3', site: { id: 's1', name: 'Depósito' } },
        assignment: { guardId: index < sameGuard ? 'g1' : 'g2' },
        flags: [{ id: 'f1' }, { id: 'f2' }],
      }));
      const prisma = {
        tenantPrisma: {
          company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
          site: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 's1',
                name: 'Depósito',
                clientId: 'cl1',
                client: { id: 'cl1', name: 'Cliente' },
              },
            ]),
          },
          checkpointRecord: { findMany: jest.fn().mockResolvedValue(records) },
        },
      };
      const service = new ReportsService(
        prisma as unknown as PrismaService,
        { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService,
        { now: () => new Date('2026-11-01T00:00:00Z') },
      );
      expect(
        (await service.points({ desde: '2026-10-01', hasta: '2026-11-01' }, user)).items,
      ).toMatchObject([{ validRecords: 10, markedRecords: 10, guardCount: 2, distribution }]);
      expect(prisma.tenantPrisma.checkpointRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            invalidatedAt: null,
            countsForCompliance: true,
            shift: { siteId: { in: ['s1'] }, status: { not: 'cancelled' } },
            OR: [
              {
                trustedAt: {
                  gte: new Date('2026-10-01T00:00:00Z'),
                  lt: new Date('2026-11-01T00:00:00Z'),
                },
              },
              {
                trustedAt: null,
                occurredAtDevice: {
                  gte: new Date('2026-10-01T00:00:00Z'),
                  lt: new Date('2026-11-01T00:00:00Z'),
                },
              },
            ],
          },
        }),
      );
    },
  );
});

it('paginates recent not-done windows before slicing, including after the first 100', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({
    id: String(index),
    shiftId: 'shift',
    round: { name: 'Ronda' },
    status: 'not_done',
    startsAt: new Date(Date.UTC(2026, 9, 1, index)),
    endsAt: new Date(Date.UTC(2026, 9, 1, index + 1)),
    severityLevel: null,
  }));
  const db = {
    company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    site: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'site', clientId: 'client', client: { id: 'client' } }]),
    },
    roundWindowState: { findMany: jest.fn().mockResolvedValue(rows) },
    shift: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'shift', status: 'closed', site: { id: 'site', name: 'Predio' }, assignments: [] },
        ]),
    },
  };
  const service = new ReportsService(
    { tenantPrisma: db } as unknown as PrismaService,
    { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService,
    { now: () => new Date('2026-11-01T00:00:00Z') },
  );
  const { reportDetailQuerySchema } = await import('@garita/shared');
  const input = reportDetailQuerySchema.parse({
    desde: '2026-10-01',
    hasta: '2026-11-01',
    estado: 'not_done',
    pageSize: 8,
    orden: 'desc',
  });
  const result = await service.detail(input, {
    userId: 'u1',
    companyId: 'c1',
    role: 'admin',
    status: 'active',
  });
  expect(result.items.map(({ id }) => id)).toEqual([
    '104',
    '103',
    '102',
    '101',
    '100',
    '99',
    '98',
    '97',
  ]);
  expect(result.total).toBe(105);
});
