import {
  ConflictException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  assignWindowsToShifts,
  computeRoundWindows,
  findUncoveredWindows,
  windowsForShift,
  type ShiftInput,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CLOCK, type Clock } from '../../common/clock';

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
    const serviceDate = localDate(
      new Date(input.startsAt),
      (await this.site(input.siteId)).company.timezone,
    );
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
      return await this.withWarnings(shift, validation);
    } catch (error) {
      await this.throwOverlapOrRethrow(error, input.guardId, input.startsAt, input.endsAt);
    }
  }

  async update(id: string, input: ShiftInput, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Shift', id);
    const shift = await this.prisma.tenantPrisma.shift.findUniqueOrThrow({ where: { id } });
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
    const serviceDate = localDate(
      new Date(input.startsAt),
      (await this.site(input.siteId)).company.timezone,
    );
    try {
      const updated = await this.prisma.tenantPrisma.$transaction(async (tx) => {
        await tx.shiftAssignment.updateMany({
          where: { shiftId: id, isCurrent: true },
          data: { isCurrent: false, active: false },
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
      return await this.withWarnings(updated, validation);
    } catch (error) {
      await this.throwOverlapOrRethrow(error, input.guardId, input.startsAt, input.endsAt);
    }
  }

  async cancel(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Shift', id);
    const shift = await this.prisma.tenantPrisma.shift.findUniqueOrThrow({ where: { id } });
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
    return result;
  }

  async mine(user: AuthenticatedUser) {
    const now = this.clock.now();
    const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return this.prisma.tenantPrisma.shift.findMany({
      where: {
        status: { in: ['scheduled', 'unassigned'] },
        startsAt: { gte: now, lte: until },
        assignments: { some: { guardId: user.userId, isCurrent: true } },
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
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2004' &&
      guardId
    ) {
      const conflict = await this.findConflict(guardId, startsAt, endsAt);
      throw new ConflictException({
        code: 'SHIFT_OVERLAP',
        message: 'El vigilador ya tiene un turno superpuesto',
        shift: conflict,
      });
    }
    throw error;
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
