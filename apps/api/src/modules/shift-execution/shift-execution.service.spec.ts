import { NoopShiftExecutionEffects } from './shift-execution-effects.port';
import { ShiftExecutionService } from './shift-execution.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Queue } from 'bullmq';
import type { SyncDeadlinePort } from './shift-execution.service';

const now = new Date('2026-10-13T08:00:00.000Z');

describe('ShiftExecutionService.autoClose', () => {
  function setup(deadline: Date | null) {
    const tx = {
      shift: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      shiftEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const systemPrisma = {
      shift: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'shift-1',
          companyId: 'company-1',
          siteId: 'site-1',
          endsAt: new Date('2026-10-13T06:00:00.000Z'),
          status: 'in_progress',
          assignments: [{ id: 'assignment-1', guardId: 'guard-1' }],
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const prisma = { systemPrisma, tenantPrisma: {} } as unknown as PrismaService;
    const queue = {} as Queue;
    const deadlineForSite = jest.fn((_siteId: string, _endsAt: Date) => Promise.resolve(deadline));
    const syncDeadline: SyncDeadlinePort = { deadlineForSite };
    const service = new ShiftExecutionService(
      prisma,
      { now: () => now },
      queue,
      syncDeadline,
      new NoopShiftExecutionEffects(),
    );
    return { service, tx, systemPrisma, syncDeadline, deadlineForSite };
  }

  it('auto closes at two hours after the scheduled end when the site has no sync extension', async () => {
    const { service, tx } = setup(null);
    await expect(service.autoClose('shift-1')).resolves.toBe(true);
    expect(tx.shift.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.shiftEvent.create).toHaveBeenCalledTimes(1);
  });

  it('waits for the site sync deadline when it is later than the two hour margin', async () => {
    const { service, tx, deadlineForSite } = setup(new Date('2026-10-13T08:20:00.000Z'));
    await expect(service.autoClose('shift-1')).resolves.toBe(false);
    expect(deadlineForSite).toHaveBeenCalledWith('site-1', new Date('2026-10-13T06:00:00.000Z'));
    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });
});

describe('ShiftExecutionService auto-close scheduling', () => {
  function build(add: jest.Mock) {
    const prisma = { systemPrisma: {}, tenantPrisma: {} } as unknown as PrismaService;
    const queue = { add } as unknown as Queue;
    const syncDeadline: SyncDeadlinePort = { deadlineForSite: () => Promise.resolve(null) };
    return new ShiftExecutionService(
      prisma,
      { now: () => now },
      queue,
      syncDeadline,
      new NoopShiftExecutionEffects(),
    );
  }
  const endsAt = new Date('2026-10-13T09:00:00.000Z');

  it('schedules the auto-close job two hours after the scheduled end', async () => {
    const add = jest.fn().mockResolvedValue({});
    const service = build(add);
    await expect(service.scheduleAutoCloseSafely('shift-1', 'site-1', endsAt)).resolves.toBe(true);
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      { shiftId: 'shift-1' },
      { jobId: 'shift-auto-close-shift-1', delay: 3 * 60 * 60_000 },
    );
  });

  it('does not fail the start when Redis is unreachable', async () => {
    const add = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    const service = build(add);
    await expect(service.scheduleAutoCloseSafely('shift-1', 'site-1', endsAt)).resolves.toBe(false);
  });
});

describe('ShiftExecutionService.state', () => {
  it('passes recorded checkpoints to currentRoundProgress', async () => {
    const shiftData = {
      shift: {
        id: 'shift-1',
        siteId: 'site-1',
        siteName: 'Predio A',
        startsAt: '2026-10-13T07:00:00.000Z',
        endsAt: '2026-10-13T09:00:00.000Z',
        timezone: 'America/Argentina/Buenos_Aires',
        assignmentId: 'assign-1',
      },
      rounds: [
        {
          roundId: 'round-1',
          name: 'Perimetral',
          checkpointIds: ['cp-1', 'cp-2'],
          roundVersionId: 'rv-1',
          frequencyMinutes: 120,
          windowStartLocal: '00:00',
          windowEndLocal: '08:00',
          graceMinutes: 15,
        },
      ],
      windows: [
        {
          roundId: 'round-1',
          index: 0,
          startUtc: '2026-10-13T07:00:00.000Z',
          endUtc: '2026-10-13T09:00:00.000Z',
          label: '04:00 - 06:00',
        },
      ],
      checkpoints: [],
      serverTime: { serverNowUtc: now.toISOString() },
    };
    const tenantPrisma = {
      shift: {
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'shift-1', status: 'in_progress' }),
      },
      checkpointRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            checkpointId: 'cp-1',
            countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
          },
        ]),
      },
    };
    const service = new ShiftExecutionService(
      { tenantPrisma, systemPrisma: {} } as unknown as PrismaService,
      { now: () => now },
      {} as Queue,
      { deadlineForSite: () => Promise.resolve(null) },
      new NoopShiftExecutionEffects(),
    );
    jest.spyOn(service, 'data').mockResolvedValue(shiftData);

    const user = {
      userId: 'guard-1',
      companyId: 'c-1',
      role: 'guard' as const,
      status: 'active' as const,
    };
    const result = await service.state('shift-1', user);

    expect(result.status).toBe('in_progress');
    expect(result.rounds[0]?.pendingCheckpointIds).toEqual(['cp-2']);
  });
});
