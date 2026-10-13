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
