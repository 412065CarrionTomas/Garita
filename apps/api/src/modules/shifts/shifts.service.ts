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
  GUARD_SHIFTS_PAGE_SIZE,
  SHIFT_LIST_STATES,
  weekDays,
  type ShiftBoard,
  type ShiftBoardQuery,
  type ShiftListQuery,
  type ShiftListState,
  type GuardShiftsPage,
  type GuardShiftsQuery,
  type ReassignShiftRequest,
  type ShiftInput,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { suspendedVisibleShiftWhere } from '../auth/account-suspension.policy';
import { CLOCK, type Clock } from '../../common/clock';
import { isShiftOverlapViolation } from './shift-overlap-error';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { NOTICES_PORT, type NoticesPort } from '../../common/ports/notices.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';

/** Ventanas de ronda que cuentan como cumplidas en el resumen del vigilador. */
const DONE_WINDOW = new Set(['complete', 'complete_late']);

/** Motivo de los turnos reemplazados al modificar una programación (HU-32): no se listan. */
export const SCHEDULE_REGENERATION_REASON = 'Regeneración de programación';

/** Motivo de cierre por baja del predio: ese cierre anticipado no deja un hueco que cubrir. */
const SITE_REMOVAL_REASON = 'baja del predio';

/**
 * Excluye los turnos reemplazados al regenerar una programación. Se escribe con OR explícito:
 * un NOT sobre `cancellationReason` (nullable) dejaría afuera también los cancelados sin motivo.
 */
const notRegenerated: Prisma.ShiftWhereInput = {
  OR: [
    { status: { not: 'cancelled' } },
    { cancellationReason: null },
    { cancellationReason: { not: SCHEDULE_REGENERATION_REASON } },
  ],
};

/** Cerrado antes de hora y todavía en su franja: "sin cobertura", aunque en la tabla diga closed. */
function uncoveredWhere(now: Date): Prisma.ShiftWhereInput {
  return {
    status: 'closed',
    closedEarly: true,
    endsAt: { gt: now },
    OR: [{ closeReason: null }, { closeReason: { not: SITE_REMOVAL_REASON } }],
  };
}

/**
 * Estado que ve el supervisor, igual que En vivo y `reassign`: "sin cobertura" si se cerró antes
 * de hora y sigue en su franja; "no presentado" si terminó sin iniciarse, aunque el proceso que lo
 * marca todavía no haya corrido.
 */
export function effectiveShiftStatus(
  shift: { status: string; closedEarly?: boolean; closeReason?: string | null; endsAt: Date },
  now: Date,
): string {
  if (
    shift.status === 'closed' &&
    shift.closedEarly &&
    shift.closeReason !== SITE_REMOVAL_REASON &&
    now < shift.endsAt
  )
    return 'uncovered';
  if (shift.status === 'scheduled' && now >= shift.endsAt) return 'no_show';
  return shift.status;
}

