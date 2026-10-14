import * as crypto from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CHECKPOINT_RECORD_ERROR_CODES,
  checkpointRecordResponseSchema,
  imputeRecord,
  normalizeNfcUid,
  type CheckpointRecordRequest,
  type CheckpointRecordResponse,
  type ImputedCountedWindow,
  type InvalidScanReason,
} from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { QrService } from '../checkpoints/qr.service';
import { ShiftExecutionService } from '../shift-execution/shift-execution.service';
import { MarcasService } from '../marcas/marcas.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export function computeRequestHash(request: CheckpointRecordRequest): string {
  const canonical = {
    recordId: request.recordId,
    shiftId: request.shiftId,
    method: request.method,
    scannedValue: request.scannedValue,
    occurredAtDevice: request.occurredAtDevice,
    location: {
      status: request.location.status,
      latitude: request.location.latitude,
      longitude: request.location.longitude,
      accuracyMeters: request.location.accuracyMeters,
      simulation: request.location.simulation,
      takenAt: request.location.takenAt,
    },
    phoneNfc: request.phoneNfc,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

@Injectable()
export class CheckpointRecordsService {
  private readonly logger = new Logger(CheckpointRecordsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly qrService: QrService,
    private readonly shiftExecution: ShiftExecutionService,
    private readonly marcas: MarcasService,
  ) {}

  async processRecord(
    input: CheckpointRecordRequest,
    user: AuthenticatedUser,
  ): Promise<CheckpointRecordResponse> {
    const requestHash = computeRequestHash(input);

    // 1. Idempotency check across records and invalid scan attempts
    const existingRecord = await this.prisma.tenantPrisma.checkpointRecord.findUnique({
      where: { recordId: input.recordId },
    });
    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) {
        throw new ConflictException({ code: CHECKPOINT_RECORD_ERROR_CODES.recordIdConflict });
      }
      return checkpointRecordResponseSchema.parse({
        result: 'recorded',
        recordId: existingRecord.recordId,
        checkpointId: existingRecord.checkpointId,
        countedFor: existingRecord.countedFor as unknown as ImputedCountedWindow[],
        outOfWindow: existingRecord.outOfWindow,
      });
    }

    const existingAttempt = await this.prisma.tenantPrisma.invalidScanAttempt.findUnique({
      where: { recordId: input.recordId },
    });
    if (existingAttempt) {
      if (existingAttempt.requestHash !== requestHash) {
        throw new ConflictException({ code: CHECKPOINT_RECORD_ERROR_CODES.recordIdConflict });
      }
      return checkpointRecordResponseSchema.parse({
        result: 'rejected',
        recordId: existingAttempt.recordId,
        reason: existingAttempt.reason,
      });
    }

    // 2. Shift and assignment validation
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: { id: input.shiftId },
      include: {
        assignments: {
          where: { isCurrent: true, active: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!shift) {
      throw new NotFoundException('Turno no encontrado');
    }

    const assignment = shift.assignments[0];
    const isGuardAssigned = assignment?.guardId === user.userId;
    const isShiftInProgress = shift.status === 'in_progress';
    const isClosedByAdmin = shift.status === 'closed' && shift.closedBy === 'admin';

    if (!isGuardAssigned || (!isShiftInProgress && !isClosedByAdmin)) {
      throw new ConflictException({ code: CHECKPOINT_RECORD_ERROR_CODES.shiftNotInProgress });
    }

    const occurredAt = new Date(input.occurredAtDevice);
    const receivedAt = this.clock.now();

    // Counts for compliance is false if the event occurred after an administrative close
    const countsForCompliance = isClosedByAdmin
      ? occurredAt <= (shift.closedAt ?? receivedAt)
      : true;

    // 3. Scan verification (QR / NFC)
    let checkpointId: string | null = null;
    let invalidReason: InvalidScanReason | null = null;

    if (input.method === 'qr') {
      const qrResult = await this.qrService.verifyQrPayload(input.scannedValue);
      if (!qrResult.valid) {
        switch (qrResult.reason) {
          case 'malformed':
            invalidReason = 'malformed';
            break;
          case 'signature':
            invalidReason = 'signature';
            break;
          case 'outdated':
            invalidReason = 'outdated_version';
            break;
          case 'not_found':
            invalidReason = 'unknown_checkpoint';
            break;
        }
      } else {
        if (qrResult.checkpoint.siteId !== shift.siteId) {
          invalidReason = 'other_site';
        } else {
          checkpointId = qrResult.checkpoint.id;
        }
      }
    } else {
      const normalizedUid = normalizeNfcUid(input.scannedValue);
      const tag = await this.prisma.tenantPrisma.nfcTag.findFirst({
        where: { uid: normalizedUid },
        include: { checkpoint: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!tag) {
        invalidReason = 'tag_not_associated';
      } else if (tag.status === 'replaced') {
        invalidReason = 'tag_replaced';
      } else if (tag.status !== 'active') {
        invalidReason = 'tag_not_associated';
      } else if (tag.checkpoint.siteId !== shift.siteId) {
        invalidReason = 'other_site';
      } else if (tag.checkpoint.status !== 'active') {
        invalidReason = 'tag_not_associated';
      } else {
        checkpointId = tag.checkpoint.id;
      }
    }

    // 4. Invalid scan -> save InvalidScanAttempt and return rejected
    if (invalidReason !== null) {
      const highlighted = invalidReason === 'outdated_version';
      try {
        await this.prisma.tenantPrisma.invalidScanAttempt.create({
          data: {
            companyId: shift.companyId,
            shiftId: shift.id,
            assignmentId: assignment.id,
            recordId: input.recordId,
            method: input.method,
            reason: invalidReason,
            scannedValue: input.scannedValue.slice(0, 512),
            occurredAtDevice: occurredAt,
            receivedAt,
            locationStatus: input.location.status,
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            accuracyMeters: input.location.accuracyMeters,
            simulation: input.location.simulation,
            highlighted,
            requestHash,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.prisma.tenantPrisma.invalidScanAttempt.findUnique({
            where: { recordId: input.recordId },
          });
          if (existing?.requestHash === requestHash) {
            return checkpointRecordResponseSchema.parse({
              result: 'rejected',
              recordId: input.recordId,
              reason: existing.reason,
            });
          }
          throw new ConflictException({ code: CHECKPOINT_RECORD_ERROR_CODES.recordIdConflict });
        }
        throw error;
      }

      this.logger.log({
        event: 'checkpoint_record.rejected',
        shiftId: input.shiftId,
        recordId: input.recordId,
        method: input.method,
        reason: invalidReason,
      });

      return checkpointRecordResponseSchema.parse({
        result: 'rejected',
        recordId: input.recordId,
        reason: invalidReason,
      });
    }

    // 5. Valid checkpoint -> Imputation
    if (!checkpointId) {
      throw new ConflictException('Checkpoint no identificado');
    }

    const shiftData = await this.shiftExecution.getShiftOfflineData(shift.id);
    const dbPreviousRecords = await this.prisma.tenantPrisma.checkpointRecord.findMany({
      where: { shiftId: shift.id },
      select: {
        checkpointId: true,
        occurredAtDevice: true,
        countedFor: true,
      },
    });

    const previousRecords = dbPreviousRecords.map((r) => ({
      checkpointId: r.checkpointId,
      occurredAtUtc: r.occurredAtDevice.toISOString(),
      countedFor: Array.isArray(r.countedFor)
        ? (r.countedFor as { roundId: string; windowIndex: number }[])
        : [],
    }));

    const imputation = imputeRecord({
      rounds: shiftData.rounds,
      windows: shiftData.windows,
      checkpointId,
      occurredAtUtc: input.occurredAtDevice,
      previousRecords,
      assignment: {
        startsAtUtc: assignment.startsAt.toISOString(),
        endsAtUtc: assignment.endsAt.toISOString(),
      },
    });

    if (imputation.kind === 'counted') {
      let createdRecord;
      try {
        createdRecord = await this.prisma.tenantPrisma.checkpointRecord.create({
          data: {
            companyId: shift.companyId,
            shiftId: shift.id,
            assignmentId: assignment.id,
            checkpointId,
            recordId: input.recordId,
            method: input.method,
            occurredAtDevice: occurredAt,
            receivedAt,
            locationStatus: input.location.status,
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            accuracyMeters: input.location.accuracyMeters,
            simulation: input.location.simulation,
            phoneNfc: input.phoneNfc,
            countedFor: imputation.countedFor as unknown as Prisma.InputJsonValue,
            outOfWindow: false,
            countsForCompliance,
            requestHash,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.prisma.tenantPrisma.checkpointRecord.findUnique({
            where: { recordId: input.recordId },
          });
          if (existing?.requestHash === requestHash) {
            return checkpointRecordResponseSchema.parse({
              result: 'recorded',
              recordId: existing.recordId,
              checkpointId: existing.checkpointId,
              countedFor: existing.countedFor as unknown as ImputedCountedWindow[],
              outOfWindow: existing.outOfWindow,
            });
          }
          throw new ConflictException({ code: CHECKPOINT_RECORD_ERROR_CODES.recordIdConflict });
        }
        throw error;
      }

      try {
        await this.marcas.evaluateRecord(createdRecord);
      } catch (error) {
        this.logger.error({
          event: 'checkpoint_record.marcas_evaluation_failed',
          recordId: input.recordId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.logger.log({
        event: 'checkpoint_record.recorded',
        shiftId: input.shiftId,
        recordId: input.recordId,
        checkpointId,
        method: input.method,
        outOfWindow: false,
        countedWindows: imputation.countedFor.length,
      });

      return checkpointRecordResponseSchema.parse({
        result: 'recorded',
        recordId: input.recordId,
        checkpointId,
        countedFor: imputation.countedFor,
        outOfWindow: false,
      });
    }

    if (imputation.kind === 'out_of_window') {
      let createdRecord;
      try {
        createdRecord = await this.prisma.tenantPrisma.checkpointRecord.create({
          data: {
            companyId: shift.companyId,
            shiftId: shift.id,
            assignmentId: assignment.id,
            checkpointId,
            recordId: input.recordId,
            method: input.method,
            occurredAtDevice: occurredAt,
            receivedAt,
            locationStatus: input.location.status,
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            accuracyMeters: input.location.accuracyMeters,
            simulation: input.location.simulation,
            phoneNfc: input.phoneNfc,
            countedFor: [],
            outOfWindow: true,
            countsForCompliance,
            requestHash,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.prisma.tenantPrisma.checkpointRecord.findUnique({
            where: { recordId: input.recordId },
          });
          if (existing?.requestHash === requestHash) {
            return checkpointRecordResponseSchema.parse({
              result: 'recorded',
              recordId: existing.recordId,
              checkpointId: existing.checkpointId,
              countedFor: [],
              outOfWindow: true,
            });
          }
          throw new ConflictException({ code: CHECKPOINT_RECORD_ERROR_CODES.recordIdConflict });
        }
        throw error;
      }

      try {
        await this.marcas.evaluateRecord(createdRecord);
      } catch (error) {
        this.logger.error({
          event: 'checkpoint_record.marcas_evaluation_failed',
          recordId: input.recordId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.logger.log({
        event: 'checkpoint_record.recorded',
        shiftId: input.shiftId,
        recordId: input.recordId,
        checkpointId,
        method: input.method,
        outOfWindow: true,
      });

      return checkpointRecordResponseSchema.parse({
        result: 'recorded',
        recordId: input.recordId,
        checkpointId,
        countedFor: [],
        outOfWindow: true,
      });
    }

    if (imputation.kind === 'too_soon') {
      this.logger.log({
        event: 'checkpoint_record.not_generated',
        shiftId: input.shiftId,
        recordId: input.recordId,
        checkpointId,
        cause: 'too_soon',
      });

      return checkpointRecordResponseSchema.parse({
        result: 'not_generated',
        recordId: input.recordId,
        cause: 'too_soon',
        retryAfterUtc: imputation.retryAfterUtc,
      });
    }

    // imputation.kind === 'already_recorded'
    this.logger.log({
      event: 'checkpoint_record.not_generated',
      shiftId: input.shiftId,
      recordId: input.recordId,
      checkpointId,
      cause: 'already_recorded',
    });

    return checkpointRecordResponseSchema.parse({
      result: 'not_generated',
      recordId: input.recordId,
      cause: 'already_recorded',
      retryAfterUtc: null,
    });
  }
}
