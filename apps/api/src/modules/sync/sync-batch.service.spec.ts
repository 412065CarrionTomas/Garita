import { ConflictException } from '@nestjs/common';
import { SyncBatchService } from './sync-batch.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Clock } from '../../common/clock';
import type { CheckpointRecordsService } from '../checkpoint-records/checkpoint-records.service';
import { computeRequestHash } from '../checkpoint-records/checkpoint-records.service';
import type { ShiftExecutionService } from '../shift-execution/shift-execution.service';
import type { ShiftSyncStateService } from './shift-sync-state.service';
import type { ShiftCredentialPayload } from './shift-credential.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { SyncBatchRequest } from '@garita/shared';

describe('SyncBatchService', () => {
  const fixedNow = new Date('2026-10-14T12:00:00.000Z');
  let clock: Clock;
  let prisma: PrismaService;
  let checkpointRecordsService: CheckpointRecordsService;
  let shiftExecutionService: ShiftExecutionService;
  let syncStateService: ShiftSyncStateService;
  let service: SyncBatchService;

  let syncBatches: any[];
  let checkpointRecords: Map<string, any>;
  let invalidScanAttempts: Map<string, any>;
  let shiftEvents: Map<string, any>;

  const credential: ShiftCredentialPayload = {
    shiftId: 'shift-1',
    assignmentId: 'assign-1',
    userId: 'guard-1',
    companyId: 'company-1',
    exp: 1800000000,
  };

  const guardUser: AuthenticatedUser = {
    userId: 'guard-1',
    companyId: 'company-1',
    role: 'guard',
    status: 'active',
  };

  beforeEach(() => {
    syncBatches = [];
    checkpointRecords = new Map();
    invalidScanAttempts = new Map();
    shiftEvents = new Map();

    clock = { now: () => fixedNow };

    prisma = {
      systemPrisma: {
        syncBatch: {
          create: jest.fn(async ({ data }) => {
            syncBatches.push(data);
            return { id: 'batch-1', ...data };
          }),
        },
        shift: {
          findFirst: jest.fn(async () => ({
            id: 'shift-1',
            companyId: 'company-1',
            siteId: 'site-1',
            status: 'in_progress',
            assignments: [
              {
                id: 'assign-1',
                guardId: 'guard-1',
                startsAt: new Date('2026-10-14T08:00:00.000Z'),
                endsAt: new Date('2026-10-14T16:00:00.000Z'),
              },
            ],
          })),
        },
        checkpointRecord: {
          findUnique: jest.fn(async ({ where }) => checkpointRecords.get(where.recordId) ?? null),
          findMany: jest.fn(async () => Array.from(checkpointRecords.values())),
        },
        invalidScanAttempt: {
          findUnique: jest.fn(async ({ where }) => invalidScanAttempts.get(where.recordId) ?? null),
        },
        shiftEvent: {
          findUnique: jest.fn(async ({ where }) => shiftEvents.get(where.deviceEventId) ?? null),
        },
      },
    } as unknown as PrismaService;

    checkpointRecordsService = {
      processRecord: jest.fn(async (payload) => {
        const hash = computeRequestHash(payload);
        const record = {
          recordId: payload.recordId,
          checkpointId: 'cp-1',
          occurredAtDevice: new Date(payload.occurredAtDevice),
          countedFor: [{ roundId: 'round-1', windowIndex: 0 }],
          outOfWindow: false,
          requestHash: hash,
        };
        checkpointRecords.set(payload.recordId, record);
        return {
          result: 'recorded' as const,
          recordId: payload.recordId,
          checkpointId: 'cp-1',
          countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
          outOfWindow: false,
        };
      }),
    } as unknown as CheckpointRecordsService;

    shiftExecutionService = {
      getShiftOfflineData: jest.fn(async () => ({ rounds: [], windows: [] })),
      close: jest.fn(async (_id, payload) => {
        shiftEvents.set(payload.eventId, {
          shiftId: 'shift-1',
          deviceEventId: payload.eventId,
        });
        return {
          status: 'closed' as const,
          closedAt: payload.occurredAtDevice,
          closedEarly: false,
        };
      }),
    } as unknown as ShiftExecutionService;

    syncStateService = {
      updateSyncState: jest.fn(),
    } as unknown as ShiftSyncStateService;

    service = new SyncBatchService(
      prisma,
      clock,
      checkpointRecordsService,
      shiftExecutionService,
      syncStateService,
    );
  });

  it('procesa exitosamente un lote con registros y cierre', async () => {
    const input: SyncBatchRequest = {
      shiftId: 'shift-1',
      pendingCount: 0,
      syncedUntil: '2026-10-14T11:59:00.000Z',
      events: [
        {
          type: 'checkpoint_record',
          payload: {
            recordId: '11111111-1111-4111-8111-111111111111',
            shiftId: 'shift-1',
            method: 'qr',
            scannedValue: 'valid-qr',
            occurredAtDevice: '2026-10-14T10:00:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T10:00:00.000Z',
            },
            phoneNfc: 'on',
          },
        },
        {
          type: 'shift_close',
          payload: {
            eventId: '22222222-2222-4222-8222-222222222222',
            occurredAtDevice: '2026-10-14T11:59:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T11:59:00.000Z',
            },
          },
        },
      ],
    };

    const response = await service.processBatch(input, credential, guardUser);

    expect(response.receivedAt).toBe(fixedNow.toISOString());
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        status: 'accepted',
        eventId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(response.results[1]).toEqual(
      expect.objectContaining({
        status: 'accepted',
        eventId: '22222222-2222-4222-8222-222222222222',
      }),
    );

    expect(syncBatches).toHaveLength(1);
    expect(syncStateService.updateSyncState).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftId: 'shift-1',
        isBatch: true,
      }),
    );
  });

  it('reenvío del mismo lote devuelve duplicate para todo (CA3, BDD 3)', async () => {
    const input: SyncBatchRequest = {
      shiftId: 'shift-1',
      pendingCount: 0,
      syncedUntil: '2026-10-14T11:59:00.000Z',
      events: [
        {
          type: 'checkpoint_record',
          payload: {
            recordId: '11111111-1111-4111-8111-111111111111',
            shiftId: 'shift-1',
            method: 'qr',
            scannedValue: 'valid-qr',
            occurredAtDevice: '2026-10-14T10:00:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T10:00:00.000Z',
            },
            phoneNfc: 'on',
          },
        },
        {
          type: 'shift_close',
          payload: {
            eventId: '22222222-2222-4222-8222-222222222222',
            occurredAtDevice: '2026-10-14T11:59:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T11:59:00.000Z',
            },
          },
        },
      ],
    };

    // First delivery
    await service.processBatch(input, credential, guardUser);

    // Replay
    const replayResponse = await service.processBatch(input, credential, guardUser);

    expect(replayResponse.results).toHaveLength(2);
    expect(replayResponse.results[0]).toEqual({
      status: 'duplicate',
      eventId: '11111111-1111-4111-8111-111111111111',
    });
    expect(replayResponse.results[1]).toEqual({
      status: 'duplicate',
      eventId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('un evento inválido y otro de otro turno son rechazados sin frenar al resto', async () => {
    (checkpointRecordsService.processRecord as jest.Mock).mockRejectedValueOnce(
      new Error('Datos corruptos'),
    );

    const input: SyncBatchRequest = {
      shiftId: 'shift-1',
      pendingCount: 1,
      syncedUntil: null,
      events: [
        {
          type: 'checkpoint_record',
          payload: {
            recordId: '11111111-1111-4111-8111-111111111111',
            shiftId: 'shift-1',
            method: 'qr',
            scannedValue: 'corrupt',
            occurredAtDevice: '2026-10-14T10:00:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T10:00:00.000Z',
            },
            phoneNfc: 'on',
          },
        },
        {
          type: 'checkpoint_record',
          payload: {
            recordId: '33333333-3333-4333-8333-333333333333',
            shiftId: 'other-shift',
            method: 'qr',
            scannedValue: 'valid-qr',
            occurredAtDevice: '2026-10-14T10:05:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T10:05:00.000Z',
            },
            phoneNfc: 'on',
          },
        },
        {
          type: 'shift_close',
          payload: {
            eventId: '22222222-2222-4222-8222-222222222222',
            occurredAtDevice: '2026-10-14T11:59:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T11:59:00.000Z',
            },
          },
        },
      ],
    };

    const response = await service.processBatch(input, credential, guardUser);

    expect(response.results).toHaveLength(3);
    expect(response.results[0]).toEqual({
      status: 'rejected',
      eventId: '11111111-1111-4111-8111-111111111111',
      reason: 'invalid_data',
      message: 'Datos corruptos',
    });
    expect(response.results[1]).toEqual({
      status: 'rejected',
      eventId: '33333333-3333-4333-8333-333333333333',
      reason: 'not_in_credential_shift',
      message: 'El registro no pertenece al turno de la credencial',
    });
    expect(response.results[2]).toEqual(
      expect.objectContaining({
        status: 'accepted',
        eventId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('rechaza con SHIFT_ID_MISMATCH si el turno del lote difiere de la credencial', async () => {
    const input: SyncBatchRequest = {
      shiftId: 'different-shift',
      pendingCount: 0,
      syncedUntil: null,
      events: [
        {
          type: 'shift_close',
          payload: {
            eventId: '22222222-2222-4222-8222-222222222222',
            occurredAtDevice: '2026-10-14T11:59:00.000Z',
            location: {
              status: 'ok',
              latitude: -34.6,
              longitude: -58.4,
              accuracyMeters: 10,
              simulation: 'not_simulated',
              takenAt: '2026-10-14T11:59:00.000Z',
            },
          },
        },
      ],
    };

    await expect(service.processBatch(input, credential, guardUser)).rejects.toThrow(
      ConflictException,
    );
  });
});
