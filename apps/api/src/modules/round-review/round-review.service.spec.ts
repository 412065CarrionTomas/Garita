import { RoundReviewService } from './round-review.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { RoundWindowStateService } from '../supervision/round-window-state.service';

const user = {
  userId: 'admin',
  companyId: 'company',
  role: 'admin' as const,
  status: 'active' as const,
};
const startsAt = new Date('2026-11-01T10:00:00Z');
const endsAt = new Date('2026-11-01T11:00:00Z');
const graceEndsAt = new Date('2026-11-01T11:15:00Z');
function setup(now = graceEndsAt, shiftOverrides: Record<string, unknown> = {}) {
  const assignments = [{ id: 'owner', startsAt, result: 'started', guardId: 'guard' }];
  const window = {
    id: 'window',
    shiftId: 'shift',
    roundId: 'round',
    windowIndex: 0,
    startsAt,
    endsAt,
    graceEndsAt,
    expectedCount: 1,
    status: 'in_review',
    inReviewSince: endsAt,
    shift: {
      siteId: 'site',
      status: 'in_progress',
      closeReason: null,
      closedAt: null,
      closedWithoutDataAt: null,
      assignments,
      events: [{ assignmentId: 'owner', type: 'start', occurredAt: startsAt }],
      syncState: { syncedUntil: graceEndsAt },
      ...shiftOverrides,
    },
  };
  const record = {
    id: 'record',
    shiftId: 'shift',
    assignmentId: 'owner',
    checkpointId: 'point',
    countedFor: [{ roundId: 'round', windowIndex: 0, late: true }],
    invalidatedAt: null as Date | null,
    flags: [] as { type: 'time_altered' }[],
    shift: window.shift,
  };
  const db = {
    roundWindowState: {
      findFirst: jest.fn().mockResolvedValue(window),
      findMany: jest.fn().mockResolvedValue([window]),
      findUnique: jest.fn().mockResolvedValue({ status: 'complete_late' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    checkpointRecord: {
      findFirst: jest.fn().mockResolvedValue(record),
      findMany: jest.fn().mockImplementation(() => Promise.resolve([record])),
      updateMany: jest.fn().mockImplementation(() => {
        record.invalidatedAt = now;
        return Promise.resolve({ count: 1 });
      }),
    },
    roundReviewDecision: { create: jest.fn() },
  };
  const transaction = (fn: (tx: typeof db) => Promise<unknown>) => fn(db);
  const notifications = { notifySiteStaff: jest.fn(), notifyUsers: jest.fn() };
  const service = new RoundReviewService(
    {
      tenantPrisma: { ...db, $transaction: transaction },
      systemPrisma: { ...db, $transaction: transaction },
    } as unknown as PrismaService,
    { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService,
    {} as RoundWindowStateService,
    { now: () => now },
    { emitToSite: jest.fn() },
    notifications,
    { recalculate: jest.fn() },
  );
  jest.spyOn(service, 'detail').mockResolvedValue({} as never);
  return { service, db, record, window, notifications };
}

it('validates a late window without losing its lateness', async () => {
  const { service, db } = setup();
  await service.validate('window', user, 'Validación justificada');
  expect(db.roundWindowState.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: 'complete_late', inReviewSince: null } }),
  );
});

it('ignores records belonging to another assignment when reviewing a window', async () => {
  const { service, db, record, notifications } = setup();
  db.checkpointRecord.findMany.mockImplementation(() =>
    Promise.resolve([record, { ...record, assignmentId: 'other', invalidatedAt: null }]),
  );
  await service.recordDecision('record', 'invalidate', user, 'Registro inválido');
  expect(db.roundWindowState.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'not_done', recordedCount: 0 }) as unknown,
    }),
  );
  expect(notifications.notifySiteStaff).not.toHaveBeenCalled();
});

it.each([
  ['2026-11-01T10:30:00Z', 'in_progress'],
  ['2026-11-01T11:05:00Z', 'late'],
] as const)('does not finalize a window before grace at %s', async (instant, status) => {
  const { service, db } = setup(new Date(instant));
  await service.recordDecision('record', 'invalidate', user, 'Registro inválido');
  expect(db.roundWindowState.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status }) as unknown }),
  );
});

it('preserves complete_late when restoring a late valid record', async () => {
  const { service, db, record } = setup();
  record.invalidatedAt = endsAt;
  db.checkpointRecord.updateMany.mockImplementation(() => {
    record.invalidatedAt = null;
    return Promise.resolve({ count: 1 });
  });
  await service.recordDecision('record', 'restore', user, 'Registro válido');
  expect(db.roundWindowState.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'complete_late' }) as unknown,
    }),
  );
});

it.each([
  ['sin sincronizar la gracia', { syncState: { syncedUntil: endsAt } }, 'pending_sync'],
  ['turno cancelado', { status: 'cancelled' }, 'pending'],
] as const)('evaluates the window like the recalculation (%s)', async (_case, shift, status) => {
  const { service, db } = setup(graceEndsAt, shift);
  await service.recordDecision('record', 'invalidate', user, 'Registro inválido');
  expect(db.roundWindowState.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status }) as unknown }),
  );
});

it('lists the queue with guard, live flags and counters', async () => {
  const { service, db, window } = setup();
  const owner = {
    id: 'owner',
    startsAt,
    result: 'started',
    guard: { firstName: 'Ana', lastName: 'Paz' },
  };
  const item = {
    ...window,
    shift: { id: 'shift', site: { id: 'site', name: 'Norte' }, assignments: [owner] },
    round: { name: 'Perimetral' },
    decisions: [],
  };
  db.roundWindowState.findMany.mockResolvedValue([item]);
  db.checkpointRecord.findMany.mockResolvedValue([
    {
      shiftId: 'shift',
      countedFor: [{ roundId: 'round', windowIndex: 0 }],
      flags: [
        { type: 'simulated_location', severity: 'grave' },
        { type: 'out_of_range', severity: 'media' },
      ],
    },
    // Otra ventana del mismo turno: no suma.
    {
      shiftId: 'shift',
      countedFor: [{ roundId: 'round', windowIndex: 1 }],
      flags: [{ type: 'time_altered', severity: 'grave' }],
    },
  ]);
  const queue = await service.queue(user, { estado: 'pendientes' });
  expect(queue).toMatchObject({ timezone: 'UTC', count: 1, overdue: 1 });
  expect(queue.items[0]).toMatchObject({
    guardName: 'Ana Paz',
    flags: { grave: 1, media: 1, leve: 0, types: ['simulated_location', 'out_of_range'] },
    resolution: null,
  });
});

it('filters the queue by the round dates in the company timezone, end day included', async () => {
  const { service, db } = setup();
  db.roundWindowState.findMany.mockResolvedValue([]);
  await service.queue(user, { estado: 'resueltas', desde: '2026-11-20', hasta: '2026-11-22' });
  expect(db.roundWindowState.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: { not: 'in_review' },
        startsAt: { gte: new Date('2026-11-20T00:00:00Z'), lt: new Date('2026-11-23T00:00:00Z') },
      }) as unknown,
    }),
  );
});
