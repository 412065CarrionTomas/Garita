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
import { randomInt } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import {
  computeRoundWindows,
  windowsForShift,
  currentRoundProgress,
  lateStartMinutes,
  isEarlyClose,
  computeStartWindow,
  computeSyncDeadline,
  siteConnectivitySchema,
  SHIFT_AUTO_CLOSE_AFTER_MINUTES,
  SHIFT_EXECUTION_ERROR_CODES,
  startShiftResponseSchema,
  shiftOfflineDataSchema,
} from '@garita/shared';
import type { CloseShiftRequest, StartShiftRequest, ShiftOfflineData } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { clockFields, clockEventResponse } from '../server-time/clock-fields';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  SHIFT_EXECUTION_EFFECTS_PORT,
  type ShiftExecutionEffectsPort,
} from './shift-execution-effects.port';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { NOTICES_PORT, type NoticesPort } from '../../common/ports/notices.port';
import { RoundWindowStateService } from '../supervision/round-window-state.service';

export const SHIFT_AUTO_CLOSE_QUEUE = 'shift-auto-close';
export const SHIFT_AUTO_CLOSE_JOB = 'close-shift';
export const SYNC_DEADLINE_PORT = Symbol('SYNC_DEADLINE_PORT');
export interface SyncDeadlinePort {
  deadlineForSite(siteId: string, endsAt: Date): Promise<Date | null>;
  deadlineForShift(id: string): Promise<Date | null>;
}
export class NoopSyncDeadline implements SyncDeadlinePort {
  deadlineForShift(): Promise<null> {
    return Promise.resolve(null);
  }
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
    @Optional() private readonly windowStates?: RoundWindowStateService,
    @Optional() @Inject(REALTIME_PORT) private readonly realtime?: RealtimePort,
    @Optional() private readonly config?: ConfigService<Env, true>,
    @Optional() @Inject(NOTICES_PORT) private readonly notices?: NoticesPort,
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
      const current = await this.currentAssignment(id);
      if (current?.id !== replay.assignmentId)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.reassigned });
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
    const connectivity = siteConnectivitySchema.parse({
      type: shift.site.connectivityType,
      minutesToSignal: shift.site.minutesToSignal,
      marginMinutes: shift.site.marginMinutes,
    });
    const startFrom = computeStartWindow(assignment.startsAt, connectivity);
    if (now < startFrom || now > assignment.endsAt)
      throw new UnprocessableEntityException({
        code: SHIFT_EXECUTION_ERROR_CODES.outsideStartMargin,
        startFrom: startFrom.toISOString(),
        timezone: shift.site.company.timezone,
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
        const claimed = await tx.shiftAssignment.updateMany({
          where: { id: assignment.id, isCurrent: true, result: 'scheduled' },
          data: { result: 'started' },
        });
        if (claimed.count !== 1)
          throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.reassigned });
        const changed = await tx.shift.updateMany({
          where: { id, status: 'scheduled' },
          data: {
            status: 'in_progress',
            startedAt: now,
            panicSmsCode: shift.panicSmsCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0'),
            lateStartMinutes: late,
            connectivityType: connectivity.type,
            minutesToSignal: connectivity.minutesToSignal,
            marginMinutes: connectivity.marginMinutes,
            syncDeadlineAt: computeSyncDeadline(shift.endsAt, connectivity),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notStartable });
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
        await tx.shiftEvent.create({
          data: {
            companyId: shift.companyId,
            shiftId: id,
            assignmentId: assignment.id,
            type: 'start',
            deviceEventId: input.eventId,
            occurredAt: now,
            occurredAtDevice: new Date(input.occurredAtDevice),
            ...clockFields(input.clock),
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
    try {
      await this.notices?.resolve({
        companyId: shift.companyId,
        kind: 'shift_not_started',
        subjectId: assignment.id,
        resolution: 'late_start',
      });
    } catch (error) {
      this.logger.error({ event: 'shift.notice_resolution_failed', shiftId: id, error });
    }
    const data = await this.buildData(id);
    await this.windowStates?.createForShift(data);
    this.realtime?.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
      shiftId: id,
      siteId: shift.siteId,
    });
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
      serverTime: this.clock.now().toISOString(),
      status: 'in_progress',
      startedAt: now.toISOString(),
      lateStartMinutes: late,
      data,
      ...(credential ? { credential } : {}),
    });
    await this.prisma.tenantPrisma.shiftEvent.update({
      where: { deviceEventId: input.eventId },
      data: {
        response: { ...response, ...clockEventResponse(input.clock, now) } as Prisma.InputJsonValue,
      },
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

  async closeWithoutData(id: string, reason: string, user: AuthenticatedUser) {
    const shift = await this.ownedShift(id);
    if (
      user.role === 'supervisor' &&
      !(await this.prisma.tenantPrisma.siteSupervisor.findFirst({
        where: { siteId: shift.siteId, userId: user.userId },
      }))
    )
      throw new NotFoundException('Turno no encontrado');
    const now = this.clock.now();
    const notice = await this.prisma.tenantPrisma.notice.findFirst({
      where: { shiftId: id, kind: 'shift_unsynced', status: 'open' },
      select: { id: true },
    });
    if (!notice) throw new ConflictException('El turno no está sin sincronizar');
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const changed = await tx.notice.updateMany({
        where: { id: notice.id, status: 'open' },
        data: { status: 'resolved', resolution: 'closed_without_data', resolvedAt: now },
      });
      if (!changed.count) throw new ConflictException('El turno ya fue cerrado sin datos');
      await tx.shift.update({
        where: { id },
        data: {
          closedWithoutDataAt: now,
          closedWithoutDataById: user.userId,
          closedWithoutDataReason: reason,
        },
      });
      await tx.roundWindowState.updateMany({
        where: { shiftId: id, status: 'pending_sync' },
        data: { status: 'not_done' },
      });
    });
    this.realtime?.emitToSite(user.companyId, shift.siteId, 'aviso.actualizado', {
      noticeId: notice.id,
      siteId: shift.siteId,
    });
    this.realtime?.emitToSite(user.companyId, shift.siteId, 'turno.actualizado', {
      shiftId: id,
      siteId: shift.siteId,
    });
    this.logger.log({ event: 'shift.closed_without_data', shiftId: id, userId: user.userId });
    return { shiftId: id, closedWithoutDataAt: now, closedWithoutDataById: user.userId, reason };
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
      const occurredAt = new Date(input.clock?.trustedAt ?? input.occurredAtDevice);
      const receivedAt = this.clock.now();
      if (!input.clock && (occurredAt > receivedAt || occurredAt < (shift.startedAt ?? receivedAt)))
        throw new BadRequestException('La hora del cierre no es válida');
      await this.prisma.tenantPrisma.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'close',
          deviceEventId: input.eventId,
          occurredAt,
          occurredAtDevice: new Date(input.occurredAtDevice),
          ...clockFields(input.clock),
          response: clockEventResponse(input.clock, receivedAt),
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
    const occurredAt = new Date(input.clock?.trustedAt ?? input.occurredAtDevice);
    if (
      !input.clock &&
      (occurredAt < (shift.startedAt ?? assignment.startsAt) || occurredAt > receivedAt)
    )
      throw new BadRequestException('La hora del cierre no es válida');
    const early = isEarlyClose(shift.endsAt.toISOString(), occurredAt.toISOString());
    if (early && !input.reason)
      throw new BadRequestException({ code: SHIFT_EXECUTION_ERROR_CODES.earlyCloseReasonRequired });
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      // Conditional so a concurrent admin or automatic close is not overwritten.
      const changed = await tx.shift.updateMany({
        where: { id, status: 'in_progress' },
        data: {
          status: 'closed',
          closedAt: occurredAt,
          closedEarly: early,
          closeReason: input.reason,
          closedBy: 'guard',
          closedByUserId: user.userId,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notInProgress });
      await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: { result: early ? 'closed_early' : 'started' },
      });
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'close',
          deviceEventId: input.eventId,
          occurredAt,
          occurredAtDevice: new Date(input.occurredAtDevice),
          ...clockFields(input.clock),
          response: clockEventResponse(input.clock, receivedAt),
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
    this.realtime?.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
      shiftId: id,
      siteId: shift.siteId,
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
    const deadline =
      shift.syncDeadlineAt ??
      computeSyncDeadline(
        shift.endsAt,
        siteConnectivitySchema.parse({
          type: shift.connectivityType ?? 'with_signal',
          minutesToSignal: shift.minutesToSignal ?? 0,
          marginMinutes: shift.marginMinutes ?? 30,
        }),
      );
    if (deadline > this.clock.now()) return false;
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
    this.realtime?.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
      shiftId: id,
      siteId: shift.siteId,
    });
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
      const changed = await tx.shift.updateMany({
        where: { id: shift.id, status: 'in_progress' },
        data: {
          status: 'closed',
          closedAt: now,
          closedEarly: isEarlyClose(shift.endsAt.toISOString(), now.toISOString()),
          closeReason: 'baja del predio',
          closedBy: 'admin',
          closedByUserId: adminId,
        },
      });
      // The guard or the auto-close may have closed it after the read above.
      if (changed.count !== 1) continue;
      await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: {
          result: isEarlyClose(shift.endsAt.toISOString(), now.toISOString())
            ? 'closed_early'
            : 'started',
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

  async notifyGuardToLeaveAfterCommit(shiftId: string, guardId: string | null) {
    await this.effects.notifyGuardToLeave(undefined, shiftId, guardId);
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
    const closed = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const changed = await tx.shift.updateMany({
        where: { id: shift.id, status: 'in_progress' },
        data: {
          status: 'closed',
          closedAt: now,
          closedEarly: isEarlyClose(shift.endsAt.toISOString(), now.toISOString()),
          closeReason: reason,
          closedBy: 'admin',
          closedByUserId: adminId,
        },
      });
      // The guard or the auto-close may have closed it after the read above.
      if (changed.count !== 1) return false;
      await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: {
          result: isEarlyClose(shift.endsAt.toISOString(), now.toISOString())
            ? 'closed_early'
            : 'started',
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
      return true;
    });
    if (!closed) return null;
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
    this.realtime?.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
      shiftId: shift.id,
      siteId: shift.siteId,
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
    const noShows = await this.prisma.systemPrisma.shift.findMany({
      where: {
        status: 'scheduled',
        endsAt: { lte: now },
        assignments: { some: { isCurrent: true, active: true, guard: { status: 'active' } } },
      },
      select: { id: true, companyId: true, siteId: true },
    });
    let noShowCount = 0;
    for (const shift of noShows) {
      noShowCount += await this.setNoShow(shift, now);
    }
    return shifts.length + noShowCount;
  }

  async markNoShow(id: string): Promise<boolean> {
    const now = this.clock.now();
    // systemPrisma runs the idempotent no-show transition from the scheduled worker without request scope.
    this.logger.debug({ event: 'shift.no_show_system_lookup', shiftId: id });
    const shift = await this.prisma.systemPrisma.shift.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        siteId: true,
        status: true,
        endsAt: true,
        assignments: {
          where: { isCurrent: true, active: true, guard: { status: 'active' } },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (shift?.status !== 'scheduled' || shift.endsAt > now || shift.assignments.length === 0)
      return false;
    return (await this.setNoShow(shift, now)) > 0;
  }

  private async setNoShow(
    shift: { id: string; companyId: string; siteId: string },
    now: Date,
  ): Promise<number> {
    const changed = await this.prisma.systemPrisma.$transaction(async (tx) => {
      const result = await tx.shift.updateMany({
        where: {
          id: shift.id,
          status: 'scheduled',
          endsAt: { lte: now },
          assignments: { some: { isCurrent: true, active: true, guard: { status: 'active' } } },
        },
        data: { status: 'no_show' },
      });
      if (result.count)
        await tx.shiftAssignment.updateMany({
          where: { shiftId: shift.id, isCurrent: true },
          data: { active: false },
        });
      return result.count;
    });
    if (changed)
      this.realtime?.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
        shiftId: shift.id,
        siteId: shift.siteId,
      });
    return changed;
  }

  private async realCloseAfterAuto(
    id: string,
    input: CloseShiftRequest,
    user: AuthenticatedUser,
    shift: { companyId: string; startedAt: Date | null; endsAt: Date },
    assignment: { id: string },
  ) {
    const now = this.clock.now();
    const occurredAt = new Date(input.clock?.trustedAt ?? input.occurredAtDevice);
    if (!input.clock && (occurredAt < (shift.startedAt ?? occurredAt) || occurredAt > now))
      throw new BadRequestException('La hora del cierre no es válida');
    const early = isEarlyClose(shift.endsAt.toISOString(), occurredAt.toISOString());
    if (early && !input.reason)
      throw new BadRequestException({ code: SHIFT_EXECUTION_ERROR_CODES.earlyCloseReasonRequired });
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const changed = await tx.shift.updateMany({
        where: { id, status: 'auto_closed' },
        data: {
          status: 'closed',
          closedAt: occurredAt,
          closedEarly: early,
          closeReason: input.reason,
          closedBy: 'guard',
          closedByUserId: user.userId,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: SHIFT_EXECUTION_ERROR_CODES.notInProgress });
      await tx.shiftAssignment.update({
        where: { id: assignment.id },
        data: { result: early ? 'closed_early' : 'started' },
      });
      await tx.shiftEvent.create({
        data: {
          companyId: shift.companyId,
          shiftId: id,
          assignmentId: assignment.id,
          type: 'close',
          deviceEventId: input.eventId,
          occurredAt,
          occurredAtDevice: new Date(input.occurredAtDevice),
          ...clockFields(input.clock),
          response: clockEventResponse(input.clock, now),
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
    const current = await this.currentAssignment(id);
    const event = await this.prisma.tenantPrisma.shiftEvent.findFirst({
      where: { shiftId: id, assignmentId: current?.id, type: 'start' },
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
        ...(!parsed.data.shift.panicSms ? { data: await this.buildData(id) } : {}),
        serverTime: this.clock.now().toISOString(),
        credential: parsed.credential ?? credential,
      };
    }
    const data = await this.buildData(id);
    await this.windowStates?.createForShift(data);
    return startShiftResponseSchema.parse({
      serverTime: this.clock.now().toISOString(),
      status: 'in_progress' as const,
      startedAt:
        shift.startedAt?.toISOString() ??
        event?.occurredAt.toISOString() ??
        this.clock.now().toISOString(),
      lateStartMinutes: shift.lateStartMinutes,
      data,
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
    // Older running shifts acquire the code once, even when two downloads race.
    if (!shift.panicSmsCode && shift.status === 'in_progress') {
      await this.prisma.tenantPrisma.shift.updateMany({
        where: { id, panicSmsCode: null },
        data: { panicSmsCode: randomInt(0, 1_000_000).toString().padStart(6, '0') },
      });
      shift.panicSmsCode = (
        await this.prisma.tenantPrisma.shift.findUniqueOrThrow({ where: { id } })
      ).panicSmsCode;
    }
    const backup =
      this.config?.get('PANIC_SMS_DESTINATION_TYPE', { infer: true }) !== 'PLATFORM_GATEWAY';
    const phone = backup
      ? shift.site.company.guardPhone
      : this.config.get('PANIC_SMS_PLATFORM_NUMBER', { infer: true });
    const destination = typeof phone === 'string' && /^\+[1-9]\d{1,14}$/.test(phone) ? phone : null;
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
        startsAt: assignment.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        timezone: shift.site.company.timezone,
        assignmentId: assignment.id,
        syncDeadlineAt: (await this.syncDeadline.deadlineForShift(id))?.toISOString(),
        ...(shift.panicSmsCode
          ? { panicSms: { destination, shiftCode: shift.panicSmsCode, backup } }
          : {}),
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
    const siteDeadline = await this.syncDeadline.deadlineForShift(id);
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
