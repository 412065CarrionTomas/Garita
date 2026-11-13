import { ConflictException } from '@nestjs/common';
import { NoopShiftExecutionEffects } from './shift-execution-effects.port';
import { ShiftExecutionService } from './shift-execution.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Queue } from 'bullmq';
import type { SyncDeadlinePort } from './shift-execution.service';

const now = new Date('2026-10-13T08:00:00.000Z');

describe('ShiftExecutionService audit restrictions', () => {
  const user = {
    userId: 'guard',
    companyId: 'company',
    role: 'admin' as const,
    status: 'active' as const,
  };
  function setup() {
    const shift = {
      id: 'shift',
      companyId: 'company',
      siteId: 'site',
      status: 'scheduled',
      endsAt: now,
      closedWithoutDataAt: null,
      site: { status: 'active', client: { status: 'active' } },
    };
    const db = {
      shift: {
        findFirst: jest.fn().mockResolvedValue(shift),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shiftEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      shiftSyncState: { findUnique: jest.fn().mockResolvedValue({ syncedUntil: null }) },
      notice: {
        findFirst: jest.fn().mockResolvedValue({ id: 'notice' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      roundWindowState: { updateMany: jest.fn() },
    };
    const service = new ShiftExecutionService(
      {
        tenantPrisma: { ...db, $transaction: (fn: (tx: typeof db) => Promise<unknown>) => fn(db) },
      } as unknown as PrismaService,
      { now: () => now },
      {} as Queue,
      {} as SyncDeadlinePort,
      new NoopShiftExecutionEffects(),
    );
    return { service, db, shift };
  }
  it.each(['site', 'client'] as const)(
    'rejects starting a shift with inactive %s',
    async (resource) => {
      const { service, shift } = setup();
      if (resource === 'site') shift.site.status = 'inactive';
      else shift.site.client.status = 'inactive';
      await expect(
        service.start('shift', { eventId: 'event' } as Parameters<typeof service.start>[1], user),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it.each(['synced', 'closed'] as const)(
    'rejects close-without-data if already %s',
    async (state) => {
      const { service, db } = setup();
      if (state === 'synced') db.shiftSyncState.findUnique.mockResolvedValue({ syncedUntil: now });
      else db.shiftEvent.findFirst.mockResolvedValue({ id: 'close' });
      await expect(service.closeWithoutData('shift', 'Motivo válido', user)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.shift.update).not.toHaveBeenCalled();
      expect(db.notice.updateMany).not.toHaveBeenCalled();
    },
  );
  it('resolves the notice explicitly when closing without data', async () => {
    const { service, db } = setup();
    await service.closeWithoutData('shift', 'Motivo válido', user);
    expect(db.notice.updateMany).toHaveBeenCalledWith({
      where: { id: 'notice', status: 'open' },
      data: { status: 'resolved', resolution: 'closed_without_data', resolvedAt: now },
    });
    expect(db.roundWindowState.updateMany).toHaveBeenCalled();
  });
});

describe('ShiftExecutionService assignment closure result', () => {
  it.each(['close', 'closeForSites', 'closeForGuard', 'realCloseAfterAuto'] as const)(
    '%s preserves the assignment result for window ownership',
    async (operation) => {
      for (const early of [true, false]) {
        const assignment = {
          id: 'assignment-1',
          guardId: 'guard-1',
          startsAt: new Date('2026-10-13T07:00:00Z'),
        };
        const shift = {
          id: 'shift-1',
          companyId: 'company-1',
          siteId: 'site-1',
          status: operation === 'realCloseAfterAuto' ? 'auto_closed' : 'in_progress',
          startedAt: assignment.startsAt,
          endsAt: early ? new Date('2026-10-13T09:00:00Z') : now,
          assignments: [assignment],
        };
        const tx = {
          shift: {
            findFirst: jest.fn().mockResolvedValue(shift),
            findMany: jest.fn().mockResolvedValue([shift]),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          shiftAssignment: {
            findFirst: jest.fn().mockResolvedValue(assignment),
            update: jest.fn(),
          },
          shiftEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        };
        const service = new ShiftExecutionService(
          {
            tenantPrisma: {
              ...tx,
              $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
            },
          } as unknown as PrismaService,
          { now: () => now },
          {} as Queue,
          {
            deadlineForSite: () => Promise.resolve(null),
            deadlineForShift: () => Promise.resolve(null),
          },
          new NoopShiftExecutionEffects(),
        );
        if (operation === 'closeForSites') await service.closeForSites(tx, ['site-1'], 'admin-1');
        else if (operation === 'closeForGuard')
          await service.closeForGuard('guard-1', 'admin-1', 'Me descompuse');
        else
          await service.close(
            'shift-1',
            {
              eventId: '00000000-0000-4000-8000-000000000001',
              occurredAtDevice: now.toISOString(),
              reason: 'Me descompuse',
              location: {
                status: 'disabled',
                latitude: null,
                longitude: null,
                accuracyMeters: null,
                simulation: 'unavailable',
                takenAt: null,
              },
            },
            { userId: 'guard-1', companyId: 'company-1', role: 'guard', status: 'active' },
          );
        expect(tx.shiftAssignment.update).toHaveBeenCalledWith({
          where: { id: 'assignment-1' },
          data: { result: early ? 'closed_early' : 'started' },
        });
      }
    },
  );
});

describe('ShiftExecutionService close race', () => {
  it('does not overwrite an admin or automatic close that won the race', async () => {
    const assignment = { id: 'assignment-1', guardId: 'guard-1', startsAt: now };
    const shift = {
      id: 'shift-1',
      companyId: 'company-1',
      siteId: 'site-1',
      status: 'in_progress',
      startedAt: now,
      endsAt: now,
    };
    const tx = {
      shift: {
        findFirst: jest.fn().mockResolvedValue(shift),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      shiftAssignment: {
        findFirst: jest.fn().mockResolvedValue(assignment),
        update: jest.fn(),
      },
      shiftEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    const service = new ShiftExecutionService(
      {
        tenantPrisma: {
          ...tx,
          $transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        },
      } as unknown as PrismaService,
      { now: () => now },
      {} as Queue,
      {
        deadlineForSite: () => Promise.resolve(null),
        deadlineForShift: () => Promise.resolve(null),
      },
      new NoopShiftExecutionEffects(),
    );
    await expect(
      service.close(
        'shift-1',
        {
          eventId: '00000000-0000-4000-8000-000000000002',
          occurredAtDevice: now.toISOString(),
          location: {
            status: 'disabled',
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            simulation: 'unavailable',
            takenAt: null,
          },
        },
        { userId: 'guard-1', companyId: 'company-1', role: 'guard', status: 'active' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.shift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shift-1', status: 'in_progress' } }),
    );
    expect(tx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(tx.shiftEvent.create).not.toHaveBeenCalled();
  });
});

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
          syncDeadlineAt: deadline,
          assignments: [{ id: 'assignment-1', guardId: 'guard-1' }],
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const prisma = { systemPrisma, tenantPrisma: {} } as unknown as PrismaService;
    const queue = {} as Queue;
    const deadlineForSite = jest.fn((_siteId: string, _endsAt: Date) => Promise.resolve(deadline));
    const syncDeadline: SyncDeadlinePort = {
      deadlineForSite,
      deadlineForShift: () => Promise.resolve(deadline),
    };
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
    const { service, tx } = setup(new Date('2026-10-13T08:20:00.000Z'));
    await expect(service.autoClose('shift-1')).resolves.toBe(false);

    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });
});

describe('ShiftExecutionService auto-close scheduling', () => {
  function build(add: jest.Mock) {
    const prisma = { systemPrisma: {}, tenantPrisma: {} } as unknown as PrismaService;
    const queue = { add } as unknown as Queue;
    const syncDeadline: SyncDeadlinePort = {
      deadlineForShift: () => Promise.resolve(null),
      deadlineForSite: () => Promise.resolve(null),
    };
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
      {
        deadlineForShift: () => Promise.resolve(null),
        deadlineForSite: () => Promise.resolve(null),
      },
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