function stateWhere(state: ShiftListState, now: Date): Prisma.ShiftWhereInput {
  const statuses = { status: { in: [...SHIFT_LIST_STATES[state]] } };
  // Un programado que ya terminó sin iniciarse es un no presentado: va en problema, no en programado.
  const lateNoShow = { status: 'scheduled' as const, endsAt: { lte: now } };
  if (state === 'problema') return { OR: [statuses, uncoveredWhere(now), lateNoShow] };
  if (state === 'programado') return { AND: [statuses, { endsAt: { gt: now } }] };
  if (state === 'finalizado') return { AND: [statuses, { NOT: uncoveredWhere(now) }] };
  return statuses;
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
    const now = this.clock.now();
    const words = query.q?.split(/\s+/).filter(Boolean) ?? [];
    const where: Prisma.ShiftWhereInput = {
      AND: [
        ...(query.predio ? [{ siteId: query.predio }] : []),
        ...(query.vigilador
          ? [{ assignments: { some: { guardId: query.vigilador, isCurrent: true } } }]
          : []),
        notRegenerated,
        ...(query.estado ? [stateWhere(query.estado, now)] : []),
        // Cada palabra tiene que aparecer en el predio, el nombre o el apellido del vigilador.
        ...words.map((word) => {
          const search = { contains: word, mode: 'insensitive' as const };
          return {
            OR: [
              { site: { name: search } },
              {
                assignments: {
                  some: {
                    isCurrent: true,
                    guard: { OR: [{ firstName: search }, { lastName: search }] },
                  },
                },
              },
            ],
          };
        }),
        ...(query.desde || query.hasta
          ? [
              {
                startsAt: {
                  ...(query.desde ? { gte: new Date(query.desde) } : {}),
                  ...(query.hasta ? { lte: new Date(query.hasta) } : {}),
                },
              },
            ]
          : []),
      ],
    };
    const [field, dir] = query.orden.split(':') as ['inicio' | 'predio', 'asc' | 'desc'];
    const [items, total] = await Promise.all([
      this.prisma.tenantPrisma.shift.findMany({
        where,
        include: this.shiftInclude(),
        orderBy:
          field === 'predio'
            ? [{ site: { name: dir } }, { startsAt: 'desc' }]
            : [{ startsAt: dir }, { id: 'asc' }],
        skip: (query.pagina - 1) * query.porPagina,
        take: query.porPagina,
      }),
      this.prisma.tenantPrisma.shift.count({ where }),
    ]);
    return {
      items: items.map((item) => ({ ...item, status: effectiveShiftStatus(item, now) })),
      total,
    };
  }

  /** Planilla semanal: predios × días (lunes a domingo), cada turno en el día en que empieza. */
  async board(query: ShiftBoardQuery, user: AuthenticatedUser): Promise<ShiftBoard> {
    if (query.predio) await this.resources.findOwnedOrThrow('Site', query.predio);
    if (query.vigilador) await this.assertGuard(query.vigilador);
    const { timezone } = await this.prisma.tenantPrisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { timezone: true },
    });
    const now = this.clock.now();
    const today = localDate(now, timezone);
    const days = weekDays(query.semana ?? today);
    const [shifts, sites] = await Promise.all([
      this.prisma.tenantPrisma.shift.findMany({
        where: {
          AND: [
            {
              serviceDate: {
                gte: new Date(`${days[0]}T00:00:00.000Z`),
                lte: new Date(`${days[6]}T00:00:00.000Z`),
              },
            },
            ...(query.predio ? [{ siteId: query.predio }] : []),
            ...(query.vigilador
              ? [{ assignments: { some: { guardId: query.vigilador, isCurrent: true } } }]
              : []),
            notRegenerated,
          ],
        },
        // Solo lo que muestra la planilla: sin la versión de las rondas ni su recorrido.
        select: {
          id: true,
          siteId: true,
          status: true,
          startsAt: true,
          endsAt: true,
          serviceDate: true,
          scheduleId: true,
          individuallyModified: true,
          closedEarly: true,
          closeReason: true,
          site: { select: { name: true, connectivityType: true, minutesToSignal: true } },
          assignments: {
            where: { isCurrent: true },
            select: { guard: { select: { id: true, firstName: true, lastName: true } } },
          },
          rounds: { select: { round: { select: { name: true } } } },
        },
        orderBy: { startsAt: 'asc' },
      }),
      // Con filtro de vigilador solo interesan los predios donde trabaja; sin él, también los vacíos.
      query.vigilador
        ? Promise.resolve([])
        : this.prisma.tenantPrisma.site.findMany({
            where: { status: 'active', ...(query.predio ? { id: query.predio } : {}) },
            select: { id: true, name: true },
          }),
    ]);
    const rows = new Map<string, ShiftBoard['sites'][number]>();
    const row = (id: string, name: string) => {
      let found = rows.get(id);
      if (!found) {
        found = { id, name, days: days.map(() => []) };
        rows.set(id, found);
      }
      return found;
    };
    for (const site of sites) row(site.id, site.name);
    const summary = { total: 0, sites: 0, toAssign: 0, toCover: 0, noShows: 0 };
    const busySites = new Set<string>();
    for (const shift of shifts) {
      const dayIndex = days.indexOf(shift.serviceDate.toISOString().slice(0, 10));
      if (dayIndex < 0) continue;
      const guard = shift.assignments[0]?.guard ?? null;
      const status = effectiveShiftStatus(shift, now);
      row(shift.siteId, shift.site.name).days[dayIndex]?.push({
        id: shift.id,
        status,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        guard: guard ? { id: guard.id, name: `${guard.firstName} ${guard.lastName}`.trim() } : null,
        origin: !shift.scheduleId ? 'manual' : shift.individuallyModified ? 'modified' : 'schedule',
        rounds: shift.rounds.map((item) => item.round.name),
        minutesToSignal:
          shift.site.connectivityType === 'without_signal' ? shift.site.minutesToSignal : null,
      });
      if (status.startsWith('cancelled')) continue;
      summary.total += 1;
      busySites.add(shift.siteId);
      // Mismas condiciones que acepta `reassign`: sin vigilador o sin cobertura, antes del fin.
      const open = shift.endsAt > now;
      if (status === 'unassigned' && open && shift.startsAt > now) summary.toAssign += 1;
      else if ((status === 'unassigned' || status === 'uncovered') && open) summary.toCover += 1;
      if (status === 'no_show') summary.noShows += 1;
    }
    summary.sites = busySites.size;
    return {
      timezone,
      today,
      days,
      sites: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      summary,
    };
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
      select: { guardId: true, guard: { select: { status: true } } },
    });
    if (shift.status === 'cancelled') throw new ConflictException('El turno está cancelado');
    // Un vigilador puede iniciar antes de startsAt (margen de inicio): el estado manda.
    if (shift.startsAt <= this.clock.now() || !isEditableStatus(shift.status))
      throw shiftStartedError();
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
        // Condicionado a `scheduled` para no pisar un inicio concurrente del vigilador.
        const replaced = await tx.shiftAssignment.updateMany({
          where: { shiftId: id, isCurrent: true, result: 'scheduled' },
          data: { isCurrent: false, active: false, result: 'replaced' },
        });
        if (!replaced.count) throw shiftStartedError();
        await tx.shiftRound.deleteMany({ where: { shiftId: id } });
        return tx.shift.update({
          where: { id },
          data: {
            siteId: input.siteId,
            individuallyModified: true,
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
      if (
        input.guardId &&
        (!previousAssignment?.guardId || previousAssignment.guard?.status === 'invitation_pending')
      ) {
        const guard = await this.prisma.tenantPrisma.user.findUnique({
          where: { id: input.guardId },
          select: { status: true },
        });
        if (guard?.status === 'active') {
          try {
            await this.notices.resolve({
              companyId: user.companyId,
              kind: 'shift_without_guard',
              subjectId: id,
              resolution: 'guard_assigned',
            });
          } catch (error) {
            this.logger.error({ event: 'shift.notice_resolution_failed', shiftId: id, error });
          }
        }
      }
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

  async replacements(id: string, chosenStart: string | undefined, user: AuthenticatedUser) {
    const shift = await this.get(id, user);
    const now = this.clock.now();
    const startsAt = chosenStart ? new Date(chosenStart) : now;
    if (startsAt < now || startsAt >= shift.endsAt)
      throw new BadRequestException('La hora de inicio debe estar entre ahora y el fin del turno');
    return this.prisma.tenantPrisma.user.findMany({
      where: {
        role: 'guard',
        status: 'active',
        id: { not: shift.assignments[0]?.guardId ?? undefined },
        shiftAssignments: {
          none: {
            active: true,
            isCurrent: true,
            shiftId: { not: id },
            startsAt: { lt: shift.endsAt },
            endsAt: { gt: startsAt },
          },
        },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
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
          where: {
            id: current.id,
            isCurrent: true,
            result: covering ? 'closed_early' : 'scheduled',
          },
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
            individuallyModified: true,
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
    const hadActiveGuard = Boolean(
      current.guardId && current.guard?.status !== 'invitation_pending',
    );
    try {
      await this.notices.resolve({
        companyId: user.companyId,
        kind: covering
          ? 'shift_closed_early'
          : hadActiveGuard
            ? 'shift_not_started'
            : 'shift_without_guard',
        subjectId: covering || hadActiveGuard ? current.id : id,
        resolution: covering ? 'covered' : hadActiveGuard ? 'reassigned' : 'guard_assigned',
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
    // Un vigilador puede iniciar antes de startsAt (margen de inicio): el estado manda.
    if (shift.startsAt <= this.clock.now() || !isEditableStatus(shift.status))
      throw shiftStartedError();
    const result = await this.prisma.tenantPrisma.$transaction((tx) =>
      this.cancelInTransaction(tx as unknown as Prisma.TransactionClient, id, user),
    );
    await this.afterCancellation(shift, assignment?.guardId ?? null, user);
    return result;
  }

  async cancelInTransaction(tx: Prisma.TransactionClient, id: string, user: AuthenticatedUser) {
    const current = await tx.shiftAssignment.updateMany({
      where: { shiftId: id, isCurrent: true, result: 'scheduled' },
      data: { active: false },
    });
    if (!current.count) throw shiftStartedError();
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
  }

  async afterCancellation(
    shift: { id: string; siteId: string; startsAt: Date },
    guardId: string | null,
    user: AuthenticatedUser,
  ) {
    this.logger.log({ action: 'shift.cancelled', shiftId: shift.id, userId: user.userId });
    if (guardId) {
      const timezone = (await this.site(shift.siteId)).company.timezone;
      await this.notifyGuard(
        user.companyId,
        guardId,
        'shift_cancelled',
        shift.id,
        shift.startsAt,
        timezone,
      );
    }
  }

  async mine(user: AuthenticatedUser) {
    const now = this.clock.now();
    const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return this.prisma.tenantPrisma.shift.findMany({
      where: {
        ...suspendedVisibleShiftWhere(user),
        OR: user.suspension
          ? [suspendedVisibleShiftWhere(user)]
          : [
              { status: 'in_progress' },
              { status: { in: ['scheduled', 'unassigned'] }, endsAt: { gte: now } },
            ],
        assignments: {
          some: { guardId: user.userId, isCurrent: true, active: true, startsAt: { lte: until } },
        },
      },
      include: this.shiftInclude(),
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Turnos del vigilador que tocan un rango libre de días, pasados y futuros, paginados por cursor.
   * Un turno nocturno cuenta en los dos días: el que empieza y el que termina. Los iniciados traen
   * el resumen de lo hecho en la misma consulta (sin N+1).
   */
  async mineInRange(user: AuthenticatedUser, query: GuardShiftsQuery): Promise<GuardShiftsPage> {
    // Sin `active`: las asignaciones de turnos ausentes o cancelados quedan inactivas y el
    // historial tiene que mostrarlos. Este endpoint queda bloqueado con la cuenta suspendida.
    const mine = { guardId: user.userId, isCurrent: true };
    const rows = await this.prisma.tenantPrisma.shift.findMany({
      where: {
        // Un día antes para traer el nocturno que termina en `desde`; se descarta abajo si no llega.
        serviceDate: { gte: new Date(previousDate(query.desde)), lte: new Date(query.hasta) },
        assignments: { some: mine },
        NOT: { status: 'cancelled', cancellationReason: SCHEDULE_REGENERATION_REASON },
      },
      select: {
        id: true,
        status: true,
        serviceDate: true,
        startsAt: true,
        endsAt: true,
        startedAt: true,
        closedAt: true,
        site: { select: { id: true, name: true, company: { select: { timezone: true } } } },
        rounds: {
          select: {
            roundVersionId: true,
            round: { select: { name: true, currentVersionId: true } },
          },
        },
        assignments: { where: mine, select: { startsAt: true, endsAt: true }, take: 1 },
        roundWindowStates: {
          select: {
            status: true,
            recordedCount: true,
            expectedCount: true,
            startsAt: true,
            endsAt: true,
          },
        },
        _count: { select: { incidents: { where: { guardId: user.userId } } } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: GUARD_SHIFTS_PAGE_SIZE + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, GUARD_SHIFTS_PAGE_SIZE);
    // El último día tocado es el del instante anterior al fin (un fin a las 00:00 no cuenta).
    const reaches = (shift: (typeof page)[number]) =>
      localDate(
        new Date((shift.assignments[0] ?? shift).endsAt.getTime() - 1),
        shift.site.company.timezone,
      ) >= query.desde;
    return {
      // El cursor sigue al último leído aunque se descarte, para no repetir ni saltear filas.
      items: page.filter(reaches).map(({ assignments, roundWindowStates, _count, ...shift }) => {
        const own = assignments[0] ?? shift;
        // En un turno con relevo, solo las ventanas que cayeron en la asignación del vigilador.
        const windows = roundWindowStates.filter(
          (w) => w.startsAt < own.endsAt && w.endsAt > own.startsAt,
        );
        return {
          id: shift.id,
          status: shift.status,
          serviceDate: shift.serviceDate.toISOString().slice(0, 10),
          startsAt: own.startsAt.toISOString(),
          endsAt: own.endsAt.toISOString(),
          startedAt: shift.startedAt?.toISOString() ?? null,
          closedAt: shift.closedAt?.toISOString() ?? null,
          site: {
            id: shift.site.id,
            name: shift.site.name,
            timezone: shift.site.company.timezone,
          },
          rounds: shift.rounds.map(({ round, roundVersionId }) => ({
            name: round.name,
            versionId: roundVersionId ?? round.currentVersionId,
          })),
          summary: shift.startedAt
            ? {
                windows: windows.length,
                windowsDone: windows.filter((w) => DONE_WINDOW.has(w.status)).length,
                recorded: windows.reduce((sum, w) => sum + w.recordedCount, 0),
                expected: windows.reduce((sum, w) => sum + w.expectedCount, 0),
                incidents: _count.incidents,
              }
            : null,
        };
      }),
      nextCursor: rows.length > GUARD_SHIFTS_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
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
    if (new Date(input.startsAt) <= this.clock.now())
      throw new BadRequestException({
        code: 'SHIFT_START_IN_PAST',
        message: 'El inicio no puede estar en el pasado',
      });
    const context = await this.loadValidation(input, user);
    return this.validatePrepared(input, context);
  }

  async loadValidation(
    input: Pick<ShiftInput, 'siteId' | 'guardId' | 'roundIds'>,
    user: AuthenticatedUser,
    db: Prisma.TransactionClient = this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
  ) {
    const site = await db.site.findUnique({
      where: { id: input.siteId },
      include: { company: true, supervisors: true },
    });
    if (site?.status !== 'active') throw new NotFoundException('Predio no encontrado');
    if (user.role === 'supervisor' && !site.supervisors.some((item) => item.userId === user.userId))
      throw new NotFoundException('Predio no encontrado');
    const guard = input.guardId
      ? await db.user.findFirst({
          where: {
            id: input.guardId,
            role: 'guard',
            status: { in: ['active', 'invitation_pending'] },
          },
        })
      : null;
    if (input.guardId && !guard) throw new NotFoundException('Vigilador no encontrado');
    const rounds = await db.round.findMany({
      where: { id: { in: input.roundIds }, siteId: input.siteId, status: 'active' },
      include: { currentVersion: true },
    });
    if (rounds.length !== input.roundIds.length)
      throw new NotFoundException('Una o más rondas no pertenecen al predio o están inactivas');
    return { site, guard, rounds };
  }

  validatePrepared(
    input: ShiftInput,
    { site, guard, rounds }: Awaited<ReturnType<ShiftsService['loadValidation']>>,
  ) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt <= this.clock.now())
      throw new BadRequestException({
        code: 'SHIFT_START_IN_PAST',
        message: 'El inicio no puede estar en el pasado',
      });
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
    return { invitationPending: guard?.status === 'invitation_pending' };
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
    // Only shifts touching this shift's windows can cover them; the site history is unbounded.
    const windowStarts = ownWindows.map((window) => Date.parse(window.startUtc));
    const windowEnds = ownWindows.map((window) => Date.parse(window.endUtc));
    const other = ownWindows.length
      ? await this.prisma.tenantPrisma.shift.findMany({
          where: {
            siteId: shift.siteId,
            status: { not: 'cancelled' },
            id: { not: shift.id },
            startsAt: { lte: new Date(Math.max(...windowEnds)) },
            endsAt: { gte: new Date(Math.min(...windowStarts)) },
          },
          include: { rounds: true },
        })
      : [];
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
    const notification = buildShiftNotification({
      kind,
      shiftId,
      startsAt,
      timezone,
      now: this.clock.now(),
    });
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

function isEditableStatus(status: string): boolean {
  return status === 'scheduled' || status === 'unassigned';
}

function shiftStartedError(): ConflictException {
  return new ConflictException({
    code: 'SHIFT_STARTED',
    message: 'Solo se puede reasignar el turno',
  });
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
