import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  computeRoundWindowStatus,
  computeRoundWindows,
  shouldNotifyMissedRound,
  windowCompletion,
  windowOwner,
  windowSeverity,
  windowsForShift,
  type AssignmentResult,
  type ShiftOfflineData,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { NOTICES_PORT, type NoticesPort } from '../../common/ports/notices.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';

@Injectable()
export class RoundWindowStateService {
  private readonly logger = new Logger(RoundWindowStateService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    @Inject(NOTICES_PORT) private readonly notices: NoticesPort,
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
    // BullMQ y las credenciales de sincronización no tienen contexto de usuario autenticado.
    this.logger.debug({ event: 'round_window.recalculate_system_query', shiftId });
    const db = this.prisma.systemPrisma;
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      include: {
        site: { select: { name: true } },
        assignments: { orderBy: { startsAt: 'asc' } },
        events: { select: { assignmentId: true, type: true, occurredAt: true } },
        syncState: true,
        rounds: {
          include: {
            roundVersion: {
              include: { checkpoints: { include: { checkpoint: { select: { name: true } } } } },
            },
          },
        },
        roundWindowStates: {
          where: affectedWindows
            ? { OR: affectedWindows.map(({ roundId, windowIndex }) => ({ roundId, windowIndex })) }
            : {},
        },
        checkpointRecords: {
          where: { countsForCompliance: true },
          include: { flags: { select: { type: true } } },
        },
      },
    });
    if (!shift) return;
    const now = this.clock.now();
    const assignments = shift.assignments.map((assignment) => {
      const started = shift.events.some(
        (event) => event.assignmentId === assignment.id && event.type === 'start',
      );
      const closed = shift.events.some(
        (event) =>
          event.assignmentId === assignment.id &&
          (event.type === 'close' || event.type === 'admin_close'),
      );
      const result: AssignmentResult =
        assignment.result === 'replaced' ||
        assignment.result === 'absent' ||
        assignment.result === 'closed_early' ||
        assignment.result === 'started'
          ? assignment.result
          : started
            ? closed
              ? 'closed_early'
              : 'started'
            : 'scheduled';
      return { id: assignment.id, startsAt: assignment.startsAt.toISOString(), result, started };
    });
    for (const window of shift.roundWindowStates) {
      const ownerId = windowOwner(window.endsAt.toISOString(), assignments);
      const owner = assignments.find((assignment) => assignment.id === ownerId);
      const closeEvent = shift.events.find(
        (event) =>
          event.assignmentId === ownerId &&
          (event.type === 'close' || event.type === 'admin_close'),
      );
      const siteClosed = shift.closeReason === 'baja del predio';
      const coverage =
        shift.status === 'cancelled'
          ? 'cancelled'
          : siteClosed && shift.closedAt && window.endsAt > shift.closedAt
            ? 'site_closed_after'
            : !owner || !shift.assignments.find((assignment) => assignment.id === ownerId)?.guardId
              ? 'unassigned'
              : !owner.started
                ? 'absent'
                : closeEvent?.type === 'close' && window.startsAt >= closeEvent.occurredAt
                  ? 'guard_closed_after'
                  : closeEvent?.type === 'close'
                    ? 'guard_closed'
                    : closeEvent?.type === 'admin_close' && window.endsAt > closeEvent.occurredAt
                      ? 'admin_closed_after'
                      : closeEvent?.type === 'admin_close'
                        ? 'admin_closed_before'
                        : 'active';
      const round = shift.rounds.find((item) => item.roundId === window.roundId);
      const checkpoints = round?.roundVersion?.checkpoints ?? [];
      const matching = shift.checkpointRecords.filter(
        (record) =>
          record.assignmentId === ownerId &&
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
      const recorded = new Set(valid.map((record) => record.checkpointId));
      const severityLevel = windowSeverity(
        matching.map((record) => ({
          flags: record.flags.map((flag) => flag.type),
          invalidated: Boolean(record.invalidatedAt),
        })),
        window.expectedCount,
      );
      const status = computeRoundWindowStatus({
        now,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        graceEndsAt: window.graceEndsAt,
        recordedCount: recorded.size,
        expectedCount: window.expectedCount,
        coverage,
        syncedUntil: shift.syncState?.syncedUntil ?? null,
      });
      const completion = windowCompletion(
        { roundId: window.roundId, checkpointIds: checkpoints.map((entry) => entry.checkpointId) },
        { roundId: window.roundId, index: window.windowIndex },
        valid.map((record) => ({
          checkpointId: record.checkpointId,
          countedFor: Array.isArray(record.countedFor)
            ? (record.countedFor as { roundId: string; windowIndex: number; late?: boolean }[])
            : [],
        })),
      );
      const completeStatus =
        shift.closedWithoutDataAt && status === 'pending_sync'
          ? 'not_done'
          : completion === 'complete_late' && status === 'complete'
            ? 'complete_late'
            : status;
      const validated =
        window.status === 'complete' &&
        (await db.roundReviewDecision.findFirst({
          where: { windowStateId: window.id, kind: 'validate' },
          select: { id: true },
        }));
      const nextStatus =
        (completeStatus === 'complete' || completeStatus === 'complete_late') &&
        severityLevel === 'grave' &&
        !validated
          ? 'in_review'
          : completeStatus;
      await db.roundWindowState.update({
        where: { id: window.id },
        data: {
          status: nextStatus,
          severityLevel,
          recordedCount: recorded.size,
          inReviewSince: nextStatus === 'in_review' ? (window.inReviewSince ?? now) : null,
        },
      });
      if (nextStatus !== window.status || severityLevel !== window.severityLevel)
        this.realtime.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
          shiftId,
          siteId: shift.siteId,
        });
      if (nextStatus === 'in_review' && window.status !== 'in_review')
        await this.notifications.notifySiteStaff({
          companyId: shift.companyId,
          siteId: shift.siteId,
          kind: 'round_in_review',
          payload: { kind: 'round_in_review', link: `/revision/${window.id}` },
          priority: 'high',
        });
      if (
        shouldNotifyMissedRound(nextStatus) &&
        status !== 'pending_sync' &&
        owner?.started &&
        coverage !== 'guard_closed_after' &&
        coverage !== 'admin_closed_after'
      ) {
        await this.notices.raise({
          companyId: shift.companyId,
          siteId: shift.siteId,
          shiftId,
          kind: 'round_missed',
          subjectId: window.id,
          details: {
            kind: 'round_missed',
            siteName: shift.site.name,
            shiftId,
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString(),
            missingPoints: checkpoints
              .filter((entry) => !recorded.has(entry.checkpointId))
              .map((entry) => entry.checkpoint.name),
            severityLevel,
          },
        });
      } else if (nextStatus === 'complete' || nextStatus === 'complete_late')
        await this.notices.resolve({
          companyId: shift.companyId,
          kind: 'round_missed',
          subjectId: window.id,
          resolution: 'data_arrived',
        });
    }
  }

  async recalculateExpired(): Promise<void> {
    const now = this.clock.now();
    this.logger.debug({ event: 'round_window.expiry_sweep' });
    const unstarted = await this.prisma.systemPrisma.shift.findMany({
      where: {
        startsAt: { lte: now },
        status: { in: ['scheduled', 'unassigned', 'no_show', 'uncovered'] },
        roundWindowStates: { none: {} },
      },
      include: {
        company: { select: { timezone: true } },
        rounds: {
          include: {
            roundVersion: { include: { checkpoints: { select: { checkpointId: true } } } },
            round: {
              include: {
                currentVersion: { include: { checkpoints: { select: { checkpointId: true } } } },
              },
            },
          },
        },
      },
    });
    for (const shift of unstarted) {
      const date = shift.serviceDate.toISOString().slice(0, 10);
      const previous = new Date(`${date}T00:00:00.000Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      const data = shift.rounds.flatMap((round) => {
        const version = round.roundVersion ?? round.round.currentVersion;
        if (!version) return [];
        const candidates = [previous.toISOString().slice(0, 10), date].flatMap((day) =>
          computeRoundWindows(day, {
            windowStartLocal: version.windowStartLocal,
            windowEndLocal: version.windowEndLocal,
            frequencyMinutes: version.frequencyMinutes,
            timezone: shift.company.timezone,
          }),
        );
        return windowsForShift(candidates, {
          shiftStartUtc: shift.startsAt.toISOString(),
          shiftEndUtc: shift.endsAt.toISOString(),
        }).endingInShift.map((window, windowIndex) => {
          const endsAt = new Date(window.endUtc);
          return {
            companyId: shift.companyId,
            shiftId: shift.id,
            roundId: round.roundId,
            windowIndex,
            startsAt: new Date(window.startUtc),
            endsAt,
            graceEndsAt: new Date(endsAt.getTime() + version.graceMinutes * 60_000),
            expectedCount: version.checkpoints.length,
          };
        });
      });
      if (data.length)
        await this.prisma.systemPrisma.roundWindowState.createMany({ data, skipDuplicates: true });
    }
    const windows = await this.prisma.systemPrisma.roundWindowState.findMany({
      where: {
        endsAt: { lte: now },
        status: { in: ['pending', 'in_progress', 'late', 'pending_sync'] },
      },
      select: { shiftId: true },
      distinct: ['shiftId'],
    });
    for (const { shiftId } of windows) await this.recalculate(shiftId);
    const shifts = await this.prisma.systemPrisma.shift.findMany({
      where: {
        startedAt: { not: null },
        syncDeadlineAt: { lte: now },
        status: { not: 'cancelled' },
        events: { none: { type: 'close', assignment: { isCurrent: true } } },
      },
      select: {
        id: true,
        companyId: true,
        siteId: true,
        startsAt: true,
        endsAt: true,
        site: { select: { name: true } },
        syncState: { select: { syncedUntil: true } },
      },
    });
    for (const shift of shifts) {
      if (shift.syncState?.syncedUntil && shift.syncState.syncedUntil >= shift.endsAt) continue;
      await this.notices.raise({
        companyId: shift.companyId,
        siteId: shift.siteId,
        shiftId: shift.id,
        kind: 'shift_unsynced',
        subjectId: shift.id,
        details: {
          kind: 'shift_unsynced',
          siteName: shift.site.name,
          shiftId: shift.id,
          startsAt: shift.startsAt.toISOString(),
          endsAt: shift.endsAt.toISOString(),
        },
      });
    }
  }
}
