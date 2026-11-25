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

it('devuelve el recorrido de la versión del turno, no el de la versión actual', async () => {
  const leg = (x: number) => ({
    from: [x, 0] as [number, number],
    to: [x + 1, 0] as [number, number],
    waypoints: [],
    sections: [
      {
        mode: 'streets' as const,
        via: [],
        geometry: [
          [x, 0],
          [x + 1, 0],
        ],
        fallback: false,
      },
    ],
  });
  const shiftRoute = { v: 1, closed: false, legs: [leg(0)] };
  const version = (route: unknown, ids: string[]) => ({
    route,
    checkpoints: ids.map((id) => ({ checkpoint: { id, name: id, latitude: 0, longitude: 0 } })),
  });
  const shift = {
    id: 'shift',
    status: 'scheduled',
    startsAt: now,
    endsAt: now,
    assignments: [],
    rounds: [
      {
        roundId: 'old',
        roundVersion: version(shiftRoute, ['a', 'b']),
        round: { name: 'Vieja', currentVersion: version({ v: 1, closed: true, legs: [] }, ['a']) },
      },
      { roundId: 'legacy', roundVersion: version(null, ['c']), round: { name: 'Previa' } },
      { roundId: 'broken', roundVersion: version({ v: 9 }, ['d']), round: { name: 'Rota' } },
    ],
    roundWindowStates: [],
    checkpointRecords: [],
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
  expect(detail.routes).toEqual([
    { roundId: 'old', roundName: 'Vieja', checkpointIds: ['a', 'b'], route: shiftRoute },
    { roundId: 'legacy', roundName: 'Previa', checkpointIds: ['c'], route: null },
    { roundId: 'broken', roundName: 'Rota', checkpointIds: ['d'], route: null },
  ]);
});

it('includes the synchronization status in the detail, ignoring closures of replaced assignments', async () => {
  const lastContactAt = new Date(now.getTime() - 60 * 60_000);
  const shift = {
    id: 'shift',
    status: 'in_progress',
    startsAt: now,
    endsAt: new Date(now.getTime() + 60 * 60_000),
    startedAt: now,
    connectivityType: 'with_signal',
    syncDeadlineAt: null,
    closedWithoutDataAt: null,
    syncState: { lastContactAt, lastPendingCount: 2, syncedUntil: null },
    assignments: [
      { id: 'old', isCurrent: false, guard: null },
      { id: 'current', isCurrent: true, guard: null },
    ],
    events: [{ type: 'close', assignmentId: 'old' }],
    rounds: [],
    roundWindowStates: [],
    checkpointRecords: [],
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
  expect(detail.syncStatus).toEqual({
    status: 'sin_contacto',
    since: lastContactAt,
    pendingCount: 2,
  });
});

it('keeps in-progress overnight shifts in the default today view, but not for an explicit date', async () => {
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
  const serviceDate = new Date('2026-11-01T00:00:00.000Z');
  await service.list({}, user);
  expect(findMany.mock.calls[0][0].where).toMatchObject({
    OR: [{ serviceDate }, { status: 'in_progress' }],
  });
  await service.list({ fecha: '2026-11-01' }, user);
  expect(findMany.mock.calls[1][0].where).toMatchObject({ serviceDate });
  expect(findMany.mock.calls[1][0].where).not.toHaveProperty('OR');
});
