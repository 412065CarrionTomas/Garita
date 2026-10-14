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
import type { CheckpointRecordRequest, ShiftOfflineData, SyncBatchRequest } from '@garita/shared';

interface SyncBatchRecord {
  id?: string;
  shiftId: string;
  receivedAt: Date;
  eventCount: number;
  pendingCount: number;
  syncedUntil: Date | null;
}

interface CheckpointRecordMock {
  recordId: string;
  checkpointId: string;
  occurredAtDevice: Date;
  countedFor: { roundId: string; windowIndex: number }[];
  outOfWindow: boolean;
  requestHash: string;
  shiftId?: string;
}

interface InvalidScanMock {
  recordId: string;
  requestHash: string;
}

interface ShiftEventMock {
  shiftId: string;
  deviceEventId: string;
}

describe('SyncBatchService', () => {
  const fixedNow = new Date('2026-10-14T12:00:00.000Z');
  let clock: Clock;
  let prisma: PrismaService;
  let checkpointRecordsService: CheckpointRecordsService;
  let shiftExecutionService: ShiftExecutionService;
  let syncStateService: ShiftSyncStateService;
  let updateSyncStateMock: jest.Mock;
  let service: SyncBatchService;

  let syncBatches: SyncBatchRecord[];
  let checkpointRecords: Map<string, CheckpointRecordMock>;
  let invalidScanAttempts: Map<string, InvalidScanMock>;
  let shiftEvents: Map<string, ShiftEventMock>;

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
          create: jest.fn((args: { data: SyncBatchRecord }) => {
            syncBatches.push(args.data);
            return Promise.resolve({ id: 'batch-1', ...args.data });
          }),
        },
        shift: {
          findFirst: jest.fn(() =>
            Promise.resolve({
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
            }),
          ),
        },
        checkpointRecord: {
          findUnique: jest.fn((args: { where: { recordId: string } }) =>
            Promise.resolve(checkpointRecords.get(args.where.recordId) ?? null),
          ),
          findMany: jest.fn(() => Promise.resolve(Array.from(checkpointRecords.values()))),
        },
        invalidScanAttempt: {
          findUnique: jest.fn((args: { where: { recordId: string } }) =>
            Promise.resolve(invalidScanAttempts.get(args.where.recordId) ?? null),
          ),
        },
        shiftEvent: {
          findUnique: jest.fn((args: { where: { deviceEventId: string } }) =>
            Promise.resolve(shiftEvents.get(args.where.deviceEventId) ?? null),
          ),
        },
      },
    } as unknown as PrismaService;

    checkpointRecordsService = {
      processRecord: jest.fn(
        (payload: CheckpointRecordRequest, _user: AuthenticatedUser, _ctx?: unknown) => {
          const hash = computeRequestHash(payload);
          const record: CheckpointRecordMock = {
            recordId: payload.recordId,
            checkpointId: 'cp-1',
            occurredAtDevice: new Date(payload.occurredAtDevice),
            countedFor: [{ roundId: 'round-1', windowIndex: 0 }],
            outOfWindow: false,
            requestHash: hash,
            shiftId: payload.shiftId,
          };
          checkpointRecords.set(payload.recordId, record);
          return Promise.resolve({
            result: 'recorded' as const,
            recordId: payload.recordId,
            checkpointId: 'cp-1',
            countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
            outOfWindow: false,
          });
        },
      ),
    } as unknown as CheckpointRecordsService;

    shiftExecutionService = {
      getShiftOfflineData: jest.fn(() =>
        Promise.resolve({ rounds: [], windows: [] } as unknown as ShiftOfflineData),
      ),
      close: jest.fn((_id: string, payload: { eventId: string; occurredAtDevice: string }) => {
        shiftEvents.set(payload.eventId, {
          shiftId: 'shift-1',
          deviceEventId: payload.eventId,
        });
        return Promise.resolve({
          status: 'closed' as const,
          closedAt: payload.occurredAtDevice,
          closedEarly: false,
        });
      }),
    } as unknown as ShiftExecutionService;

    updateSyncStateMock = jest.fn();
    syncStateService = {
      updateSyncState: updateSyncStateMock,
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
    expect(updateSyncStateMock).toHaveBeenCalledWith(
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
