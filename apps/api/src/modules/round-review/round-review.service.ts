import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { windowSeverity } from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundWindowStateService } from '../supervision/round-window-state.service';
import { CLOCK, type Clock } from '../../common/clock';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import {
  REPORT_RECALCULATION_PORT,
  type ReportRecalculationPort,
} from '../../common/ports/report-recalculation.port';

function belongsToWindow(value: unknown, roundId: string, windowIndex: number): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'roundId' in entry &&
        'windowIndex' in entry &&
        entry.roundId === roundId &&
        entry.windowIndex === windowIndex,
    )
  );
}

@Injectable()
export class RoundReviewService {
  private readonly logger = new Logger(RoundReviewService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    private readonly windows: RoundWindowStateService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REPORT_RECALCULATION_PORT) private readonly reports: ReportRecalculationPort,
  ) {}

  async queue(siteId?: string) {
    const items = await this.prisma.tenantPrisma.roundWindowState.findMany({
      where: { status: 'in_review', ...(siteId ? { shift: { siteId } } : {}) },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      include: {
        shift: { select: { id: true, site: { select: { id: true, name: true } } } },
        round: { select: { name: true } },
      },
    });
    return {
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        severityLevel: item.severityLevel,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        windowIndex: item.windowIndex,
        recordedCount: item.recordedCount,
        expectedCount: item.expectedCount,
        shift: item.shift,
        round: item.round,
        overdue: Boolean(
          item.inReviewSince &&
          item.inReviewSince.getTime() < this.clock.now().getTime() - 24 * 60 * 60_000,
        ),
      })),
    };
  }

  async detail(id: string) {
    await this.resources.findOwnedOrThrow('RoundWindowState', id);
    const window = await this.prisma.tenantPrisma.roundWindowState.findFirst({
      where: { id },
      include: {
        shift: { select: { id: true, siteId: true, site: { select: { name: true } } } },
        round: { select: { name: true } },
        decisions: {
          orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
          include: { decidedBy: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!window) throw new NotFoundException('Ventana no encontrada');
    const records = await this.prisma.tenantPrisma.checkpointRecord.findMany({
      where: { shiftId: window.shiftId, countsForCompliance: true },
      orderBy: { occurredAtDevice: 'asc' },
      include: {
        checkpoint: { select: { name: true } },
        flags: { select: { type: true, severity: true, reason: true } },
      },
    });
    return {
      id: window.id,
      shiftId: window.shiftId,
      siteId: window.shift.siteId,
      siteName: window.shift.site.name,
      roundName: window.round.name,
      status: window.status,
      severityLevel: window.severityLevel,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      recordedCount: window.recordedCount,
      expectedCount: window.expectedCount,
      records: records
        .filter((record) => belongsToWindow(record.countedFor, window.roundId, window.windowIndex))
        .map((record) => ({
          id: record.id,
          checkpointName: record.checkpoint.name,
          occurredAtDevice: record.occurredAtDevice,
          invalidated: Boolean(record.invalidatedAt),
          flags: record.flags,
        })),
      decisions: window.decisions.map((decision) => ({
        id: decision.id,
        kind: decision.kind,
        checkpointRecordId: decision.checkpointRecordId,
        comment: decision.comment,
        decidedAt: decision.decidedAt,
        decidedBy: `${decision.decidedBy.firstName} ${decision.decidedBy.lastName}`,
      })),
    };
  }

  async validate(id: string, user: AuthenticatedUser, comment: string) {
    await this.resources.findOwnedOrThrow('RoundWindowState', id);
    const window = await this.prisma.tenantPrisma.roundWindowState.findFirst({
      where: { id },
      select: { shiftId: true, shift: { select: { siteId: true } } },
    });
    if (!window) throw new NotFoundException('Ventana no encontrada');
    const decidedAt = this.clock.now();
    await this.prisma.systemPrisma.$transaction(async (tx) => {
      const updated = await tx.roundWindowState.updateMany({
        where: { id, companyId: user.companyId, status: 'in_review' },
        data: { status: 'complete', inReviewSince: null },
      });
      if (updated.count !== 1) throw new ConflictException('La ventana no está en revisión');
      await tx.roundReviewDecision.create({
        data: {
          companyId: user.companyId,
          windowStateId: id,
          kind: 'validate',
          comment,
          decidedById: user.userId,
          decidedAt,
        },
      });
    });
    await this.reports.recalculate({ companyId: user.companyId, shiftId: window.shiftId });
    this.realtime.emitToSite(user.companyId, window.shift.siteId, 'turno.actualizado', {
      shiftId: window.shiftId,
      siteId: window.shift.siteId,
    });
    this.logger.log({
      event: 'round_review.validate',
      windowStateId: id,
      decidedById: user.userId,
    });
    return this.detail(id);
  }

  async recordDecision(
    id: string,
    kind: 'invalidate' | 'restore',
    user: AuthenticatedUser,
    comment: string,
  ) {
    await this.resources.findOwnedOrThrow('CheckpointRecord', id);
    const record = await this.prisma.tenantPrisma.checkpointRecord.findFirst({
      where: { id },
      select: {
        id: true,
        shiftId: true,
        countedFor: true,
        invalidatedAt: true,
        shift: { select: { siteId: true } },
      },
    });
    if (!record) throw new NotFoundException('Registro no encontrado');
    const windowRefs = Array.isArray(record.countedFor)
      ? record.countedFor.filter(
          (entry): entry is { roundId: string; windowIndex: number } =>
            typeof entry === 'object' &&
            entry !== null &&
            'roundId' in entry &&
            typeof entry.roundId === 'string' &&
            'windowIndex' in entry &&
            typeof entry.windowIndex === 'number',
        )
      : [];
    if (windowRefs.length === 0)
      throw new ConflictException('El registro no pertenece a una ventana');
    const windows = await this.prisma.tenantPrisma.roundWindowState.findMany({
      where: {
        shiftId: record.shiftId,
        OR: windowRefs.map((ref) => ({ roundId: ref.roundId, windowIndex: ref.windowIndex })),
      },
    });
    const firstWindow = windows[0];
    if (!firstWindow) throw new ConflictException('El registro no pertenece a una ventana');
    const decidedAt = this.clock.now();
    await this.prisma.systemPrisma.$transaction(async (tx) => {
      const updated = await tx.checkpointRecord.updateMany({
        where: {
          id,
          companyId: user.companyId,
          invalidatedAt: kind === 'invalidate' ? null : { not: null },
        },
        data: { invalidatedAt: kind === 'invalidate' ? decidedAt : null },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          kind === 'invalidate'
            ? 'El registro ya está invalidado'
            : 'El registro ya está restituido',
        );
      for (const window of windows) {
        await tx.roundReviewDecision.create({
          data: {
            companyId: user.companyId,
            windowStateId: window.id,
            checkpointRecordId: id,
            kind,
            comment,
            decidedById: user.userId,
            decidedAt,
          },
        });
        const all = await tx.checkpointRecord.findMany({
          where: { shiftId: record.shiftId, countsForCompliance: true },
          select: {
            checkpointId: true,
            countedFor: true,
            invalidatedAt: true,
            flags: { select: { type: true } },
          },
        });
        const matching = all.filter((item) =>
          belongsToWindow(item.countedFor, window.roundId, window.windowIndex),
        );
        const valid = matching.filter((item) => !item.invalidatedAt);
        const recordedCount = new Set(valid.map((item) => item.checkpointId)).size;
        const severityLevel = windowSeverity(
          matching.map((item) => ({
            flags: item.flags.map((flag) => flag.type),
            invalidated: Boolean(item.invalidatedAt),
          })),
          window.expectedCount,
        );
        const nextStatus =
          recordedCount === 0
            ? 'not_done'
            : recordedCount < window.expectedCount
              ? 'incomplete'
              : severityLevel === 'grave'
                ? 'in_review'
                : 'complete';
        await tx.roundWindowState.update({
          where: { id: window.id },
          data: {
            recordedCount,
            severityLevel,
            status: nextStatus,
            inReviewSince: nextStatus === 'in_review' ? (window.inReviewSince ?? decidedAt) : null,
          },
        });
      }
    });
    await this.reports.recalculate({ companyId: user.companyId, shiftId: record.shiftId });
    if (kind === 'restore') {
      for (const window of windows) {
        if (
          window.status !== 'in_review' &&
          (
            await this.prisma.tenantPrisma.roundWindowState.findUnique({
              where: { id: window.id },
              select: { status: true },
            })
          )?.status === 'in_review'
        ) {
          await this.notifications.notifySiteStaff({
            companyId: user.companyId,
            siteId: record.shift.siteId,
            kind: 'round_in_review',
            payload: { kind: 'round_in_review', link: `/revision/${window.id}` },
            priority: 'high',
          });
        }
      }
    }
    this.realtime.emitToSite(user.companyId, record.shift.siteId, 'turno.actualizado', {
      shiftId: record.shiftId,
      siteId: record.shift.siteId,
    });
    this.logger.log({
      event: `round_review.${kind}`,
      checkpointRecordId: id,
      decidedById: user.userId,
    });
    return this.detail(firstWindow.id);
  }
}
