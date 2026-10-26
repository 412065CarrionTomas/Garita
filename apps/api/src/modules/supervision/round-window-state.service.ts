import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  computeRoundWindowStatus,
  windowCompletion,
  windowSeverity,
  type ShiftOfflineData,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';

@Injectable()
export class RoundWindowStateService {
  private readonly logger = new Logger(RoundWindowStateService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
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
          companyId: true,
          siteId: true,
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
        select: {
          checkpointId: true,
          countedFor: true,
          invalidatedAt: true,
          flags: { select: { type: true } },
        },
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
      const valid = matching.filter((record) => !record.invalidatedAt);
      const recordedCount = new Set(valid.map((record) => record.checkpointId)).size;
      const severityLevel = windowSeverity(
        matching.map((record) => ({
          flags: record.flags.map((flag) => flag.type),
          invalidated: Boolean(record.invalidatedAt),
        })),
        window.expectedCount,
      );
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
        valid.map((record) => ({
          checkpointId: record.checkpointId,
          countedFor: Array.isArray(record.countedFor)
            ? (record.countedFor as { roundId: string; windowIndex: number; late?: boolean }[])
            : [],
        })),
      );
      const completeStatus =
        completion === 'complete_late' && status === 'complete' ? 'complete_late' : status;
      const validated =
        window.status === 'complete' &&
        (await this.prisma.tenantPrisma.roundReviewDecision.findFirst({
          where: { windowStateId: window.id, kind: 'validate' },
          select: { id: true },
        }));
      const nextStatus =
        (completeStatus === 'complete' || completeStatus === 'complete_late') &&
        severityLevel === 'grave' &&
        !validated
          ? 'in_review'
          : completeStatus;
      await this.prisma.tenantPrisma.roundWindowState.update({
        where: { id: window.id },
        data: {
          status: nextStatus,
          severityLevel,
          recordedCount,
          inReviewSince: nextStatus === 'in_review' ? (window.inReviewSince ?? now) : null,
        },
      });
      if (nextStatus !== window.status || severityLevel !== window.severityLevel) {
        this.realtime.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
          shiftId,
          siteId: shift.siteId,
        });
      }
      if (nextStatus === 'in_review' && window.status !== 'in_review') {
        await this.notifications.notifySiteStaff({
          companyId: shift.companyId,
          siteId: shift.siteId,
          kind: 'round_in_review',
          payload: { kind: 'round_in_review', link: `/revision/${window.id}` },
          priority: 'high',
        });
      }
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
          select: {
            checkpointId: true,
            countedFor: true,
            invalidatedAt: true,
            flags: { select: { type: true } },
          },
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
      const valid = matching.filter((record) => !record.invalidatedAt);
      const recordedCount = new Set(valid.map((record) => record.checkpointId)).size;
      const severityLevel = windowSeverity(
        matching.map((record) => ({
          flags: record.flags.map((flag) => flag.type),
          invalidated: Boolean(record.invalidatedAt),
        })),
        window.expectedCount,
      );
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
        valid.map((record) => ({
          checkpointId: record.checkpointId,
          countedFor: Array.isArray(record.countedFor)
            ? (record.countedFor as { roundId: string; windowIndex: number; late?: boolean }[])
            : [],
        })),
      );
      const completeStatus =
        completion === 'complete_late' && status === 'complete' ? 'complete_late' : status;
      const validated =
        window.status === 'complete' &&
        (await this.prisma.systemPrisma.roundReviewDecision.findFirst({
          where: { windowStateId: window.id, kind: 'validate' },
          select: { id: true },
        }));
      const nextStatus =
        (completeStatus === 'complete' || completeStatus === 'complete_late') &&
        severityLevel === 'grave' &&
        !validated
          ? 'in_review'
          : completeStatus;
      await this.prisma.systemPrisma.roundWindowState.update({
        where: { id: window.id },
        data: {
          status: nextStatus,
          severityLevel,
          recordedCount,
          inReviewSince: nextStatus === 'in_review' ? (window.inReviewSince ?? now) : null,
        },
      });
      if (nextStatus !== window.status) {
        const site = await this.prisma.systemPrisma.shift.findUniqueOrThrow({
          where: { id: window.shiftId },
          select: { siteId: true },
        });
        this.realtime.emitToSite(window.companyId, site.siteId, 'turno.actualizado', {
          shiftId: window.shiftId,
          siteId: site.siteId,
        });
        if (nextStatus === 'in_review')
          await this.notifications.notifySiteStaff({
            companyId: window.companyId,
            siteId: site.siteId,
            kind: 'round_in_review',
            payload: { kind: 'round_in_review', link: `/revision/${window.id}` },
            priority: 'high',
          });
      }
    }
  }
}
