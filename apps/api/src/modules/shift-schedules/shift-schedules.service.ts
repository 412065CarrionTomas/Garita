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
  type ShiftScheduleInput,
  type SchedulePreview,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import type { Prisma, ShiftSchedule } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
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

  async list(query: { predio?: string; vigilador?: string }) {
    if (query.predio) await this.resources.findOwnedOrThrow('Site', query.predio);
    if (query.vigilador) await this.resources.findOwnedOrThrow('User', query.vigilador);
    const company = await this.prisma.tenantPrisma.company.findFirstOrThrow({
      select: { timezone: true },
    });
    const schedules = await this.prisma.tenantPrisma.shiftSchedule.findMany({
      where: {
        status: 'active',
        endDate: { gte: new Date(this.today(company.timezone)) },
        ...(query.predio ? { siteId: query.predio } : {}),
        ...(query.vigilador ? { guardId: query.vigilador } : {}),
      },
      orderBy: { startDate: 'asc' },
      take: 500,
    });
    return schedules.map(presentSchedule);
  }

  async preview(
    input: ShiftScheduleInput,
    user: AuthenticatedUser,
    db: Prisma.TransactionClient = this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
    excludedIds: string[] = [],
    conservedDates: string[] = [],
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
    generated = generated.filter((shift) => !conservedDates.includes(shift.serviceDate));
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
      const input = this.parse(
        {
          ...previous,
          startDate: previous.startDate < today ? today : previous.startDate,
          ...patch,
        },
        (!patch.startDate || patch.startDate === previous.startDate || patch.startDate === today) &&
          (!patch.endDate || patch.endDate === previous.endDate),
      );
      const existing = await tx.shift.findMany({
        where: { scheduleId: id },
        include: { assignments: { where: { isCurrent: true } } },
      });
      const replace = existing.filter(
        (shift) => this.mutable(shift) && !shift.individuallyModified,
      );
      const conserved = existing.filter((shift) => !replace.includes(shift));
      const preview = await this.preview(
        input,
        user,
        tx,
        replace.map((shift) => shift.id),
        this.conservedDates(conserved),
      );
      for (const shift of replace) await this.shifts.cancelInTransaction(tx, shift.id, user);
      await tx.shift.updateMany({
        where: { id: { in: replace.map((shift) => shift.id) } },
        data: { cancellationReason: 'Regeneración de programación' },
      });
      const updated = await tx.shiftSchedule.update({
        where: { id },
        data: {
          ...input,
          startDate: new Date(patch.startDate ?? previous.startDate),
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
    for (const shift of result.cancelled)
      await this.shifts.afterCancellation(shift, shift.assignments[0]?.guardId ?? null, user);
    await this.summary(result, user, result.schedule.guardId, 'updated');
    return result;
  }

  async previewEdit(id: string, input: ShiftScheduleInput, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('ShiftSchedule', id);
    const schedule = await this.prisma.tenantPrisma.shiftSchedule.findUniqueOrThrow({
      where: { id },
      include: { company: { select: { timezone: true } } },
    });
    const today = this.today(schedule.company.timezone);
    this.parse(
      input,
      input.endDate === schedule.endDate.toISOString().slice(0, 10) &&
        (input.startDate === schedule.startDate.toISOString().slice(0, 10) ||
          input.startDate === today),
    );
    const existing = await this.prisma.tenantPrisma.shift.findMany({ where: { scheduleId: id } });
    const replace = existing.filter((shift) => this.mutable(shift) && !shift.individuallyModified);
    return this.preview(
      input,
      user,
      this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
      replace.map((shift) => shift.id),
      this.conservedDates(existing.filter((shift) => !replace.includes(shift))),
    );
  }

  private conservedDates(
    shifts: { serviceDate: Date; status: string; cancellationReason: string | null }[],
  ) {
    return shifts
      .filter(
        (shift) =>
          shift.status !== 'cancelled' ||
          shift.cancellationReason !== 'Regeneración de programación',
      )
      .map((shift) => shift.serviceDate.toISOString().slice(0, 10));
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
      const existing = await tx.shift.findMany({
        where: { scheduleId: id },
        include: { assignments: { where: { isCurrent: true } } },
      });
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
