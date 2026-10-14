import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { SyncBatchRequest, SyncBatchResponse, SyncEventResult } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CheckpointRecordsService,
  computeRequestHash,
  type CheckpointRecordBatchContext,
} from '../checkpoint-records/checkpoint-records.service';
import { ShiftExecutionService } from '../shift-execution/shift-execution.service';
import { ShiftSyncStateService } from './shift-sync-state.service';
import type { ShiftCredentialPayload } from './shift-credential.service';

@Injectable()
export class SyncBatchService {
  private readonly logger = new Logger(SyncBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly checkpointRecordsService: CheckpointRecordsService,
    private readonly shiftExecutionService: ShiftExecutionService,
    private readonly syncStateService: ShiftSyncStateService,
  ) {}

  async processBatch(
    input: SyncBatchRequest,
    credential: ShiftCredentialPayload,
    user: AuthenticatedUser,
  ): Promise<SyncBatchResponse> {
    if (input.shiftId !== credential.shiftId) {
      throw new ConflictException({
        code: 'SHIFT_ID_MISMATCH',
        message: 'El turno del lote no coincide con la credencial',
      });
    }

    const receivedAt = this.clock.now();

    // systemPrisma se usa para registrar la auditoría del lote recibido
    await this.prisma.systemPrisma.syncBatch.create({
      data: {
        companyId: credential.companyId,
        shiftId: credential.shiftId,
        receivedAt,
        eventCount: input.events.length,
        pendingCount: input.pendingCount,
        syncedUntil: input.syncedUntil ? new Date(input.syncedUntil) : null,
      },
    });

    await this.syncStateService.updateSyncState({
      companyId: credential.companyId,
      shiftId: credential.shiftId,
      pendingCount: input.pendingCount,
      syncedUntil: input.syncedUntil ? new Date(input.syncedUntil) : null,
      contactAt: receivedAt,
      isBatch: true,
    });

    // Precarga de contexto de turno para optimizar procesamiento por lote
    const shift = await this.prisma.systemPrisma.shift.findFirst({
      where: { id: credential.shiftId, companyId: credential.companyId },
      include: {
        assignments: {
          where: { isCurrent: true, active: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    let batchContext: CheckpointRecordBatchContext | undefined;
    if (shift) {
      try {
        const shiftData = await this.shiftExecutionService.getShiftOfflineData(credential.shiftId);
        const dbPrevious = await this.prisma.systemPrisma.checkpointRecord.findMany({
          where: { shiftId: credential.shiftId },
          select: { checkpointId: true, occurredAtDevice: true, countedFor: true },
        });
        const previousRecords = dbPrevious.map((r) => ({
          checkpointId: r.checkpointId,
          occurredAtUtc: r.occurredAtDevice.toISOString(),
          countedFor: Array.isArray(r.countedFor)
            ? (r.countedFor as Array<{ roundId: string; windowIndex: number }>)
            : [],
        }));
        batchContext = {
          shift,
          shiftData,
          previousRecords,
        };
      } catch (err: unknown) {
        this.logger.debug({
          event: 'sync_batch.context_preload_failed',
          shiftId: credential.shiftId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const results: SyncEventResult[] = [];

    for (const event of input.events) {
      if (event.type === 'checkpoint_record') {
        const recordId = event.payload.recordId;

        if (event.payload.shiftId !== credential.shiftId) {
          results.push({
            status: 'rejected',
            eventId: recordId,
            reason: 'not_in_credential_shift',
            message: 'El registro no pertenece al turno de la credencial',
          });
          continue;
        }

        const reqHash = computeRequestHash(event.payload);

        // Chequeo de idempotencia sobre CheckpointRecord
        const existingRecord = await this.prisma.systemPrisma.checkpointRecord.findUnique({
          where: { recordId },
        });
        if (existingRecord) {
          if (existingRecord.requestHash === reqHash) {
            results.push({ status: 'duplicate', eventId: recordId });
          } else {
            results.push({
              status: 'rejected',
              eventId: recordId,
              reason: 'event_id_conflict',
              message: 'El identificador de registro ya fue utilizado con otro contenido',
            });
          }
          continue;
        }

        // Chequeo de idempotencia sobre InvalidScanAttempt
        const existingAttempt = await this.prisma.systemPrisma.invalidScanAttempt.findUnique({
          where: { recordId },
        });
        if (existingAttempt) {
          if (existingAttempt.requestHash === reqHash) {
            results.push({ status: 'duplicate', eventId: recordId });
          } else {
            results.push({
              status: 'rejected',
              eventId: recordId,
              reason: 'event_id_conflict',
              message: 'El identificador de registro ya fue utilizado con otro contenido',
            });
          }
          continue;
        }

        try {
          const outcome = await this.checkpointRecordsService.processRecord(
            event.payload,
            user,
            batchContext,
          );
          results.push({
            status: 'accepted',
            eventId: recordId,
            outcome,
          });
        } catch (error: any) {
          this.logger.warn({
            event: 'sync_batch.checkpoint_error',
            recordId,
            error: error.message,
          });
          results.push({
            status: 'rejected',
            eventId: recordId,
            reason: 'invalid_data',
            message: error.message ?? 'Datos del registro no válidos',
          });
        }
      } else if (event.type === 'shift_close') {
        const eventId = event.payload.eventId;

        // Chequeo de idempotencia sobre ShiftEvent
        const existingEvent = await this.prisma.systemPrisma.shiftEvent.findUnique({
          where: { deviceEventId: eventId },
        });
        if (existingEvent) {
          if (existingEvent.shiftId === credential.shiftId) {
            results.push({ status: 'duplicate', eventId });
          } else {
            results.push({
              status: 'rejected',
              eventId,
              reason: 'event_id_conflict',
              message: 'El identificador de evento ya fue utilizado en otro turno',
            });
          }
          continue;
        }

        try {
          const outcome = await this.shiftExecutionService.close(
            credential.shiftId,
            event.payload,
            user,
          );
          results.push({
            status: 'accepted',
            eventId,
            outcome,
          });
        } catch (error: any) {
          this.logger.warn({
            event: 'sync_batch.shift_close_error',
            eventId,
            error: error.message,
          });
          results.push({
            status: 'rejected',
            eventId,
            reason: 'invalid_data',
            message: error.message ?? 'Datos de cierre de turno no válidos',
          });
        }
      }
    }

    this.logger.log({
      event: 'sync_batch.processed',
      shiftId: credential.shiftId,
      totalEvents: input.events.length,
      accepted: results.filter((r) => r.status === 'accepted').length,
      duplicate: results.filter((r) => r.status === 'duplicate').length,
      rejected: results.filter((r) => r.status === 'rejected').length,
    });

    return {
      results,
      receivedAt: receivedAt.toISOString(),
    };
  }
}
