import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import { ShiftCredentialService } from '../sync/shift-credential.service';
import { Prisma } from '../../generated/prisma/client';
import {
  computeRoundWindows,
  windowsForShift,
  currentRoundProgress,
  lateStartMinutes,
  isEarlyClose,
  isWithinStartMargin,
  SHIFT_AUTO_CLOSE_AFTER_MINUTES,
  SHIFT_EXECUTION_ERROR_CODES,
  startShiftResponseSchema,
  shiftOfflineDataSchema,
} from '@garita/shared';
import type { CloseShiftRequest, StartShiftRequest, ShiftOfflineData } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  SHIFT_EXECUTION_EFFECTS_PORT,
  type ShiftExecutionEffectsPort,
} from './shift-execution-effects.port';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

export const SHIFT_AUTO_CLOSE_QUEUE = 'shift-auto-close';
export const SHIFT_AUTO_CLOSE_JOB = 'close-shift';
export const SYNC_DEADLINE_PORT = Symbol('SYNC_DEADLINE_PORT');
export interface SyncDeadlinePort {
  deadlineForSite(siteId: string, endsAt: Date): Promise<Date | null>;
}
export class NoopSyncDeadline implements SyncDeadlinePort {
  deadlineForSite(): Promise<null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class ShiftExecutionService {
  private readonly logger = new Logger(ShiftExecutionService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectQueue(SHIFT_AUTO_CLOSE_QUEUE) private readonly queue: Queue,
    @Inject(SYNC_DEADLINE_PORT) private readonly syncDeadline: SyncDeadlinePort,
    @Inject(SHIFT_EXECUTION_EFFECTS_PORT)
    private readonly effects: ShiftExecutionEffectsPort,
    @Optional()
    @Inject(forwardRef(() => ShiftCredentialService))
    private readonly shiftCredentialService?: ShiftCredentialService,
  ) {}

  async start(id: string, input: StartShiftRequest, user: AuthenticatedUser) {
    const replay = await this.prisma.tenantPrisma.shiftEvent.findUnique({
      where: { deviceEventId: input.eventId },
      include: { shift: true },
    });
    if (replay) {
      if (replay.shiftId !== id)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
      await this.assertCurrentGuard(id, user);
      return this.startResponse(replay.shift.id);
    }
    const shift = await this.ownedShift(id);
    if (shift.status === 'cancelled' || shift.status === 'closed' || shift.status === 'auto_closed')
      throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
    const assignment = await this.currentAssignment(shift.id);
    if (assignment?.guardId !== user.userId) {
      const previousAssignment = await this.prisma.tenantPrisma.shiftAssignment.findFirst({
        where: { shiftId: id, guardId: user.userId },
      });
      if (previousAssignment)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.reassigned });
      throw new ForbiddenException('No podés iniciar un turno ajeno');
    }
    if (shift.status === 'in_progress')
      throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
    const guard = await this.prisma.tenantPrisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    if (guard.status === 'invitation_pending')
      throw new ForbiddenException({ code: SHIFT_EXECUTION_ERROR_CODES.invitationPending });
    const now = this.clock.now();
    if (
      !isWithinStartMargin(
        assignment.startsAt.toISOString(),
        assignment.endsAt.toISOString(),
        now.toISOString(),
      )
    )
      throw new UnprocessableEntityException({
        code: SHIFT_EXECUTION_ERROR_CODES.outsideStartMargin,
      });
    const another = await this.prisma.tenantPrisma.shift.findFirst({
      where: {
        id: { not: id },
        status: 'in_progress',
        assignments: { some: { guardId: user.userId, isCurrent: true, active: true } },
      },
    });
    if (another)
      throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.anotherInProgress });
    const late = lateStartMinutes(assignment.startsAt.toISOString(), now.toISOString());
    try {
      await this.prisma.tenantPrisma.$transaction(async (tx) => {
        const rounds = await tx.shiftRound.findMany({
          where: { shiftId: id },
          include: { round: { select: { currentVersionId: true } } },
        });
        for (const round of rounds) {
          if (!round.round.currentVersionId)
            throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
          await tx.shiftRound.update({
            where: { shiftId_roundId: { shiftId: id, roundId: round.roundId } },
            data: { roundVersionId: round.round.currentVersionId },
          });
        }
        await tx.shift.update({
          where: { id },
          data: { status: 'in_progress', startedAt: now, lateStartMinutes: late },
        });
        await tx.shiftEvent.create({
          data: {
            companyId: shift.companyId,
            shiftId: id,
            assignmentId: assignment.id,
            type: 'start',
            deviceEventId: input.eventId,
            occurredAt: now,
            occurredAtDevice: new Date(input.occurredAtDevice),
            receivedAt: now,
            locationStatus: input.location.status,
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            accuracyMeters: input.location.accuracyMeters,
            simulation: input.location.simulation,
            actorUserId: user.userId,
            lateStartMinutes: late,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return this.startResponse(id);
      throw error;
    }
    const data = await this.buildData(id);
    let credential: { token: string; expiresAt: string } | undefined;
    if (this.shiftCredentialService) {
      credential = await this.shiftCredentialService.issueCredential({
        shiftId: id,
        assignmentId: assignment.id,
        userId: user.userId,
        companyId: shift.companyId,
        scheduledEnd: shift.endsAt,
      });
    }
    const response = startShiftResponseSchema.parse({
      status: 'in_progress',
      startedAt: now.toISOString(),
      lateStartMinutes: late,
      data,
      ...(credential ? { credential } : {}),
    });
    await this.prisma.tenantPrisma.shiftEvent.update({
      where: { deviceEventId: input.eventId },
      data: { response: response as Prisma.InputJsonValue },
    });
    await this.scheduleAutoCloseSafely(id, shift.siteId, shift.endsAt);
    this.logger.log({
      event: 'shift.started',
      shiftId: id,
      guardId: user.userId,
      result: 'in_progress',
      lateStartMinutes: late,
    });
    return response;
  }

  async data(id: string, user: AuthenticatedUser) {
    const shift = await this.ownedShift(id);
    if (user.role === 'guard') await this.assertCurrentGuard(shift.id, user);
    if (
      user.role === 'supervisor' &&
      !(await this.prisma.tenantPrisma.siteSupervisor.findFirst({
        where: { siteId: shift.siteId, userId: user.userId },
      }))
    )
      throw new NotFoundException('Turno no encontrado');
    if (shift.status !== 'in_progress')
      throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
    return this.buildData(id);
  }

  async state(id: string, user: AuthenticatedUser) {
    const data = await this.data(id, user);
    const shift = await this.prisma.tenantPrisma.shift.findFirstOrThrow({ where: { id } });
    const records = await this.prisma.tenantPrisma.checkpointRecord.findMany({
      where: { shiftId: id, countsForCompliance: true },
      select: { checkpointId: true, countedFor: true },
    });
    const recordedMap = new Map<string, Set<string>>();
    for (const record of records) {
      const countedList = Array.isArray(record.countedFor)
        ? (record.countedFor as { roundId: string; windowIndex: number }[])
        : [];
      for (const item of countedList) {
        if (typeof item.roundId === 'string' && typeof item.windowIndex === 'number') {
          const key = `${item.roundId}:${item.windowIndex}`;
          let set = recordedMap.get(key);
          if (!set) {
            set = new Set<string>();
            recordedMap.set(key, set);
          }
          set.add(record.checkpointId);
        }
      }
    }
    return {
      status: shift.status,
      rounds: currentRoundProgress(data, this.clock.now().toISOString(), recordedMap),
    };
  }

  async getShiftOfflineData(id: string): Promise<ShiftOfflineData> {
    return this.buildData(id);
  }

  async close(id: string, input: CloseShiftRequest, user: AuthenticatedUser) {
    const replay = await this.prisma.tenantPrisma.shiftEvent.findUnique({
      where: { deviceEventId: input.eventId },
      include: { shift: true },
    });
    if (replay) {
      if (replay.shiftId !== id)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notInProgress });
      await this.assertCurrentGuard(id, user);
      return {
        status: 'closed' as const,
        closedAt: replay.shift.closedAt?.toISOString() ?? replay.occurredAt.toISOString(),
        closedEarly: replay.shift.closedEarly,
      };
    }
    const shift = await this.ownedShift(id);
    const assignment = await this.currentAssignment(id);
    if (assignment?.guardId !== user.userId) {
      const previousAssignment = await this.prisma.tenantPrisma.shiftAssignment.findFirst({
        where: { shiftId: id, guardId: user.userId },
      });
      if (previousAssignment)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.reassigned });
      throw new ForbiddenException('Turno no encontrado');
    }
    if (shift.status === 'closed' && shift.closedBy === 'admin') {
      const occurredAt = new Date(input.occurredAtDevice);
      const receivedAt = this.clock.now();
      if (occurredAt > receivedAt || occurredAt < (shift.startedAt ?? receivedAt))
        throw new BadRequestException('La hora del cierre no es válida');
      await this.prisma.tenantPrisma.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'close',
          deviceEventId: input.eventId,
          occurredAt,
          occurredAtDevice: occurredAt,
          receivedAt,
          locationStatus: input.location.status,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          simulation: input.location.simulation,
          reason: input.reason,
          actorUserId: user.userId,
          countsForCompliance: occurredAt <= (shift.closedAt ?? receivedAt),
        },
      });
      return {
        status: 'closed' as const,
        closedAt: (shift.closedAt ?? receivedAt).toISOString(),
        closedEarly: shift.closedEarly,
      };
    }
    if (shift.status === 'auto_closed')
      return this.realCloseAfterAuto(id, input, user, shift, assignment);
    if (shift.status !== 'in_progress')
      throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notInProgress });
    const receivedAt = this.clock.now();
    const occurredAt = new Date(input.occurredAtDevice);
    if (occurredAt < (shift.startedAt ?? assignment.startsAt) || occurredAt > receivedAt)
      throw new BadRequestException('La hora del cierre no es válida');
    const early = isEarlyClose(shift.endsAt.toISOString(), occurredAt.toISOString());
    if (early && !input.reason)
      throw new BadRequestException({ code: SHIFT_EXECUTION_ERROR_CODES.earlyCloseReasonRequired });
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.shift.update({
        where: { id },
        data: {
          status: 'closed',
          closedAt: occurredAt,
          closedEarly: early,
          closeReason: input.reason,
          closedBy: 'guard',
          closedByUserId: user.userId,
        },
      });
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'close',
          deviceEventId: input.eventId,
          occurredAt,
          occurredAtDevice: occurredAt,
          receivedAt,
          locationStatus: input.location.status,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          simulation: input.location.simulation,
          reason: input.reason,
          actorUserId: user.userId,
        },
      });
    });
    if (early) {
      await this.effects.notifyEarlyClose(id, user.userId, input.reason ?? null);
      await this.effects.offerCoverage(id, user.userId);
    }
    this.logger.log({
      event: 'shift.closed',
      shiftId: id,
      guardId: user.userId,
      result: 'closed',
      closedEarly: early,
    });
    return { status: 'closed' as const, closedAt: occurredAt.toISOString(), closedEarly: early };
  }

  async autoClose(id: string) {
    // BullMQ workers have no authenticated request context; this is a system operation keyed by shift id.
    this.logger.debug({ event: 'shift.auto_close_system_query', shiftId: id });
    const shift = await this.prisma.systemPrisma.shift.findUnique({
      where: { id },
      include: { assignments: { where: { isCurrent: true, active: true }, take: 1 } },
    });
    if (
      shift?.status !== 'in_progress' ||
      shift.endsAt.getTime() + SHIFT_AUTO_CLOSE_AFTER_MINUTES * 60_000 > this.clock.now().getTime()
    )
      return false;
    const deadline = await this.syncDeadline.deadlineForSite(shift.siteId, shift.endsAt);
    if (deadline && deadline > this.clock.now()) return false;
    const assignment = shift.assignments[0];
    if (!assignment) return false;
    const now = this.clock.now();
    const changed = await this.prisma.systemPrisma.$transaction(async (tx) => {
      const result = await tx.shift.updateMany({
        where: { id, status: 'in_progress' },
        data: { status: 'auto_closed', autoClosedAt: now, closedAt: now, closedBy: 'system' },
      });
      if (!result.count) return false;
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'auto_close',
          occurredAt: now,
          receivedAt: now,
          actorUserId: null,
        },
      });
      return true;
    });
    if (!changed) return false;
    this.logger.log({
      event: 'shift.auto_closed',
      shiftId: id,
      guardId: assignment.guardId,
      result: 'auto_closed',
    });
    return true;
  }

  async closeForSites(transaction: unknown, siteIds: string[], adminId: string) {
    const tx = transaction as Prisma.TransactionClient;
    const now = this.clock.now();
    const shifts = await tx.shift.findMany({
      where: { siteId: { in: siteIds }, status: 'in_progress' },
      include: { assignments: { where: { isCurrent: true }, take: 1 } },
    });
    for (const shift of shifts) {
      const assignment = shift.assignments[0];
      if (!assignment) continue;
      await tx.shift.update({
        where: { id: shift.id },
        data: {
          status: 'closed',
          closedAt: now,
          closedEarly: isEarlyClose(shift.endsAt.toISOString(), now.toISOString()),
          closeReason: 'baja del predio',
          closedBy: 'admin',
          closedByUserId: adminId,
        },
      });
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: shift.id,
          assignmentId: assignment.id,
          type: 'admin_close',
          occurredAt: now,
          receivedAt: now,
          reason: 'baja del predio',
          actorUserId: adminId,
        },
      });
      // HU-45 must enqueue notification/SMS through a transaction-aware outbox.
      await this.effects.notifyGuardToLeave(tx, shift.id, assignment.guardId);
      this.logger.log({
        event: 'shift.admin_closed',
        shiftId: shift.id,
        guardId: assignment.guardId,
        adminId,
        reason: 'baja del predio',
        result: 'closed',
      });
    }
  }

  async closeForGuard(id: string, adminId: string, reason: string) {
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: {
        status: 'in_progress',
        assignments: { some: { guardId: id, isCurrent: true, active: true } },
      },
      include: { assignments: { where: { guardId: id, isCurrent: true, active: true }, take: 1 } },
    });
    if (!shift) return null;
    const assignment = shift.assignments[0];
    if (!assignment) return null;
    const now = this.clock.now();
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.shift.update({
        where: { id: shift.id },
        data: {
          status: 'closed',
          closedAt: now,
          closedEarly: isEarlyClose(shift.endsAt.toISOString(), now.toISOString()),
          closeReason: reason,
          closedBy: 'admin',
          closedByUserId: adminId,
        },
      });
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: shift.id,
          assignmentId: assignment.id,
          type: 'admin_close',
          occurredAt: now,
          receivedAt: now,
          reason,
          actorUserId: adminId,
        },
      });
    });
    if (isEarlyClose(shift.endsAt.toISOString(), now.toISOString())) {
      await this.effects.notifyEarlyClose(shift.id, id, reason);
      await this.effects.offerCoverage(shift.id, id);
    }
    this.logger.log({
      event: 'shift.admin_closed',
      shiftId: shift.id,
      guardId: id,
      adminId,
      reason,
      result: 'closed',
    });
    return shift.id;
  }

  async findInProgressForGuard(id: string): Promise<string | null> {
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: {
        status: 'in_progress',
        assignments: { some: { guardId: id, isCurrent: true, active: true } },
      },
      select: { id: true },
    });
    return shift?.id ?? null;
  }

  async closeExpired() {
    const now = this.clock.now();
    // The periodic worker is outside request scope and must scan across tenants.
    this.logger.debug({ event: 'shift.sweep_system_query' });
    const shifts = await this.prisma.systemPrisma.shift.findMany({
      where: {
        status: 'in_progress',
        endsAt: { lte: new Date(now.getTime() - SHIFT_AUTO_CLOSE_AFTER_MINUTES * 60_000) },
      },
      select: { id: true },
    });
    for (const shift of shifts) await this.autoClose(shift.id);
    return shifts.length;
  }

  private async realCloseAfterAuto(
    id: string,
    input: CloseShiftRequest,
    user: AuthenticatedUser,
    shift: { companyId: string; startedAt: Date | null; endsAt: Date },
    assignment: { id: string },
  ) {
    const now = this.clock.now();
    const occurredAt = new Date(input.occurredAtDevice);
    if (occurredAt < (shift.startedAt ?? occurredAt) || occurredAt > now)
      throw new BadRequestException('La hora del cierre no es válida');
    const early = isEarlyClose(shift.endsAt.toISOString(), occurredAt.toISOString());
    if (early && !input.reason)
      throw new BadRequestException({ code: SHIFT_EXECUTION_ERROR_CODES.earlyCloseReasonRequired });
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.shift.update({
        where: { id },
        data: {
          status: 'closed',
          closedAt: occurredAt,
          closedEarly: early,
          closeReason: input.reason,
          closedBy: 'guard',
          closedByUserId: user.userId,
        },
      });
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'close',
          deviceEventId: input.eventId,
          occurredAt,
          occurredAtDevice: occurredAt,
          receivedAt: now,
          locationStatus: input.location.status,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          simulation: input.location.simulation,
          reason: input.reason,
          actorUserId: user.userId,
        },
      });
    });
    if (early) {
      await this.effects.notifyEarlyClose(id, user.userId, input.reason ?? null);
      await this.effects.offerCoverage(id, user.userId);
    }
    return { status: 'closed' as const, closedAt: occurredAt.toISOString(), closedEarly: early };
  }

  private async startResponse(id: string) {
    const shift = await this.prisma.tenantPrisma.shift.findFirstOrThrow({ where: { id } });
    const event = await this.prisma.tenantPrisma.shiftEvent.findFirst({
      where: { shiftId: id, type: 'start' },
      orderBy: { receivedAt: 'asc' },
    });
    let credential: { token: string; expiresAt: string } | undefined;
    if (this.shiftCredentialService) {
      const assignment = await this.currentAssignment(id);
      if (assignment?.guardId) {
        credential = await this.shiftCredentialService.issueCredential({
          shiftId: id,
          assignmentId: assignment.id,
          userId: assignment.guardId,
          companyId: shift.companyId,
          scheduledEnd: shift.endsAt,
        });
      }
    }
    if (event?.response) {
      const parsed = startShiftResponseSchema.parse(event.response);
      return {
        ...parsed,
        credential: parsed.credential ?? credential,
      };
    }
    return startShiftResponseSchema.parse({
      status: 'in_progress' as const,
      startedAt:
        shift.startedAt?.toISOString() ??
        event?.occurredAt.toISOString() ??
        this.clock.now().toISOString(),
      lateStartMinutes: shift.lateStartMinutes,
      data: await this.buildData(id),
      ...(credential ? { credential } : {}),
    });
  }
  private async ownedShift(id: string) {
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: { id },
      include: { site: { include: { company: { select: { timezone: true } } } } },
    });
    if (!shift) throw new NotFoundException('Turno no encontrado');
    return shift;
  }
  private async currentAssignment(id: string) {
    return this.prisma.tenantPrisma.shiftAssignment.findFirst({
      where: { shiftId: id, isCurrent: true, active: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  private async assertCurrentGuard(id: string, user: AuthenticatedUser) {
    if (
      !(await this.prisma.tenantPrisma.shiftAssignment.findFirst({
        where: { shiftId: id, guardId: user.userId, isCurrent: true, active: true },
      }))
    )
      throw new ForbiddenException('Turno no encontrado');
  }
  private async buildData(id: string): Promise<ShiftOfflineData> {
    const shift = await this.prisma.tenantPrisma.shift.findFirstOrThrow({
      where: { id },
      include: {
        site: { include: { company: true } },
        assignments: { where: { isCurrent: true }, take: 1 },
        rounds: { include: { roundVersion: true, round: true } },
      },
    });
    const assignment = shift.assignments[0];
    if (!assignment)
      throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
    const rounds = await Promise.all(
      shift.rounds.map(async ({ roundId, roundVersion, round }) => {
        if (!roundVersion) return null;
        const entries = await this.prisma.tenantPrisma.roundVersionCheckpoint.findMany({
          where: { roundVersionId: roundVersion.id },
          orderBy: { position: 'asc' },
          select: { checkpointId: true },
        });
        return {
          roundId,
          roundVersionId: roundVersion.id,
          name: round.name,
          frequencyMinutes: roundVersion.frequencyMinutes,
          windowStartLocal: roundVersion.windowStartLocal,
          windowEndLocal: roundVersion.windowEndLocal,
          graceMinutes: roundVersion.graceMinutes,
          checkpointIds: entries.map(({ checkpointId }) => checkpointId),
          version: roundVersion,
        };
      }),
    ).then((values) =>
      values.filter((value): value is NonNullable<typeof value> => value !== null),
    );
    const startDate = shift.serviceDate.toISOString().slice(0, 10);
    const previous = new Date(`${startDate}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const previousDate = previous.toISOString().slice(0, 10);
    const windows = rounds.flatMap(({ roundId, version }) =>
      [previousDate, startDate].flatMap((date) =>
        computeRoundWindows(date, {
          windowStartLocal: version.windowStartLocal,
          windowEndLocal: version.windowEndLocal,
          frequencyMinutes: version.frequencyMinutes,
          timezone: shift.site.company.timezone,
        }).map((window) => ({ ...window, roundId })),
      ),
    );
    const selected = rounds.flatMap(({ roundId }) =>
      windowsForShift(
        windows.filter((window) => window.roundId === roundId),
        { shiftStartUtc: shift.startsAt.toISOString(), shiftEndUtc: shift.endsAt.toISOString() },
      ).endingInShift.map((window) => ({ roundId, ...window })),
    );
    const checkpointIds = [...new Set(rounds.flatMap(({ checkpointIds: ids }) => ids))];
    const checkpoints = await this.prisma.tenantPrisma.checkpoint.findMany({
      where: { id: { in: checkpointIds }, status: 'active' },
      include: { nfcTags: { where: { status: 'active' }, take: 1 } },
    });
    const result = shiftOfflineDataSchema.parse({
      shift: {
        id,
        siteId: shift.siteId,
        siteName: shift.site.name,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        timezone: shift.site.company.timezone,
        assignmentId: assignment.id,
      },
      rounds: rounds.map(({ version: _version, ...round }) => round),
      windows: selected.map(({ roundId, startUtc, endUtc, label }) => ({
        roundId,
        index: windowsForShift(
          windows.filter((window) => window.roundId === roundId),
          { shiftStartUtc: shift.startsAt.toISOString(), shiftEndUtc: shift.endsAt.toISOString() },
        ).endingInShift.findIndex((window) => window.startUtc === startUtc),
        startUtc,
        endUtc,
        label,
      })),
      checkpoints: checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        name: checkpoint.name,
        qrVersion: checkpoint.qrVersion,
        nfcUid: checkpoint.nfcTags[0]?.uid ?? null,
        isIndoor: checkpoint.isIndoor,
      })),
      serverTime: { serverNowUtc: this.clock.now().toISOString() },
    });
    return result;
  }
  /**
   * The shift is already in progress in the database when this runs. If Redis is unreachable, the
   * periodic sweep (every 60 s) still auto-closes the shift, so a scheduling failure is logged and
   * never turns the guard's start into a 500.
   */
  async scheduleAutoCloseSafely(id: string, siteId: string, endsAt: Date): Promise<boolean> {
    try {
      await this.scheduleAutoClose(id, siteId, endsAt);
      return true;
    } catch (error) {
      this.logger.warn({
        event: 'shift.auto_close_schedule_failed',
        shiftId: id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return false;
    }
  }

  private async scheduleAutoClose(id: string, siteId: string, endsAt: Date) {
    const defaultTime = endsAt.getTime() + SHIFT_AUTO_CLOSE_AFTER_MINUTES * 60_000;
    const siteDeadline = await this.syncDeadline.deadlineForSite(siteId, endsAt);
    const delay = Math.max(
      0,
      Math.max(defaultTime, siteDeadline?.getTime() ?? defaultTime) - this.clock.now().getTime(),
    );
    await this.queue.add(
      SHIFT_AUTO_CLOSE_JOB,
      { shiftId: id },
      { jobId: `shift-auto-close-${id}`, delay },
    );
  }
}
