import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeRoundWindowStatus, windowCompletion, type ShiftOfflineData } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';

@Injectable()
export class RoundWindowStateService {
  private readonly logger = new Logger(RoundWindowStateService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createForShift(data: ShiftOfflineData): Promise<void> {
    const shift = await this.prisma.tenantPrisma.shift.findUniqueOrThrow({
      where: { id: data.shift.id },
      select: { companyId: true },
    });
    const rounds = new Map(data.rounds.map((round) => [round.roundId, round]));
    await this.prisma.tenantPrisma.roundWindowState.createMany({
      data: data.windows.flatMap((window) => {
        const round = rounds.get(window.roundId);
        if (!round) return [];
        const endsAt = new Date(window.endUtc);
        return [
          {
            companyId: shift.companyId,
            shiftId: data.shift.id,
            roundId: window.roundId,
            windowIndex: window.index,
            startsAt: new Date(window.startUtc),
            endsAt,
            graceEndsAt: new Date(endsAt.getTime() + round.graceMinutes * 60_000),
            expectedCount: round.checkpointIds.length,
          },
        ];
      }),
      skipDuplicates: true,
    });
    await this.recalculate(data.shift.id);
  }

  async recalculate(
    shiftId: string,
    affectedWindows?: readonly { roundId: string; windowIndex: number }[],
  ): Promise<void> {
    const [shift, windows, records, syncState, shiftRounds] = await Promise.all([
      this.prisma.tenantPrisma.shift.findFirst({
        where: { id: shiftId },
        select: {
          status: true,
          endsAt: true,
          closedEarly: true,
          connectivityType: true,
          syncDeadlineAt: true,
        },
      }),
      this.prisma.tenantPrisma.roundWindowState.findMany({
        where: {
          shiftId,
          ...(affectedWindows
            ? { OR: affectedWindows.map(({ roundId, windowIndex }) => ({ roundId, windowIndex })) }
            : {}),
        },
      }),
      this.prisma.tenantPrisma.checkpointRecord.findMany({
        where: { shiftId, countsForCompliance: true },
        select: { checkpointId: true, countedFor: true },
      }),
      this.prisma.tenantPrisma.shiftSyncState.findUnique({ where: { shiftId } }),
      this.prisma.tenantPrisma.shiftRound.findMany({
        where: { shiftId },
        select: { roundId: true, roundVersionId: true },
      }),
    ]);
    if (!shift) return;
    const checkpoints = await this.prisma.tenantPrisma.roundVersionCheckpoint.findMany({
      where: { roundVersionId: { in: shiftRounds.flatMap((round) => round.roundVersionId ?? []) } },
      select: { roundVersionId: true, checkpointId: true },
    });
    const checkpointsByRound = new Map(
      shiftRounds.map((round) => [
        round.roundId,
        checkpoints
          .filter((checkpoint) => checkpoint.roundVersionId === round.roundVersionId)
          .map((checkpoint) => checkpoint.checkpointId),
      ]),
    );

    for (const window of windows) {
      const matching = records.filter(
        (record) =>
          Array.isArray(record.countedFor) &&
          record.countedFor.some(
            (entry) =>
              typeof entry === 'object' &&
              entry !== null &&
              'roundId' in entry &&
              'windowIndex' in entry &&
              entry.roundId === window.roundId &&
              entry.windowIndex === window.windowIndex,
          ),
      );
      const recordedCount = new Set(matching.map((record) => record.checkpointId)).size;
      const now = this.clock.now();
      const finished = now >= window.endsAt;
      const status = computeRoundWindowStatus({
        now,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        graceEndsAt: window.graceEndsAt,
        recordedCount,
        expectedCount: window.expectedCount,
        pendingSync:
          finished &&
          shift.status === 'in_progress' &&
          (!syncState ||
            now.getTime() - syncState.lastContactAt.getTime() >= 5 * 60_000 ||
            shift.connectivityType === 'without_signal'),
        shiftEndedWithoutCoverage:
          shift.status === 'uncovered' ||
          shift.status === 'no_show' ||
          shift.status === 'unassigned' ||
          (shift.status === 'closed' && shift.closedEarly),
      });
      const completion = windowCompletion(
        {
          roundId: window.roundId,
          checkpointIds: checkpointsByRound.get(window.roundId) ?? [],
        },
        { roundId: window.roundId, index: window.windowIndex },
        matching.map((record) => ({
          checkpointId: record.checkpointId,
          countedFor: Array.isArray(record.countedFor)
            ? (record.countedFor as { roundId: string; windowIndex: number; late?: boolean }[])
            : [],
        })),
      );
      await this.prisma.tenantPrisma.roundWindowState.update({
        where: { id: window.id },
        data: {
          status:
            completion === 'complete_late' && status === 'complete' ? 'complete_late' : status,
          recordedCount,
        },
      });
    }
  }

  async recalculateExpired(): Promise<void> {
    const now = this.clock.now();
    // systemPrisma is required because the BullMQ sweep has no authenticated tenant context.
    this.logger.debug({ event: 'round_window.expiry_sweep' });
    const windows = await this.prisma.systemPrisma.roundWindowState.findMany({
      where: { endsAt: { lte: now }, status: { in: ['pending', 'in_progress', 'late'] } },
    });
    for (const window of windows) {
      const [records, shift, syncState, shiftRounds] = await Promise.all([
        this.prisma.systemPrisma.checkpointRecord.findMany({
          where: { shiftId: window.shiftId, countsForCompliance: true },
          select: { checkpointId: true, countedFor: true },
        }),
        this.prisma.systemPrisma.shift.findUnique({
          where: { id: window.shiftId },
          select: { status: true, closedEarly: true, connectivityType: true, syncDeadlineAt: true },
        }),
        this.prisma.systemPrisma.shiftSyncState.findUnique({ where: { shiftId: window.shiftId } }),
        this.prisma.systemPrisma.shiftRound.findMany({
          where: { shiftId: window.shiftId },
          select: { roundId: true, roundVersionId: true },
        }),
      ]);
      if (!shift) continue;
      const round = shiftRounds.find((item) => item.roundId === window.roundId);
      const checkpoints = round?.roundVersionId
        ? await this.prisma.systemPrisma.roundVersionCheckpoint.findMany({
            where: { roundVersionId: round.roundVersionId },
            orderBy: { position: 'asc' },
            select: { checkpointId: true },
          })
        : [];
      const matching = records.filter(
        (record) =>
          Array.isArray(record.countedFor) &&
          record.countedFor.some(
            (item) =>
              typeof item === 'object' &&
              item !== null &&
              'roundId' in item &&
              'windowIndex' in item &&
              item.roundId === window.roundId &&
              item.windowIndex === window.windowIndex,
          ),
      );
      const recordedCount = new Set(matching.map((record) => record.checkpointId)).size;
      const pendingSync =
        shift.status === 'in_progress' &&
        (!syncState ||
          now.getTime() - syncState.lastContactAt.getTime() >= 5 * 60_000 ||
          (shift.connectivityType === 'without_signal' &&
            shift.syncDeadlineAt !== null &&
            shift.syncDeadlineAt > now));
      const status = computeRoundWindowStatus({
        now,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        graceEndsAt: window.graceEndsAt,
        recordedCount,
        expectedCount: window.expectedCount,
        pendingSync,
        shiftEndedWithoutCoverage:
          shift.status === 'uncovered' ||
          shift.status === 'no_show' ||
          shift.status === 'unassigned' ||
          (shift.status === 'closed' && shift.closedEarly),
      });
      const completion = windowCompletion(
        {
          roundId: window.roundId,
          checkpointIds: checkpoints.map(({ checkpointId }) => checkpointId),
        },
        { roundId: window.roundId, index: window.windowIndex },
        matching.map((record) => ({
          checkpointId: record.checkpointId,
          countedFor: Array.isArray(record.countedFor)
            ? (record.countedFor as { roundId: string; windowIndex: number; late?: boolean }[])
            : [],
        })),
      );
      await this.prisma.systemPrisma.roundWindowState.update({
        where: { id: window.id },
        data: {
          status:
            completion === 'complete_late' && status === 'complete' ? 'complete_late' : status,
          recordedCount,
        },
      });
    }
  }
}
