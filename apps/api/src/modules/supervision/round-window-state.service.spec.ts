import { RoundWindowStateService } from './round-window-state.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NoticesPort } from '../../common/ports/notices.port';

describe('RoundWindowStateService (HU-17)', () => {
  const startsAt = new Date('2026-10-22T00:00:00Z');
  const endsAt = new Date('2026-10-22T02:00:00Z');
  const graceEndsAt = new Date('2026-10-22T02:15:00Z');
  function setup() {
    const shift = {
      id: 'shift',
      companyId: 'company',
      siteId: 'site',
      site: { name: 'Predio' },
      status: 'auto_closed',
      startsAt,
      endsAt,
      closedAt: null,
      closeReason: null,
      closedWithoutDataAt: null as Date | null,
      assignments: [{ id: 'owner', guardId: 'guard', startsAt, result: null }],
      events: [{ assignmentId: 'owner', type: 'start', occurredAt: startsAt }],
      syncState: { syncedUntil: null as Date | null },
      rounds: [
        {
          roundId: 'round',
          roundVersion: {
            checkpoints: [{ checkpointId: 'point', checkpoint: { name: 'Portón' } }],
          },
        },
      ],
      roundWindowStates: [
        {
          id: 'window',
          roundId: 'round',
          windowIndex: 0,
          startsAt,
          endsAt,
          graceEndsAt,
          expectedCount: 1,
          status: 'pending_sync',
          severityLevel: null,
          inReviewSince: null,
        },
      ],
      checkpointRecords: [] as {
        assignmentId: string;
        checkpointId: string;
        countedFor: { roundId: string; windowIndex: number; late?: boolean }[];
        flags: { type: 'time_altered' }[];
        invalidatedAt: null;
      }[],
    };
    const update = jest
      .fn<Promise<unknown>, [{ data: { status: string; recordedCount: number } }]>()
      .mockResolvedValue({});
    const db = {
      shift: {
        findUnique: jest.fn().mockResolvedValue(shift),
        findMany: jest.fn().mockResolvedValue([]),
      },
      roundWindowState: { update, findMany: jest.fn().mockResolvedValue([]) },
      roundReviewDecision: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const raise = jest
      .fn<ReturnType<NoticesPort['raise']>, Parameters<NoticesPort['raise']>>()
      .mockResolvedValue(undefined);
    const resolve = jest.fn().mockResolvedValue(undefined);
    const service = new RoundWindowStateService(
      { systemPrisma: db } as unknown as PrismaService,
      { now: () => graceEndsAt },
      { notifySiteStaff: jest.fn(), notifyUsers: jest.fn() },
      { emitToSite: jest.fn() },
      { raise, resolve },
    );
    return { shift, db, update, raise, resolve, service };
  }

  it('keeps a validated late grave window complete across repeated recalculations', async () => {
    const { shift, db, service, update } = setup();
    const window = shift.roundWindowStates[0];
    if (!window) throw new Error('Missing window');
    window.status = 'complete_late';
    shift.checkpointRecords.push({
      assignmentId: 'owner',
      checkpointId: 'point',
      countedFor: [{ roundId: 'round', windowIndex: 0, late: true }],
      flags: [{ type: 'time_altered' }],
      invalidatedAt: null,
    });
    db.roundReviewDecision.findFirst.mockResolvedValue({ kind: 'validate' });
    await service.recalculate('shift');
    await service.recalculate('shift');
    expect(update.mock.calls.at(-1)?.[0].data.status).toBe('complete_late');
    expect(db.roundReviewDecision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { windowStateId: 'window' },
        orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    db.roundReviewDecision.findFirst.mockResolvedValue({ kind: 'invalidate' });
    await service.recalculate('shift');
    expect(update.mock.calls.at(-1)?.[0].data.status).toBe('in_review');
  });

  it('keeps a closed-without-data decision without fabricating synchronization or a missed notice (CA9)', async () => {
    const { shift, service, update, raise } = setup();
    shift.closedWithoutDataAt = endsAt;
    const window = shift.roundWindowStates[0];
    if (window) window.status = 'not_done';
    await service.recalculate('shift');
    expect(update.mock.calls.at(-1)?.[0].data.status).toBe('not_done');
    expect(raise).not.toHaveBeenCalled();
  });

  it('counts only the owner records and corrects closed-without-data with real late data (CA6/CA9)', async () => {
    const { shift, service, update, resolve } = setup();
    const record = {
      assignmentId: 'other',
      checkpointId: 'point',
      countedFor: [{ roundId: 'round', windowIndex: 0 }],
      flags: [] as never[],
      invalidatedAt: null,
    };
    shift.checkpointRecords.push(record);
    await service.recalculate('shift');
    expect(update.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: 'pending_sync',
      recordedCount: 0,
    });
    shift.closedWithoutDataAt = endsAt;
    record.assignmentId = 'owner';
    await service.recalculate('shift');
    expect(update.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: 'complete',
      recordedCount: 1,
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'data_arrived' }));
  });

  it('raises only once data covers grace and includes missing points (CA1/CA2/CA4)', async () => {
    const { shift, service, raise } = setup();
    await service.recalculate('shift');
    expect(raise).not.toHaveBeenCalled();
    shift.syncState.syncedUntil = graceEndsAt;
    await service.recalculate('shift');
    expect(raise.mock.calls[0]?.[0].kind).toBe('round_missed');
    expect(raise.mock.calls[0]?.[0].details).toMatchObject({ missingPoints: ['Portón'] });
  });

  it('does not raise shift_unsynced when the watermark already covers the shift (CA3)', async () => {
    const { db, service, raise } = setup();
    db.shift.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'shift',
        companyId: 'company',
        siteId: 'site',
        endsAt,
        syncState: { syncedUntil: endsAt },
        events: [],
      },
    ]);
    await service.recalculateExpired();
    expect(raise).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', false, null, 'not_done', false],
    ['guard_closed', true, 'close', 'not_done', true],
    ['admin_closed_before', true, 'admin_close', 'pending_sync', false],
  ] as const)(
    'evaluates %s from assignment events with a null result',
    async (_kind, started, close, status, notified) => {
      const { shift, service, update, raise } = setup();
      if (!started) shift.events = [];
      if (close) shift.events.push({ assignmentId: 'owner', type: close, occurredAt: graceEndsAt });
      await service.recalculate('shift');
      expect(update.mock.calls.at(-1)?.[0].data.status).toBe(status);
      expect(raise).toHaveBeenCalledTimes(notified ? 1 : 0);
    },
  );

  it('builds windows for an unstarted shift whose round version is not pinned (CA7/CA11)', async () => {
    const { db, service } = setup();
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    Object.assign(db.roundWindowState, { createMany });
    db.shift.findMany.mockResolvedValueOnce([
      {
        id: 'unstarted',
        companyId: 'company',
        startsAt,
        endsAt,
        serviceDate: startsAt,
        company: { timezone: 'UTC' },
        rounds: [
          {
            roundId: 'round',
            roundVersion: null,
            round: {
              currentVersion: {
                windowStartLocal: '00:00',
                windowEndLocal: '02:00',
                frequencyMinutes: 120,
                graceMinutes: 15,
                checkpoints: [{ checkpointId: 'point' }],
              },
            },
          },
        ],
      },
    ]);
    await service.recalculateExpired();
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          shiftId: 'unstarted',
          startsAt,
          endsAt,
          graceEndsAt,
          expectedCount: 1,
        }),
      ],
      skipDuplicates: true,
    });
  });
});
