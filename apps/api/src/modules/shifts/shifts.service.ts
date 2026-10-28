import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  assignWindowsToShifts,
  computeRoundWindows,
  findUncoveredWindows,
  windowsForShift,
  buildShiftNotification,
  previousAssignmentResult,
  type ReassignShiftRequest,
  type ShiftInput,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CLOCK, type Clock } from '../../common/clock';
import { isShiftOverlapViolation } from './shift-overlap-error';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { NOTICES_PORT, type NoticesPort } from '../../common/ports/notices.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';

interface ShiftListQuery {
  predio?: string;
  vigilador?: string;
  desde?: string;
  hasta?: string;
  sinVigilador?: 'true' | 'false';
}

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(NOTICES_PORT) private readonly notices: NoticesPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {}

  async list(query: ShiftListQuery) {
    if (query.predio) await this.resources.findOwnedOrThrow('Site', query.predio);
    if (query.vigilador) await this.assertGuard(query.vigilador);
    return this.prisma.tenantPrisma.shift.findMany({
      where: {
        ...(query.predio ? { siteId: query.predio } : {}),
        ...(query.vigilador
          ? { assignments: { some: { guardId: query.vigilador, isCurrent: true } } }
          : {}),
        ...(query.sinVigilador === 'true' ? { status: 'unassigned' } : {}),
        ...(query.sinVigilador === 'false' ? { status: 'scheduled' } : {}),
        ...(query.desde || query.hasta
          ? {
              startsAt: {
                ...(query.desde ? { gte: new Date(query.desde) } : {}),
                ...(query.hasta ? { lte: new Date(query.hasta) } : {}),
              },
            }
          : {}),
      },
      include: this.shiftInclude(),
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
  }

  async get(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Shift', id);
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: {
        id,
        ...(user.role === 'guard'
          ? { assignments: { some: { guardId: user.userId, isCurrent: true } } }
          : {}),
      },
      include: this.shiftInclude(),
    });
    if (!shift) {
      if (user.role === 'guard') throw new ForbiddenException('No podés consultar turnos ajenos');
      throw new NotFoundException('Turno no encontrado');
    }
    if (
      user.role === 'supervisor' &&
      !(await this.prisma.tenantPrisma.siteSupervisor.findFirst({
        where: { siteId: shift.siteId, userId: user.userId },
      }))
    )
      throw new NotFoundException('Turno no encontrado');
    return shift;
  }

  async create(input: ShiftInput, user: AuthenticatedUser) {
    const validation = await this.validateInput(input, user);
    const conflict = input.guardId
      ? await this.findConflict(input.guardId, input.startsAt, input.endsAt)
      : null;
    if (conflict)
      throw new ConflictException({
        code: 'SHIFT_OVERLAP',
        message: 'El vigilador ya tiene un turno superpuesto',
        shift: conflict,
      });
    const timezone = (await this.site(input.siteId)).company.timezone;
    const serviceDate = localDate(new Date(input.startsAt), timezone);
    const status = input.guardId ? 'scheduled' : 'unassigned';
    try {
      const shift = await this.prisma.tenantPrisma.shift.create({
        data: {
          companyId: user.companyId,
          siteId: input.siteId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          serviceDate: new Date(`${serviceDate}T00:00:00.000Z`),
          status,
          createdById: user.userId,
          assignments: {
            create: {
              guardId: input.guardId,
              startsAt: new Date(input.startsAt),
              endsAt: new Date(input.endsAt),
              assignedById: user.userId,
            },
          },
          rounds: { create: input.roundIds.map((roundId) => ({ roundId })) },
        },
        include: this.shiftInclude(),
      });
      this.logger.log({ action: 'shift.created', shiftId: shift.id, userId: user.userId });
      if (input.guardId)
        await this.notifyGuard(
          user.companyId,
          input.guardId,
          'shift_assigned',
          shift.id,
          shift.startsAt,
          timezone,
        );
      return await this.withWarnings(shift, validation);
    } catch (error) {
      await this.throwOverlapOrRethrow(error, input.guardId, input.startsAt, input.endsAt);
    }
  }

  async update(id: string, input: ShiftInput, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Shift', id);
    const shift = await this.prisma.tenantPrisma.shift.findUniqueOrThrow({ where: { id } });
    const previousAssignment = await this.prisma.tenantPrisma.shiftAssignment.findFirst({
      where: { shiftId: id, isCurrent: true },
      select: { guardId: true },
    });
    if (shift.status === 'cancelled') throw new ConflictException('El turno está cancelado');
    if (shift.startsAt <= this.clock.now())
      throw new ConflictException({
        code: 'SHIFT_STARTED',
        message: 'Solo se puede reasignar el turno',
      });
    const validation = await this.validateInput(input, user);
    const conflict = input.guardId
      ? await this.findConflict(input.guardId, input.startsAt, input.endsAt, id)
      : null;
    if (conflict)
      throw new ConflictException({
        code: 'SHIFT_OVERLAP',
        message: 'El vigilador ya tiene un turno superpuesto',
        shift: conflict,
      });
    const timezone = (await this.site(input.siteId)).company.timezone;
    const serviceDate = localDate(new Date(input.startsAt), timezone);
    try {
      const updated = await this.prisma.tenantPrisma.$transaction(async (tx) => {
        await tx.shiftAssignment.updateMany({
          where: { shiftId: id, isCurrent: true },
          data: { isCurrent: false, active: false, result: 'replaced' },
        });
        await tx.shiftRound.deleteMany({ where: { shiftId: id } });
        return tx.shift.update({
          where: { id },
          data: {
            siteId: input.siteId,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            serviceDate: new Date(`${serviceDate}T00:00:00.000Z`),
            status: input.guardId ? 'scheduled' : 'unassigned',
            assignments: {
              create: {
                guardId: input.guardId,
                startsAt: new Date(input.startsAt),
                endsAt: new Date(input.endsAt),
                assignedById: user.userId,
              },
            },
            rounds: { create: input.roundIds.map((roundId) => ({ roundId })) },
          },
          include: this.shiftInclude(),
        });
      });
      this.logger.log({ action: 'shift.updated', shiftId: id, userId: user.userId });
      if (previousAssignment?.guardId && previousAssignment.guardId !== input.guardId)
        await this.notifyGuard(
          user.companyId,
          previousAssignment.guardId,
          'shift_removed',
          id,
          shift.startsAt,
          timezone,
        );
      if (input.guardId && input.guardId !== previousAssignment?.guardId)
        await this.notifyGuard(
          user.companyId,
          input.guardId,
          'shift_assigned',
          id,
          updated.startsAt,
          timezone,
        );
      else if (
        input.guardId &&
        (shift.startsAt.getTime() !== updated.startsAt.getTime() ||
          shift.endsAt.getTime() !== updated.endsAt.getTime())
      )
        await this.notifyGuard(
          user.companyId,
          input.guardId,
          'shift_changed',
          id,
          updated.startsAt,
          timezone,
        );
      return await this.withWarnings(updated, validation);
    } catch (error) {
      await this.throwOverlapOrRethrow(error, input.guardId, input.startsAt, input.endsAt);
    }
  }

  async assignments(id: string, user: AuthenticatedUser) {
    await this.get(id, user);
    return this.prisma.tenantPrisma.shiftAssignment.findMany({
      where: { shiftId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        guard: { select: { firstName: true, lastName: true } },
        assignedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async reassign(id: string, input: ReassignShiftRequest, user: AuthenticatedUser) {
    const shift = await this.get(id, user);
    const now = this.clock.now();
    if (now >= shift.endsAt)
      throw new ConflictException({
        code: 'SHIFT_NOT_REASSIGNABLE',
        message: 'El turno ya terminó',
      });
    const startsAt = input.startsAt ? new Date(input.startsAt) : now;
    if (startsAt < now || startsAt >= shift.endsAt)
      throw new BadRequestException('La hora de inicio debe estar entre ahora y el fin del turno');
    const covering =
      shift.status === 'closed' &&
      shift.closedEarly &&
      shift.closeReason !== 'baja del predio' &&
      now < shift.endsAt;
    if (!['scheduled', 'unassigned'].includes(shift.status) && !covering)
      throw new ConflictException({
        code: 'SHIFT_NOT_REASSIGNABLE',
        message: 'El turno ya se inició o terminó',
      });
    const current = shift.assignments[0];
    if (!current) throw new ConflictException('El turno no tiene una asignación vigente');
    if (current.guardId === input.guardId)
      throw new BadRequestException('Elegí un vigilador distinto del asignado');
    const guard = await this.prisma.tenantPrisma.user.findFirst({
      where: { id: input.guardId, role: 'guard', status: 'active' },
      select: { id: true },
    });
    if (!guard) throw new BadRequestException('El vigilador debe estar activo');
    const conflict = await this.findConflict(
      input.guardId,
      startsAt.toISOString(),
      shift.endsAt.toISOString(),
      id,
    );
    if (conflict)
      throw new ConflictException({
        code: 'SHIFT_OVERLAP',
        message: 'El vigilador ya tiene un turno superpuesto',
        shift: conflict,
      });
    const priorResult = previousAssignmentResult({
      covering,
      hadGuard: Boolean(current.guardId),
      previousStartsAt: current.startsAt,
      now,
    });
    const assignment = await this.prisma.tenantPrisma
      .$transaction(async (tx) => {
        const changed = await tx.shiftAssignment.updateMany({
          where: { id: current.id, isCurrent: true, result: covering ? 'started' : 'scheduled' },
          data: { isCurrent: false, active: false, result: priorResult },
        });
        if (changed.count !== 1)
          throw new ConflictException({
            code: 'SHIFT_ALREADY_STARTED',
            message: 'El vigilador acaba de iniciar el turno',
          });
        const updated = await tx.shift.updateMany({
          where: { id, status: shift.status },
          data: {
            status: 'scheduled',
            startedAt: null,
            lateStartMinutes: null,
            closedAt: null,
            closedEarly: false,
            closeReason: null,
            closedBy: null,
            closedByUserId: null,
            individuallyModified: true, // TODO(HU-32): weekly scheduling must preserve individually modified shifts.
          },
        });
        if (updated.count !== 1)
          throw new ConflictException({
            code: 'SHIFT_ALREADY_STARTED',
            message: 'El vigilador acaba de iniciar el turno',
          });
        return tx.shiftAssignment.create({
          data: {
            shiftId: id,
            guardId: input.guardId,
            startsAt,
            endsAt: shift.endsAt,
            assignedById: user.userId,
            reassignedAt: now,
          },
        });
      })
      .catch((error: unknown) =>
        this.throwOverlapOrRethrow(
          error,
          input.guardId,
          startsAt.toISOString(),
          shift.endsAt.toISOString(),
        ),
      );
    this.logger.log({
      action: 'shift.reassigned',
      shiftId: id,
      userId: user.userId,
      at: now.toISOString(),
      assignmentId: assignment.id,
    });
    try {
      await this.notices.resolve({
        companyId: user.companyId,
        kind: covering
          ? 'shift_closed_early'
          : current.guardId
            ? 'shift_not_started'
            : 'shift_without_guard',
        subjectId: covering || current.guardId ? current.id : id,
        resolution: covering ? 'covered' : current.guardId ? 'reassigned' : 'guard_assigned',
      });
    } catch (error) {
      this.logger.error({ action: 'shift.notice_resolution_failed', shiftId: id, error });
    }
    const timezone = shift.site.company.timezone;
    if (current.guardId)
      await this.notifyGuard(
        user.companyId,
        current.guardId,
        'shift_reassigned_from_you',
        id,
        current.startsAt,
        timezone,
      );
    await this.notifyGuard(
      user.companyId,
      input.guardId,
      'shift_reassigned_to_you',
      id,
      startsAt,
      timezone,
    );
    this.realtime.emitToSite(user.companyId, shift.siteId, 'turno.actualizado', {
      shiftId: id,
      siteId: shift.siteId,
    });
    const minutesToSignal = shift.site.minutesToSignal;
    return {
      shiftId: id,
      assignmentId: assignment.id,
      ...(shift.site.connectivityType === 'without_signal' &&
      startsAt.getTime() + minutesToSignal * 60_000 > shift.endsAt.getTime()
        ? { warning: 'replacement_late' as const }
        : {}),
    };
  }

  async cancel(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Shift', id);
    const shift = await this.prisma.tenantPrisma.shift.findUniqueOrThrow({ where: { id } });
    const assignment = await this.prisma.tenantPrisma.shiftAssignment.findFirst({
      where: { shiftId: id, isCurrent: true },
      select: { guardId: true },
    });
    if (shift.status === 'cancelled') throw new ConflictException('El turno ya está cancelado');
    if (shift.startsAt <= this.clock.now())
      throw new ConflictException({
        code: 'SHIFT_STARTED',
        message: 'Solo se puede reasignar el turno',
      });
    const result = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.shiftAssignment.updateMany({
        where: { shiftId: id, active: true },
        data: { active: false },
      });
      return tx.shift.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: this.clock.now(),
          cancelledById: user.userId,
          cancellationReason: 'Cancelación manual',
        },
      });
    });
    this.logger.log({ action: 'shift.cancelled', shiftId: id, userId: user.userId });
    if (assignment?.guardId) {
      const timezone = (await this.site(shift.siteId)).company.timezone;
      await this.notifyGuard(
        user.companyId,
        assignment.guardId,
        'shift_cancelled',
        id,
        shift.startsAt,
        timezone,
      );
    }
    return result;
  }

  async mine(user: AuthenticatedUser) {
    const now = this.clock.now();
    const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return this.prisma.tenantPrisma.shift.findMany({
      where: {
        status: { in: ['scheduled', 'unassigned'] },
        endsAt: { gte: now },
        assignments: { some: { guardId: user.userId, isCurrent: true, startsAt: { lte: until } } },
      },
      include: this.shiftInclude(),
      orderBy: { startsAt: 'asc' },
    });
  }

  async futureForUser(id: string) {
    await this.resources.findOwnedOrThrow('User', id);
    return this.prisma.tenantPrisma.shift.findMany({
      where: {
        status: 'scheduled',
        startsAt: { gt: this.clock.now() },
        assignments: { some: { guardId: id, isCurrent: true } },
      },
      include: this.shiftInclude(),
      orderBy: { startsAt: 'asc' },
    });
  }

  private async validateInput(input: ShiftInput, user: AuthenticatedUser) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt <= this.clock.now())
      throw new BadRequestException({
        code: 'SHIFT_START_IN_PAST',
        message: 'El inicio no puede estar en el pasado',
      });
    const site = await this.site(input.siteId);
    if (site.status !== 'active') throw new NotFoundException('Predio no encontrado');
    if (user.role === 'supervisor' && !site.supervisors.some((item) => item.userId === user.userId))
      throw new NotFoundException('Predio no encontrado');
    const guard = input.guardId ? await this.assertGuard(input.guardId) : null;
    const rounds = await this.prisma.tenantPrisma.round.findMany({
      where: { id: { in: input.roundIds }, siteId: input.siteId, status: 'active' },
      include: { currentVersion: true },
    });
    if (rounds.length !== input.roundIds.length)
      throw new NotFoundException('Una o más rondas no pertenecen al predio o están inactivas');
    const startDate = localDate(startsAt, site.company.timezone);
    const roundDates = [previousDate(startDate), startDate];
    const endsInShift = rounds.some((round) => {
      const version = round.currentVersion;
      if (!version) return false;
      const windows = roundDates.flatMap((date) =>
        computeRoundWindows(date, {
          windowStartLocal: version.windowStartLocal,
          windowEndLocal: version.windowEndLocal,
          frequencyMinutes: version.frequencyMinutes,
          timezone: site.company.timezone,
        }),
      );
      return (
        windowsForShift(windows, {
          shiftStartUtc: startsAt.toISOString(),
          shiftEndUtc: endsAt.toISOString(),
        }).endingInShift.length > 0
      );
    });
    if (!endsInShift)
      throw new BadRequestException({
        code: 'NO_WINDOWS_IN_SHIFT',
        message: 'Ninguna ventana termina dentro del turno',
      });
    return { invitationPending: guard?.invitationPending ?? false };
  }

  private async withWarnings<
    T extends {
      id: string;
      siteId: string;
      startsAt: Date;
      endsAt: Date;
      rounds: {
        roundId: string;
        round: {
          currentVersion: {
            windowStartLocal: string;
            windowEndLocal: string;
            frequencyMinutes: number;
          } | null;
        };
      }[];
    },
  >(shift: T, validation: { invitationPending: boolean }) {
    const site = await this.site(shift.siteId);
    const startDate = localDate(shift.startsAt, site.company.timezone);
    const ownWindows = shift.rounds.flatMap(({ roundId, round }) => {
      const version = round.currentVersion;
      if (!version) return [];
      return [previousDate(startDate), startDate].flatMap((date) =>
        computeRoundWindows(date, {
          windowStartLocal: version.windowStartLocal,
          windowEndLocal: version.windowEndLocal,
          frequencyMinutes: version.frequencyMinutes,
          timezone: site.company.timezone,
        }).map((window) => ({ ...window, roundId })),
      );
    });
    const other = await this.prisma.tenantPrisma.shift.findMany({
      where: { siteId: shift.siteId, status: { not: 'cancelled' }, id: { not: shift.id } },
      include: { rounds: true },
    });
    const candidates = [
      {
        id: shift.id,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        roundIds: shift.rounds.map((item) => item.roundId),
      },
      ...other.map((item) => ({
        id: item.id,
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString(),
        roundIds: item.rounds.map((round) => round.roundId),
      })),
    ];
    return {
      ...shift,
      invitationPending: validation.invitationPending,
      windows: assignWindowsToShifts(ownWindows, candidates),
      uncoveredWindows: findUncoveredWindows(ownWindows, candidates),
    };
  }

  private async findConflict(
    guardId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ) {
    return this.prisma.tenantPrisma.shift.findFirst({
      where: {
        status: { not: 'cancelled' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
        assignments: {
          some: {
            guardId,
            isCurrent: true,
            active: true,
            startsAt: { lt: new Date(endsAt) },
            endsAt: { gt: new Date(startsAt) },
          },
        },
      },
      include: this.shiftInclude(),
    });
  }

  private async assertGuard(id: string) {
    const guard = await this.prisma.tenantPrisma.user.findFirst({
      where: { id, role: 'guard', status: { in: ['active', 'invitation_pending'] } },
      select: { id: true, status: true },
    });
    if (!guard) throw new NotFoundException('Vigilador no encontrado');
    return { ...guard, invitationPending: guard.status === 'invitation_pending' };
  }

  private async site(id: string) {
    const site = await this.prisma.tenantPrisma.site.findUnique({
      where: { id },
      include: { company: true, supervisors: true },
    });
    if (!site) throw new NotFoundException('Predio no encontrado');
    return site;
  }

  private shiftInclude() {
    return {
      site: { include: { company: { select: { timezone: true } } } },
      assignments: {
        where: { isCurrent: true },
        include: { guard: { select: { id: true, firstName: true, lastName: true, status: true } } },
      },
      rounds: { include: { round: { include: { currentVersion: true } } } },
    };
  }

  private async throwOverlapOrRethrow(
    error: unknown,
    guardId: string | null,
    startsAt: string,
    endsAt: string,
  ): Promise<never> {
    if (guardId && isShiftOverlapViolation(error)) {
      const conflict = await this.findConflict(guardId, startsAt, endsAt);
      throw new ConflictException({
        code: 'SHIFT_OVERLAP',
        message: 'El vigilador ya tiene un turno superpuesto',
        shift: conflict,
      });
    }
    throw error;
  }

  private async notifyGuard(
    companyId: string,
    guardId: string,
    kind:
      | 'shift_assigned'
      | 'shift_changed'
      | 'shift_removed'
      | 'shift_cancelled'
      | 'shift_reassigned_from_you'
      | 'shift_reassigned_to_you',
    shiftId: string,
    startsAt: Date,
    timezone: string,
  ) {
    const notification = buildShiftNotification({ kind, shiftId, startsAt, timezone });
    try {
      await this.notifications.notifyUsers({
        companyId,
        userIds: [guardId],
        kind,
        payload: notification.payload,
        priority: notification.priority,
      });
      this.logger.log({ event: 'shift_notification_enqueued', shiftId, guardId, kind });
    } catch (error) {
      this.logger.error({ event: 'shift_notification_failed', shiftId, guardId, kind, error });
    }
  }
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function previousDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const previous = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
}
