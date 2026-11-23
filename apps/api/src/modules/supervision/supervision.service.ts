import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeSyncStatus, type RecordFlagSeverity } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MarcasService } from '../marcas/marcas.service';
import { CLOCK, type Clock } from '../../common/clock';
import type { AuthenticatedUser } from '../auth/auth.types';
import { suspendedVisibleShiftWhere } from '../auth/account-suspension.policy';

@Injectable()
export class SupervisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marcas: MarcasService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(input: { estado?: string; predio?: string; fecha?: string }, user: AuthenticatedUser) {
    const now = this.clock.now();
    const company = await this.prisma.tenantPrisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { timezone: true },
    });
    const localToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: company.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const serviceDate = new Date(`${input.fecha ?? localToday}T00:00:00.000Z`);
    // Default "today" view keeps overnight shifts started before midnight visible while still running.
    const dateWhere = input.fecha
      ? { serviceDate }
      : { OR: [{ serviceDate }, { status: 'in_progress' as const }] };
    const shifts = await this.prisma.tenantPrisma.shift.findMany({
      where: {
        ...(user.suspension ? {} : dateWhere),
        ...suspendedVisibleShiftWhere(user),
        ...(input.predio ? { siteId: input.predio } : {}),
      },
      orderBy: { startsAt: 'asc' },
      include: {
        site: { select: { id: true, name: true, connectivityType: true } },
        assignments: {
          where: { isCurrent: true },
          select: {
            id: true,
            guardId: true,
            guard: { select: { firstName: true, lastName: true, status: true } },
          },
        },
        events: {
          where: { type: { in: ['close', 'admin_close'] }, assignment: { isCurrent: true } },
          orderBy: { receivedAt: 'desc' },
          take: 1,
          select: { type: true },
        },
        syncState: true,
        roundWindowStates: { select: { status: true } },
      },
    });
    return shifts.flatMap((shift) => {
      const status =
        shift.status === 'unassigned' || shift.assignments[0]?.guard?.status === 'deactivated'
          ? 'without_guard'
          : shift.status === 'closed' &&
              shift.closedEarly &&
              shift.closeReason !== 'baja del predio' &&
              now < shift.endsAt
            ? 'uncovered'
            : shift.status === 'scheduled' && now >= shift.endsAt
              ? 'no_show'
              : shift.status;
      if (input.estado && status !== input.estado) return [];
      return [
        {
          id: shift.id,
          site: shift.site,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          status,
          syncStatus: shift.startedAt
            ? computeSyncStatus({
                now,
                lastContactAt: shift.syncState?.lastContactAt ?? null,
                pendingCount: shift.syncState?.lastPendingCount ?? 0,
                syncedUntil: shift.syncState?.syncedUntil ?? null,
                scheduledEndAt: shift.endsAt,
                syncDeadlineAt: shift.syncDeadlineAt,
                withoutSignal: shift.connectivityType === 'without_signal',
                closed: shift.status === 'closed' || shift.events.length > 0,
                closedWithoutData: Boolean(shift.closedWithoutDataAt),
              })
            : null,
          assignment: shift.assignments[0] ?? null,
          windows: shift.roundWindowStates.reduce<Record<string, number>>((summary, window) => {
            summary[window.status] = (summary[window.status] ?? 0) + 1;
            return summary;
          }, {}),
        },
      ];
    });
  }

  async detail(
    shiftId: string,
    user: AuthenticatedUser,
    filter: { marcados?: boolean; gravedad?: RecordFlagSeverity },
  ) {
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: { id: shiftId },
      include: {
        site: { select: { id: true, name: true, connectivityType: true, minutesToSignal: true } },
        assignments: {
          orderBy: { createdAt: 'asc' },
          include: {
            guard: { select: { id: true, firstName: true, lastName: true, status: true } },
            assignedBy: { select: { firstName: true, lastName: true } },
          },
        },
        events: { orderBy: { occurredAt: 'asc' } },
        syncState: true,
        rounds: {
          include: {
            round: {
              select: {
                name: true,
                currentVersion: {
                  include: {
                    checkpoints: {
                      orderBy: { position: 'asc' },
                      include: {
                        checkpoint: {
                          select: { id: true, name: true, latitude: true, longitude: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            roundVersion: {
              include: {
                checkpoints: {
                  orderBy: { position: 'asc' },
                  include: {
                    checkpoint: {
                      select: { id: true, name: true, latitude: true, longitude: true },
                    },
                  },
                },
              },
            },
          },
        },
        roundWindowStates: { orderBy: [{ startsAt: 'asc' }, { roundId: 'asc' }] },
        checkpointRecords: {
          orderBy: { occurredAtDevice: 'asc' },
          include: {
            checkpoint: { select: { id: true, name: true, latitude: true, longitude: true } },
          },
        },
        invalidScanAttempts: {
          orderBy: { occurredAtDevice: 'asc' },
          select: {
            id: true,
            method: true,
            reason: true,
            occurredAtDevice: true,
            highlighted: true,
          },
        },
      },
    });
    if (!shift) throw new NotFoundException('Turno no encontrado');
    const records = await this.marcas.getShiftRecords(shiftId, filter, user);
    const pointIds = new Set(
      shift.checkpointRecords
        .filter(
          (record) =>
            record.countsForCompliance &&
            !record.invalidatedAt &&
            Array.isArray(record.countedFor) &&
            record.countedFor.some(
              (entry) =>
                typeof entry === 'object' &&
                entry !== null &&
                'roundId' in entry &&
                'windowIndex' in entry &&
                shift.roundWindowStates.some(
                  (window) =>
                    window.roundId === entry.roundId && window.windowIndex === entry.windowIndex,
                ),
            ),
        )
        .map((record) => record.checkpointId),
    );
    const points = [
      ...new Map(
        shift.rounds.flatMap(
          (round) =>
            (round.roundVersion ?? round.round.currentVersion)?.checkpoints.map(
              ({ checkpoint }) =>
                [
                  checkpoint.id,
                  {
                    ...checkpoint,
                    latitude: Number(checkpoint.latitude),
                    longitude: Number(checkpoint.longitude),
                    registered: pointIds.has(checkpoint.id),
                  },
                ] as const,
            ) ?? [],
        ),
      ).values(),
    ];
    const orderedRecords = records.records
      .filter((record) =>
        filter.marcados === false
          ? record.flags.length === 0
          : filter.marcados
            ? record.flags.length > 0
            : true,
      )
      .filter(
        (record) =>
          !filter.gravedad || record.flags.some((flag) => flag.severity === filter.gravedad),
      );
    return {
      id: shift.id,
      site: shift.site,
      status:
        shift.status === 'unassigned' ||
        shift.assignments.find((assignment) => assignment.isCurrent)?.guard?.status ===
          'deactivated'
          ? 'without_guard'
          : shift.status === 'closed' &&
              shift.closedEarly &&
              shift.closeReason !== 'baja del predio' &&
              this.clock.now() < shift.endsAt
            ? 'uncovered'
            : shift.status === 'scheduled' && this.clock.now() >= shift.endsAt
              ? 'no_show'
              : shift.status,
      scheduled: { startsAt: shift.startsAt, endsAt: shift.endsAt },
      actual: {
        startedAt: shift.startedAt,
        closedAt: shift.closedAt,
        closedEarly: shift.closedEarly,
        closeReason: shift.closeReason,
        closedBy: shift.closedBy,
      },
      // Mismo cálculo que la lista: el cierre cuenta solo si es de la asignación vigente.
      syncStatus: shift.startedAt
        ? computeSyncStatus({
            now: this.clock.now(),
            lastContactAt: shift.syncState?.lastContactAt ?? null,
            pendingCount: shift.syncState?.lastPendingCount ?? 0,
            syncedUntil: shift.syncState?.syncedUntil ?? null,
            scheduledEndAt: shift.endsAt,
            syncDeadlineAt: shift.syncDeadlineAt,
            withoutSignal: shift.connectivityType === 'without_signal',
            closed:
              shift.status === 'closed' ||
              shift.events.some(
                (event) =>
                  (event.type === 'close' || event.type === 'admin_close') &&
                  event.assignmentId ===
                    shift.assignments.find((assignment) => assignment.isCurrent)?.id,
              ),
            closedWithoutData: Boolean(shift.closedWithoutDataAt),
          })
        : null,
      phoneWithoutNfc: records.phoneWithoutNfc,
      assignments: shift.assignments,
      rounds: shift.rounds.map((round) => ({ id: round.roundId, name: round.round.name })),
      windows: shift.roundWindowStates,
      points,
      route: orderedRecords
        .filter((record) => record.latitude !== null && record.longitude !== null)
        .map((record) => ({
          checkpointId: record.checkpointId,
          latitude: record.latitude,
          longitude: record.longitude,
          occurredAtDevice: record.occurredAtDevice,
        })),
      records: orderedRecords,
      rejectedAttempts: shift.invalidScanAttempts,
      canCover:
        this.clock.now() < shift.endsAt &&
        (shift.status === 'scheduled' ||
          shift.status === 'unassigned' ||
          (shift.status === 'closed' &&
            shift.closedEarly &&
            shift.closeReason !== 'baja del predio')),
    };
  }
}
