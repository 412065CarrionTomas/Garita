import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  buildShiftNotification,
  computeRoundWindows,
  findUncoveredWindows,
  generateScheduledShifts,
  scheduleDateOffset,
  shiftInputSchema,
  shiftScheduleInputSchema,
  shiftScheduleDefinitionSchema,
  SCHEDULE_EXPIRING_DAYS,
  type ScheduleListState,
  type ShiftScheduleQuery,
  type ShiftScheduleInput,
  type ShiftScheduleList,
  type SchedulePreview,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import type { Prisma, ShiftSchedule } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { SCHEDULE_REGENERATION_REASON, ShiftsService } from '../shifts/shifts.service';
import { isShiftOverlapViolation } from '../shifts/shift-overlap-error';

@Injectable()
export class ShiftSchedulesService {
  private readonly logger = new Logger(ShiftSchedulesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    private readonly shifts: ShiftsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
  ) {}

  async list(query: ShiftScheduleQuery): Promise<ShiftScheduleList> {
    if (query.predio) await this.resources.findOwnedOrThrow('Site', query.predio);
    if (query.vigilador) await this.resources.findOwnedOrThrow('User', query.vigilador);
    const company = await this.prisma.tenantPrisma.company.findFirstOrThrow({
      select: { timezone: true },
    });
    const today = this.today(company.timezone);
    const todayDate = new Date(today);
    const expiringDate = new Date(scheduleDateOffset(today, SCHEDULE_EXPIRING_DAYS));
    const current = { status: 'active' as const, endDate: { gte: todayDate } };
    const byState: Record<ScheduleListState, Prisma.ShiftScheduleWhereInput> = {
      vigente: current,
      por_vencer: { status: 'active', endDate: { gte: todayDate, lte: expiringDate } },
      finalizada: {
        OR: [{ status: 'finished' }, { status: 'active', endDate: { lt: todayDate } }],
      },
      cancelada: { status: 'cancelled' },
    };
    const words = query.q?.split(/\s+/).filter(Boolean) ?? [];
    const scope: Prisma.ShiftScheduleWhereInput = {
      ...(query.predio ? { siteId: query.predio } : {}),
      ...(query.vigilador ? { guardId: query.vigilador } : {}),
    };
    const where: Prisma.ShiftScheduleWhereInput = {
      ...scope,
      AND: [
        byState[query.estado ?? 'vigente'],
        // Cada palabra tiene que aparecer en el predio, el nombre o el apellido del vigilador.
        ...words.map((word) => {
          const search = { contains: word, mode: 'insensitive' as const };
          return {
            OR: [
              { site: { name: search } },
              { guard: { firstName: search } },
              { guard: { lastName: search } },
            ],
          };
        }),
      ],
    };
    const [schedules, total, expiring] = await Promise.all([
      this.prisma.tenantPrisma.shiftSchedule.findMany({
        where,
        include: {
          site: { select: { name: true } },
          guard: { select: { firstName: true, lastName: true } },
        },
        // El id desempata: sin él, dos con las mismas fechas pueden repetirse entre páginas.
        orderBy: [{ endDate: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
        skip: (query.pagina - 1) * query.porPagina,
        take: query.porPagina,
      }),
      this.prisma.tenantPrisma.shiftSchedule.count({ where }),
      this.prisma.tenantPrisma.shiftSchedule.count({ where: { ...scope, ...byState.por_vencer } }),
    ]);
    const page = { total, pagina: query.pagina };
    if (!schedules.length) return { items: [], ...page, expiring };
    const ids = schedules.map((schedule) => schedule.id);
    const roundIds = [...new Set(schedules.flatMap((schedule) => schedule.roundIds))];
    const live = {
      scheduleId: { in: ids },
      status: { notIn: ['cancelled', 'cancelled_by_suspension'] as const },
    } satisfies Prisma.ShiftWhereInput;
    const [upcoming, modified, rounds] = await Promise.all([
      this.prisma.tenantPrisma.shift.groupBy({
        by: ['scheduleId'],
        where: { ...live, startsAt: { gt: this.clock.now() } },
        _count: { _all: true },
      }),
      this.prisma.tenantPrisma.shift.groupBy({
        by: ['scheduleId'],
        where: { ...live, individuallyModified: true },
        _count: { _all: true },
      }),
      this.prisma.tenantPrisma.round.findMany({
        where: { id: { in: roundIds } },
        select: { id: true, name: true },
      }),
    ]);
    const countOf = (rows: { scheduleId: string | null; _count: { _all: number } }[]) =>
      new Map(rows.map((row) => [row.scheduleId, row._count._all]));
    const upcomingBy = countOf(upcoming);
    const modifiedBy = countOf(modified);
    const roundNames = new Map(rounds.map((round) => [round.id, round.name]));
    const todayMs = todayDate.getTime();
    return {
      items: schedules.map((schedule) => ({
        ...presentSchedule(schedule),
        siteName: schedule.site.name,
        guardName: `${schedule.guard.firstName} ${schedule.guard.lastName}`.trim(),
        roundNames: schedule.roundIds.flatMap((id) => roundNames.get(id) ?? []),
        daysToEnd: Math.round((schedule.endDate.getTime() - todayMs) / 86_400_000),
        upcomingCount: upcomingBy.get(schedule.id) ?? 0,
        modifiedCount: modifiedBy.get(schedule.id) ?? 0,
      })),
      ...page,
      expiring,
    };
  }

  async preview(
    input: ShiftScheduleInput,
    user: AuthenticatedUser,
    db: Prisma.TransactionClient = this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
    excludedIds: string[] = [],
    conservedDates: string[] = [],
    skipStarted = false,
  ) {
    const context = await this.shifts.loadValidation(input, user, db);
    const timezone = context.site.company.timezone;
    if (input.startDate < this.today(timezone))
      throw new BadRequestException('La fecha inicial no puede ser anterior a hoy');
    let generated;
    try {
      generated = generateScheduledShifts(input, timezone);
    } catch (error) {
      if (error instanceof RangeError) throw new BadRequestException(error.message);
      throw error;
    }
    generated = generated.filter(
      (shift) =>
        !conservedDates.includes(shift.serviceDate) &&
        // Al recortar a hoy una programación en curso, los días cuyo inicio ya pasó no se regeneran.
        (!skipStarted || Date.parse(shift.startsAt) > this.clock.now().getTime()),
    );
    const windows = new Map<
      string,
      ReturnType<typeof computeRoundWindows>[number] & { roundId: string }
    >();
    for (const shift of generated) {
      const parsed = shiftInputSchema.safeParse({ ...input, ...shift });
      if (!parsed.success) throw new BadRequestException(parsed.error.issues);
      this.shifts.validatePrepared(parsed.data, context);
      for (const round of context.rounds) {
        const version = round.currentVersion;
        if (!version) continue;
        for (const date of [scheduleDateOffset(shift.serviceDate, -1), shift.serviceDate]) {
          for (const window of computeRoundWindows(date, { ...version, timezone }))
            windows.set(`${round.id}:${window.startUtc}`, { ...window, roundId: round.id });
        }
      }
    }
    // Read through the tenant-owned guard: conflicts also include assignments at other sites.
    const guard = await db.user.findUniqueOrThrow({
      where: { id: input.guardId },
      select: {
        shiftAssignments: {
          where: {
            active: true,
            isCurrent: true,
            shiftId: { notIn: excludedIds },
            startsAt: { lt: new Date(generated.at(-1)?.endsAt ?? this.clock.now()) },
            endsAt: { gt: new Date(generated[0]?.startsAt ?? this.clock.now()) },
          },
          select: { shiftId: true, startsAt: true, endsAt: true },
        },
      },
    });
    const candidates = generated.map((shift) => ({
      ...shift,
      conflicts: guard.shiftAssignments
        .filter(
          (existing) =>
            existing.startsAt < new Date(shift.endsAt) &&
            existing.endsAt > new Date(shift.startsAt),
        )
        .map((existing) => ({
          shiftId: existing.shiftId,
          startsAt: existing.startsAt.toISOString(),
          endsAt: existing.endsAt.toISOString(),
        })),
    }));
    const ownWindows = [...windows.values()];
    const other = ownWindows.length
      ? await db.shift.findMany({
          where: {
            siteId: input.siteId,
            id: { notIn: excludedIds },
            status: {
              in: ['scheduled', 'unassigned', 'in_progress', 'closed', 'auto_closed', 'uncovered'],
            },
            startsAt: { lte: new Date(Math.max(...ownWindows.map((w) => Date.parse(w.endUtc)))) },
            endsAt: { gte: new Date(Math.min(...ownWindows.map((w) => Date.parse(w.startUtc)))) },
          },
          include: { rounds: true },
        })
      : [];
    const coverage = [
      ...candidates
        .filter((shift) => !shift.conflicts.length)
        .map((shift) => ({ ...shift, id: shift.serviceDate, roundIds: input.roundIds })),
      ...other.map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        roundIds: shift.rounds.map((round) => round.roundId),
      })),
    ];
    this.logger.log({
      action: 'schedule.previewed',
      userId: user.userId,
      generated: candidates.filter((shift) => !shift.conflicts.length).length,
      conflicts: candidates.filter((shift) => shift.conflicts.length).length,
    });
    return {
      timezone,
      invitationPending: context.guard?.status === 'invitation_pending',
      shifts: candidates,
      uncoveredWindows: findUncoveredWindows(ownWindows, coverage),
    } satisfies SchedulePreview;
  }

  async create(input: ShiftScheduleInput, user: AuthenticatedUser) {
    const result = await this.transaction(async (tx) => {
      const preview = await this.preview(input, user, tx);
      const schedule = await tx.shiftSchedule.create({
        data: {
          ...input,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          companyId: user.companyId,
          createdById: user.userId,
        },
      });
      const generated = await this.generate(tx, schedule.id, input, preview, user);
      return {
        schedule: presentSchedule(schedule),
        generated,
        replaced: [],
        conserved: [],
        conflicts: preview.shifts.filter((shift) => shift.conflicts.length),
        preview,
      };
    });
    await this.summary(result, user, input.guardId);
    return result;
  }

  async update(id: string, patch: Partial<ShiftScheduleInput>, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('ShiftSchedule', id);
    const result = await this.transaction(async (tx) => {
      const schedule = await this.lock(tx, id);
      const previous = presentSchedule(schedule);
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true } });
      const today = this.today(company.timezone);
      const inheritedStart = this.inheritedStart(patch.startDate, previous.startDate, today);
      const input = this.parse(
        {
          ...previous,
          ...patch,
          startDate: this.regenerationStart(previous.startDate, today, patch.startDate),
        },
        inheritedStart && (!patch.endDate || patch.endDate === previous.endDate),
      );
      const existing = (
        await tx.shift.findMany({
          where: { scheduleId: id },
          include: { assignments: { where: { isCurrent: true } } },
        })
      ).filter((shift) => !isRegenerated(shift));
      const started = this.startedDates(input, company.timezone);
      const replace = existing.filter(
        (shift) =>
          this.mutable(shift) &&
          !shift.individuallyModified &&
          !started.has(shift.serviceDate.toISOString().slice(0, 10)),
      );
      const conserved = existing.filter((shift) => !replace.includes(shift));
      const preview = await this.preview(
        input,
        user,
        tx,
        replace.map((shift) => shift.id),
        this.conservedDates(conserved),
        input.startDate === today,
      );
      for (const shift of replace) await this.shifts.cancelInTransaction(tx, shift.id, user);
      await tx.shift.updateMany({
        where: { id: { in: replace.map((shift) => shift.id) } },
        data: { cancellationReason: SCHEDULE_REGENERATION_REASON },
      });
      const updated = await tx.shiftSchedule.update({
        where: { id },
        data: {
          ...input,
          startDate: new Date(inheritedStart ? previous.startDate : input.startDate),
          endDate: new Date(input.endDate),
        },
      });
      const generated = await this.generate(tx, id, input, preview, user);
      return {
        schedule: presentSchedule(updated),
        generated,
        replaced: replace.map((shift) => shift.id),
        conserved: conserved.map((shift) => shift.id),
        conflicts: preview.shifts.filter((shift) => shift.conflicts.length),
        preview,
        cancelled: replace,
      };
    });
    // El vigilador de la programación recibe el resumen; solo se avisa uno a uno a quien deja de tener el turno.
    for (const shift of result.cancelled) {
      const guardId = shift.assignments[0]?.guardId ?? null;
      if (guardId !== result.schedule.guardId)
        await this.shifts.afterCancellation(shift, guardId, user);
    }
    await this.summary(result, user, result.schedule.guardId, 'updated');
    return result;
  }

  async previewEdit(id: string, input: ShiftScheduleInput, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('ShiftSchedule', id);
    const schedule = await this.prisma.tenantPrisma.shiftSchedule.findUniqueOrThrow({
      where: { id },
      include: { company: { select: { timezone: true } } },
    });
    const timezone = schedule.company.timezone;
    const today = this.today(timezone);
    const previousStart = schedule.startDate.toISOString().slice(0, 10);
    const parsed = this.parse(
      input,
      input.endDate === schedule.endDate.toISOString().slice(0, 10) &&
        this.inheritedStart(input.startDate, previousStart, today),
    );
    const regeneration = {
      ...parsed,
      startDate: this.regenerationStart(previousStart, today, input.startDate),
    };
    const existing = (
      await this.prisma.tenantPrisma.shift.findMany({ where: { scheduleId: id } })
    ).filter((shift) => !isRegenerated(shift));
    const started = this.startedDates(regeneration, timezone);
    const replace = existing.filter(
      (shift) =>
        this.mutable(shift) &&
        !shift.individuallyModified &&
        !started.has(shift.serviceDate.toISOString().slice(0, 10)),
    );
    return this.preview(
      regeneration,
      user,
      this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
      replace.map((shift) => shift.id),
      this.conservedDates(existing.filter((shift) => !replace.includes(shift))),
      regeneration.startDate === today,
    );
  }

  private conservedDates(shifts: { serviceDate: Date }[]) {
    return shifts.map((shift) => shift.serviceDate.toISOString().slice(0, 10));
  }

  /** El período aprobado se hereda si no se manda inicio, se manda el mismo, o se manda hoy en una programación ya empezada. */
  private inheritedStart(requested: string | undefined, previous: string, today: string) {
    return !requested || requested === previous || (requested === today && previous < today);
  }

  /** Inicio interno de la regeneración: nunca antes de hoy; no se guarda como inicio del período. */
  private regenerationStart(previous: string, today: string, requested?: string) {
    const start = this.inheritedStart(requested, previous, today)
      ? previous
      : (requested ?? previous);
    return start < today ? today : start;
  }

  /** Días en los que el turno, con el horario nuevo, ya habría empezado: su turno actual se conserva. */
  private startedDates(input: ShiftScheduleInput, timezone: string) {
    let generated;
    try {
      generated = generateScheduledShifts(input, timezone);
    } catch {
      return new Set<string>(); // preview() informa el error de rango.
    }
    const now = this.clock.now().getTime();
    return new Set(
      generated
        .filter((shift) => Date.parse(shift.startsAt) <= now)
        .map((shift) => shift.serviceDate),
    );
  }

  async extend(id: string, endDate: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('ShiftSchedule', id);
    const result = await this.transaction(async (tx) => {
      const schedule = await this.lock(tx, id);
      const previous = presentSchedule(schedule);
      const input = this.parse({
        ...previous,
        startDate: scheduleDateOffset(previous.endDate, 1),
        endDate,
      });
      const preview = await this.preview(input, user, tx);
      const generated = await this.generate(tx, id, input, preview, user);
      const updated = await tx.shiftSchedule.update({
        where: { id },
        data: { endDate: new Date(endDate) },
      });
      return {
        schedule: presentSchedule(updated),
        generated,
        replaced: [],
        conserved: [],
        conflicts: preview.shifts.filter((shift) => shift.conflicts.length),
        preview,
      };
    });
    await this.summary(result, user, result.schedule.guardId, 'extended');
    return result;
  }

  async cancel(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('ShiftSchedule', id);
    const result = await this.transaction(async (tx) => {
      await this.lock(tx, id);
      const existing = (
        await tx.shift.findMany({
          where: { scheduleId: id },
          include: { assignments: { where: { isCurrent: true } } },
        })
      ).filter((shift) => !isRegenerated(shift));
      const cancelled = existing.filter((shift) => this.mutable(shift));
      for (const shift of cancelled) await this.shifts.cancelInTransaction(tx, shift.id, user);
      const schedule = await tx.shiftSchedule.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      return {
        schedule: presentSchedule(schedule),
        generated: [],
        replaced: cancelled.map((shift) => shift.id),
        conserved: existing.filter((shift) => !cancelled.includes(shift)).map((shift) => shift.id),
        conflicts: [],
        cancelled,
      };
    });
    for (const shift of result.cancelled)
      await this.shifts.afterCancellation(shift, shift.assignments[0]?.guardId ?? null, user);
    this.logger.log({
      action: 'schedule.cancelled',
      userId: user.userId,
      affected: result.replaced.length,
      conserved: result.conserved.length,
    });
    return result;
  }

  private async lock(tx: Prisma.TransactionClient, id: string) {
    const locked = await tx.shiftSchedule.updateMany({
      where: { id, status: 'active' },
      data: { status: 'active' },
    });
    if (!locked.count) throw new ConflictException('La programación ya terminó o fue cancelada');
    return tx.shiftSchedule.findUniqueOrThrow({ where: { id } });
  }

  private async generate(
    tx: Prisma.TransactionClient,
    id: string,
    input: ShiftScheduleInput,
    preview: SchedulePreview,
    user: AuthenticatedUser,
  ) {
    const shifts = preview.shifts
      .filter((shift) => !shift.conflicts.length)
      .map((shift) => ({ ...shift, id: randomUUID() }));
    if (shifts.length)
      await tx.shiftSchedule.update({
        where: { id },
        data: {
          shifts: {
            create: shifts.map((shift) => ({
              id: shift.id,
              companyId: user.companyId,
              siteId: input.siteId,
              startsAt: new Date(shift.startsAt),
              endsAt: new Date(shift.endsAt),
              serviceDate: new Date(shift.serviceDate),
              createdById: user.userId,
              assignments: {
                create: {
                  guardId: input.guardId,
                  assignedById: user.userId,
                  startsAt: new Date(shift.startsAt),
                  endsAt: new Date(shift.endsAt),
                },
              },
              rounds: { create: input.roundIds.map((roundId) => ({ roundId })) },
            })),
          },
        },
      });
    return shifts.map((shift) => shift.id);
  }

  private parse(value: ShiftScheduleInput, inheritedPeriod = false) {
    const {
      id: _id,
      status: _status,
      ...input
    } = value as ShiftScheduleInput & { id?: string; status?: string };
    const parsed = (
      inheritedPeriod ? shiftScheduleDefinitionSchema : shiftScheduleInputSchema
    ).safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return parsed.data;
  }
  private mutable(shift: { status: string; startsAt: Date; startedAt: Date | null }) {
    return (
      ['scheduled', 'unassigned'].includes(shift.status) &&
      !shift.startedAt &&
      shift.startsAt > this.clock.now()
    );
  }
  private today(timezone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(this.clock.now());
  }
  private transaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.tenantPrisma
      .$transaction((tx) => action(tx as unknown as Prisma.TransactionClient), {
        isolationLevel: 'Serializable',
        timeout: 15000,
      })
      .catch((error: unknown) => {
        if (
          isShiftOverlapViolation(error) ||
          (typeof error === 'object' && error && 'code' in error && error.code === 'P2034')
        )
          throw new ConflictException({
            code: 'SCHEDULE_CHANGED',
            message: 'Los turnos cambiaron. Volvé a previsualizar antes de confirmar.',
          });
        throw error;
      });
  }
  private async summary(
    result: {
      generated: string[];
      conflicts: unknown[];
      preview: SchedulePreview;
      schedule: { id: string };
    },
    user: AuthenticatedUser,
    guardId: string,
    operation = 'created',
  ) {
    this.logger.log({
      action: 'schedule.generated',
      operation,
      scheduleId: result.schedule.id,
      userId: user.userId,
      generated: result.generated.length,
      conflicts: result.conflicts.length,
    });
    if (!result.generated.length) return;
    const accepted = result.preview.shifts.filter((shift) => !shift.conflicts.length);
    const from = accepted[0],
      to = accepted.at(-1);
    if (!from || !to) return;
    const notification = buildShiftNotification({
      kind: 'shift_schedule_summary',
      count: result.generated.length,
      from: new Date(from.startsAt),
      to: new Date(to.startsAt),
      timezone: result.preview.timezone,
    });
    try {
      await this.notifications.notifyUsers({
        companyId: user.companyId,
        userIds: [guardId],
        ...notification,
      });
    } catch (error) {
      this.logger.error({
        action: 'schedule.notification_failed',
        scheduleId: result.schedule.id,
        error,
      });
    }
  }
}

function isRegenerated(shift: { status: string; cancellationReason: string | null }) {
  return shift.status === 'cancelled' && shift.cancellationReason === SCHEDULE_REGENERATION_REASON;
}

function presentSchedule(schedule: ShiftSchedule) {
  return {
    id: schedule.id,
    siteId: schedule.siteId,
    guardId: schedule.guardId,
    weekdays: schedule.weekdays,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    roundIds: schedule.roundIds,
    startDate: schedule.startDate.toISOString().slice(0, 10),
    endDate: schedule.endDate.toISOString().slice(0, 10),
    status: schedule.status,
  };
}
