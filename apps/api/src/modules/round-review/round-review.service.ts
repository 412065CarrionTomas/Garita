import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeRoundWindowStatus,
  haversineMeters,
  localDateTimeToUtc,
  windowOwner,
  windowSeverity,
  type AssignmentOwnerSource,
} from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  RoundWindowStateService,
  assignmentStates,
  windowCoverage,
} from '../supervision/round-window-state.service';
import { CLOCK, type Clock } from '../../common/clock';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import {
  REPORT_RECALCULATION_PORT,
  type ReportRecalculationPort,
} from '../../common/ports/report-recalculation.port';

const DAY = 24 * 60 * 60_000;
/** Cuánto se mira hacia atrás en "Resueltas" y en los antecedentes del vigilador. */
const LOOKBACK_DAYS = 30;
const QUEUE_LIMIT = 200;
const personName = { select: { firstName: true, lastName: true } } as const;
const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`;

/**
 * Dueño de la ventana: la asignación vigente al cierre (la misma regla del recálculo). Solo sus
 * lecturas cuentan para la ventana; las de una asignación anterior del turno no.
 */
function windowAssignment(
  endsAt: Date,
  assignments: {
    id: string;
    startsAt: Date;
    result: AssignmentOwnerSource['result'];
    guardId?: string | null;
    guard: { firstName: string; lastName: string } | null;
  }[],
) {
  const ownerId = windowOwner(
    endsAt.toISOString(),
    assignments.map((assignment) => ({
      id: assignment.id,
      result: assignment.result,
      startsAt: assignment.startsAt.toISOString(),
    })),
  );
  const owner = assignments.find((assignment) => assignment.id === ownerId);
  return owner
    ? {
        assignmentId: owner.id,
        guardId: owner.guardId ?? null,
        guardName: owner.guard ? fullName(owner.guard) : null,
      }
    : null;
}

function belongsToWindow(
  value: unknown,
  roundId: string,
  windowIndex: number,
  lateOnly = false,
): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'roundId' in entry &&
        'windowIndex' in entry &&
        entry.roundId === roundId &&
        entry.windowIndex === windowIndex &&
        (!lateOnly || ('late' in entry && entry.late === true)),
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

  /** Contador de la barra: solo cuenta, para que el sondeo de cada 30 s no arme la bandeja. */
  async pendingCount() {
    return {
      count: await this.prisma.tenantPrisma.roundWindowState.count({
        where: { status: 'in_review' },
      }),
    };
  }

  /**
   * Bandeja de revisión: pendientes (en revisión) o resueltas (30 días, o el rango de fechas), con
   * el vigilador, las marcas vigentes y la última decisión. `count` es siempre el de pendientes.
   * Trae hasta 200: `truncated` avisa que hay más y conviene acotar con fechas o predio.
   */
  async queue(
    user: AuthenticatedUser,
    filter: { estado: 'pendientes' | 'resueltas'; predio?: string; desde?: string; hasta?: string },
  ) {
    const now = this.clock.now().getTime();
    const site = filter.predio ? { shift: { siteId: filter.predio } } : {};
    const db = this.prisma.tenantPrisma;
    const timezone = await this.companyTimezone(user);
    // Fechas de la ronda (inicio de la ventana) en el huso de la empresa, hasta inclusive.
    const dated = Boolean(filter.desde ?? filter.hasta);
    const startsAt = {
      ...(filter.desde ? { gte: localDateTimeToUtc(filter.desde, 0, timezone) } : {}),
      ...(filter.hasta ? { lt: localDateTimeToUtc(filter.hasta, 1440, timezone) } : {}),
    };
    const pending = filter.estado === 'pendientes';
    const [count, overdue, resolvedLastDay, found] = await Promise.all([
      db.roundWindowState.count({ where: { status: 'in_review', ...site } }),
      db.roundWindowState.count({
        where: { status: 'in_review', inReviewSince: { lt: new Date(now - DAY) }, ...site },
      }),
      db.roundWindowState.count({
        where: {
          status: { not: 'in_review' },
          decisions: { some: { decidedAt: { gte: new Date(now - DAY) } } },
          ...site,
        },
      }),
      db.roundWindowState.findMany({
        where: pending
          ? { status: 'in_review', ...site, ...(dated ? { startsAt } : {}) }
          : {
              status: { not: 'in_review' },
              // Sin fechas, lo resuelto en los últimos 30 días; con fechas, las rondas de ese rango.
              ...(dated
                ? { startsAt, decisions: { some: {} } }
                : {
                    decisions: {
                      some: { decidedAt: { gte: new Date(now - LOOKBACK_DAYS * DAY) } },
                    },
                  }),
              ...site,
            },
        // Pendientes: la más vieja primero. Resueltas: las más recientes, para que el tope no
        // deje afuera lo último.
        orderBy: pending
          ? [{ startsAt: 'asc' }, { id: 'asc' }]
          : [{ startsAt: 'desc' }, { id: 'desc' }],
        take: QUEUE_LIMIT + 1,
        include: {
          shift: {
            select: {
              id: true,
              site: { select: { id: true, name: true } },
              assignments: {
                select: { id: true, startsAt: true, result: true, guard: personName },
              },
            },
          },
          round: { select: { name: true } },
          decisions: {
            orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            include: { decidedBy: personName },
          },
        },
      }),
    ]);
    const windows = found.slice(0, QUEUE_LIMIT);
    // Solo lecturas vigentes con alguna marca, agrupadas por turno.
    const flagged = windows.length
      ? await db.checkpointRecord.findMany({
          where: {
            shiftId: { in: [...new Set(windows.map((window) => window.shiftId))] },
            countsForCompliance: true,
            invalidatedAt: null,
            flags: { some: {} },
          },
          select: {
            shiftId: true,
            assignmentId: true,
            countedFor: true,
            flags: { select: { type: true, severity: true } },
          },
        })
      : [];
    const byShift = new Map<string, typeof flagged>();
    for (const record of flagged)
      byShift.set(record.shiftId, [...(byShift.get(record.shiftId) ?? []), record]);
    const items = windows.map((item) => {
      const owner = windowAssignment(item.endsAt, item.shift.assignments);
      const flags = (byShift.get(item.shiftId) ?? [])
        .filter(
          (record) =>
            record.assignmentId === owner?.assignmentId &&
            belongsToWindow(record.countedFor, item.roundId, item.windowIndex),
        )
        .flatMap((record) => record.flags);
      const last = item.decisions.at(0);
      return {
        id: item.id,
        status: item.status,
        severityLevel: item.severityLevel,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        inReviewSince: item.inReviewSince,
        windowIndex: item.windowIndex,
        recordedCount: item.recordedCount,
        expectedCount: item.expectedCount,
        shift: { id: item.shift.id, site: item.shift.site },
        round: item.round,
        guardName: owner?.guardName ?? null,
        flags: {
          grave: flags.filter((flag) => flag.severity === 'grave').length,
          media: flags.filter((flag) => flag.severity === 'media').length,
          leve: flags.filter((flag) => flag.severity === 'leve').length,
          types: [...new Set(flags.map((flag) => flag.type))],
        },
        resolution:
          item.status !== 'in_review' && last
            ? {
                kind: last.kind,
                decidedAt: last.decidedAt,
                decidedBy: fullName(last.decidedBy),
                comment: last.comment,
              }
            : null,
        overdue: Boolean(item.inReviewSince && item.inReviewSince.getTime() < now - DAY),
      };
    });
    // Resueltas: la última decisión primero.
    if (!pending)
      items.sort(
        (a, b) =>
          (b.resolution?.decidedAt.getTime() ?? 0) - (a.resolution?.decidedAt.getTime() ?? 0),
      );
    return {
      timezone,
      count,
      overdue,
      resolvedLastDay,
      truncated: found.length > QUEUE_LIMIT,
      items,
    };
  }

  private async companyTimezone(user: AuthenticatedUser) {
    const company = await this.prisma.tenantPrisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { timezone: true },
    });
    return company.timezone;
  }

  /**
   * Ventana con la evidencia para decidir: por lectura del dueño de la ventana, sus marcas con los
   * datos con que se generaron (`details`), la distancia actual al punto y la precisión; y los
   * antecedentes del vigilador en 30 días.
   */
  async detail(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('RoundWindowState', id);
    const db = this.prisma.tenantPrisma;
    const window = await db.roundWindowState.findFirst({
      where: { id },
      include: {
        shift: {
          select: {
            id: true,
            siteId: true,
            site: { select: { name: true } },
            assignments: {
              select: { id: true, startsAt: true, result: true, guardId: true, guard: personName },
            },
          },
        },
        round: { select: { name: true } },
        decisions: {
          orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
          include: { decidedBy: personName },
        },
      },
    });
    if (!window) throw new NotFoundException('Ventana no encontrada');
    const owner = windowAssignment(window.endsAt, window.shift.assignments);
    // Antecedentes: lecturas que cuentan, hechas en los últimos 30 días; marcas e invalidaciones
    // de esas mismas lecturas, para que las tres cifras hablen de lo mismo.
    const recent = {
      assignment: { guardId: owner?.guardId ?? '' },
      countsForCompliance: true,
      occurredAtDevice: { gte: new Date(this.clock.now().getTime() - LOOKBACK_DAYS * DAY) },
    };
    const [timezone, records, history] = await Promise.all([
      this.companyTimezone(user),
      owner
        ? db.checkpointRecord.findMany({
            where: {
              shiftId: window.shiftId,
              assignmentId: owner.assignmentId,
              countsForCompliance: true,
            },
            orderBy: [{ occurredAtDevice: 'asc' }, { id: 'asc' }],
            include: {
              checkpoint: {
                select: {
                  name: true,
                  latitude: true,
                  longitude: true,
                  toleranceRadiusMeters: true,
                },
              },
              flags: { select: { type: true, severity: true, reason: true, details: true } },
            },
          })
        : [],
      owner?.guardId
        ? Promise.all([
            db.checkpointRecord.count({ where: recent }),
            db.recordFlag.count({ where: { severity: 'grave', checkpointRecord: recent } }),
            db.checkpointRecord.count({ where: { ...recent, invalidatedAt: { not: null } } }),
          ])
        : null,
    ]);
    return {
      id: window.id,
      shiftId: window.shiftId,
      siteId: window.shift.siteId,
      siteName: window.shift.site.name,
      roundName: window.round.name,
      timezone,
      status: window.status,
      severityLevel: window.severityLevel,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      inReviewSince: window.inReviewSince,
      windowIndex: window.windowIndex,
      recordedCount: window.recordedCount,
      expectedCount: window.expectedCount,
      guardName: owner?.guardName ?? null,
      guardHistory: history && {
        days: LOOKBACK_DAYS,
        records: history[0],
        graveFlags: history[1],
        invalidatedRecords: history[2],
      },
      records: records
        .filter((record) => belongsToWindow(record.countedFor, window.roundId, window.windowIndex))
        .map((record) => ({
          id: record.id,
          checkpointName: record.checkpoint.name,
          occurredAtDevice: record.occurredAtDevice,
          invalidated: Boolean(record.invalidatedAt),
          method: record.method,
          radiusMeters: record.checkpoint.toleranceRadiusMeters,
          accuracyMeters: record.accuracyMeters === null ? null : Number(record.accuracyMeters),
          // Contra la posición actual del punto; las marcas traen la de cuando se evaluaron.
          distanceMeters:
            record.latitude === null || record.longitude === null
              ? null
              : Math.round(
                  haversineMeters(
                    Number(record.checkpoint.latitude),
                    Number(record.checkpoint.longitude),
                    Number(record.latitude),
                    Number(record.longitude),
                  ),
                ),
          flags: record.flags,
        })),
      decisions: window.decisions.map((decision) => ({
        id: decision.id,
        kind: decision.kind,
        checkpointRecordId: decision.checkpointRecordId,
        comment: decision.comment,
        decidedAt: decision.decidedAt,
        decidedBy: fullName(decision.decidedBy),
      })),
    };
  }

  async validate(id: string, user: AuthenticatedUser, comment: string) {
    await this.resources.findOwnedOrThrow('RoundWindowState', id);
    const window = await this.prisma.tenantPrisma.roundWindowState.findFirst({
      where: { id },
      select: {
        shiftId: true,
        roundId: true,
        windowIndex: true,
        endsAt: true,
        shift: {
          select: {
            siteId: true,
            assignments: { select: { id: true, startsAt: true, result: true } },
          },
        },
      },
    });
    if (!window) throw new NotFoundException('Ventana no encontrada');
    const decidedAt = this.clock.now();
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const ownerId = windowOwner(
        window.endsAt.toISOString(),
        window.shift.assignments.map((assignment) => ({
          ...assignment,
          startsAt: assignment.startsAt.toISOString(),
          result: assignment.result,
        })),
      );
      const records = await tx.checkpointRecord.findMany({
        where: {
          shiftId: window.shiftId,
          assignmentId: ownerId ?? '',
          countsForCompliance: true,
          invalidatedAt: null,
        },
        select: { countedFor: true },
      });
      const late = records.some((record) =>
        belongsToWindow(record.countedFor, window.roundId, window.windowIndex, true),
      );
      const updated = await tx.roundWindowState.updateMany({
        where: { id, companyId: user.companyId, status: 'in_review' },
        data: { status: late ? 'complete_late' : 'complete', inReviewSince: null },
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
    return this.detail(id, user);
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
        shift: {
          select: {
            siteId: true,
            status: true,
            closeReason: true,
            closedAt: true,
            closedWithoutDataAt: true,
            assignments: { select: { id: true, startsAt: true, result: true, guardId: true } },
            events: { select: { assignmentId: true, type: true, occurredAt: true } },
            syncState: { select: { syncedUntil: true } },
          },
        },
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
    const assignments = assignmentStates(record.shift);
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
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
            assignmentId: true,
            checkpointId: true,
            countedFor: true,
            invalidatedAt: true,
            flags: { select: { type: true } },
          },
        });
        const { ownerId, coverage } = windowCoverage(record.shift, assignments, window);
        const matching = all.filter(
          (item) =>
            item.assignmentId === ownerId &&
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
        const status = computeRoundWindowStatus({
          now: decidedAt,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          graceEndsAt: window.graceEndsAt,
          recordedCount,
          expectedCount: window.expectedCount,
          completedLate: valid.some((item) =>
            belongsToWindow(item.countedFor, window.roundId, window.windowIndex, true),
          ),
          coverage,
          syncedUntil: record.shift.syncState?.syncedUntil ?? null,
        });
        const evaluated =
          record.shift.closedWithoutDataAt && status === 'pending_sync' ? 'not_done' : status;
        const nextStatus =
          (evaluated === 'complete' || evaluated === 'complete_late') && severityLevel === 'grave'
            ? 'in_review'
            : evaluated;
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
    return this.detail(firstWindow.id, user);
  }
}
