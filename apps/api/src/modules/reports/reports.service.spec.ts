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
    },
  );
});
