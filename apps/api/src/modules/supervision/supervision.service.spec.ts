import { SupervisionService } from './supervision.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MarcasService } from '../marcas/marcas.service';

const user = {
  userId: 'admin',
  companyId: 'company',
  role: 'admin' as const,
  status: 'active' as const,
};
const now = new Date('2026-11-01T11:00:00Z');

it('loads only current assignment closures when computing synchronization', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new SupervisionService(
    {
      tenantPrisma: {
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
        shift: { findMany },
      },
    } as unknown as PrismaService,
    {} as MarcasService,
    { now: () => now },
  );
  await service.list({}, user);
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      include: expect.objectContaining({
        events: expect.objectContaining({
          where: { type: { in: ['close', 'admin_close'] }, assignment: { isCurrent: true } },
        }) as unknown,
      }) as unknown,
    }),
  );
});

it('lists current round points before start and ignores invalidated/out-of-window records', async () => {
  const checkpoints = ['valid', 'invalidated', 'outside'].map((id) => ({
    checkpoint: { id, name: id, latitude: 0, longitude: 0 },
  }));
  const shift = {
    id: 'shift',
    status: 'scheduled',
    startsAt: now,
    endsAt: now,
    assignments: [],
    rounds: [
      {
        roundId: 'round',
        roundVersion: null,
        round: { name: 'Ronda', currentVersion: { checkpoints } },
      },
    ],
    roundWindowStates: [{ roundId: 'round', windowIndex: 0 }],
    checkpointRecords: checkpoints.map(({ checkpoint }, index) => ({
      checkpointId: checkpoint.id,
      countsForCompliance: true,
      invalidatedAt: index === 1 ? now : null,
      countedFor: index === 2 ? [] : [{ roundId: 'round', windowIndex: 0 }],
    })),
    invalidScanAttempts: [],
  };
  const service = new SupervisionService(
    {
      tenantPrisma: { shift: { findFirst: jest.fn().mockResolvedValue(shift) } },
    } as unknown as PrismaService,
    { getShiftRecords: jest.fn().mockResolvedValue({ records: [] }) } as unknown as MarcasService,
    { now: () => now },
  );
  const detail = await service.detail('shift', user, {});
  expect(detail.points.map(({ id, registered }) => ({ id, registered }))).toEqual([
    { id: 'valid', registered: true },
    { id: 'invalidated', registered: false },
    { id: 'outside', registered: false },
  ]);
});
