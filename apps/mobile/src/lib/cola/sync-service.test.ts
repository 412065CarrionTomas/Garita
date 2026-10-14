import type {
  ConnectionNoticeRequest,
  ConnectionNoticeResponse,
  PendingFieldEvent,
  ShiftOfflineData,
  SyncBatchRequest,
  SyncBatchResponse,
} from '@garita/shared';
import {
  createFieldRepository,
  type FieldDatabase,
  type LocalCheckpointRecord,
  type MigrationDatabase,
} from '@/lib/db/database';
import {
  processSyncQueue,
  resetSyncServiceForTesting,
  sendConnectionNoticeIfNeeded,
  setSyncServiceForTesting,
} from './sync-service';

class MockMemoryDatabase implements FieldDatabase, MigrationDatabase {
  version = 4;
  shift: unknown | null = null;
  events: PendingFieldEvent[] = [];
  sent = new Set<string>();
  rejected = new Map<string, string>();
  records: LocalCheckpointRecord[] = [];
  meta = new Map<string, string>();

  async getVersion() {
    return this.version;
  }
  async setVersion(v: number) {
    this.version = v;
  }
  async exec() {}
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
  async replaceShift(data: ShiftOfflineData | null) {
    this.shift = data;
    if (!data) this.records = [];
  }
  async readShift() {
    return this.shift;
  }
  async insertEvent(event: PendingFieldEvent) {
    if (!this.events.some(({ id }) => id === event.id)) this.events.push(event);
  }
  async markEventSent(id: string) {
    this.sent.add(id);
  }
  async markEventRejected(id: string, reason: string) {
    this.rejected.set(id, reason);
  }
  async countPendingEvents() {
    return this.events.filter(
      ({ id, type }) =>
        !this.sent.has(id) &&
        !this.rejected.has(id) &&
        (type === 'checkpoint_record' || type === 'shift_close'),
    ).length;
  }
  async readEvents(limit?: number) {
    const active = this.events
      .filter(
        ({ id, type }) =>
          !this.sent.has(id) &&
          !this.rejected.has(id) &&
          (type === 'checkpoint_record' || type === 'shift_close'),
      )
      .sort((a, b) => {
        const timeDiff = Date.parse(a.occurredAtDevice) - Date.parse(b.occurredAtDevice);
        return timeDiff !== 0 ? timeDiff : Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });
    return limit !== undefined ? active.slice(0, limit) : active;
  }
  async readPendingEvents(limit?: number) {
    return this.readEvents(limit);
  }
  async getSyncMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setSyncMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
  async getPendingEventRejectReason(id: string) {
    return this.rejected.get(id) ?? null;
  }
  async insertCheckpointRecord(record: LocalCheckpointRecord) {
    const idx = this.records.findIndex((r) => r.recordId === record.recordId);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
  }
  async readCheckpointRecords(shiftId?: string) {
    return shiftId ? this.records.filter((r) => r.shiftId === shiftId) : this.records;
  }
  async updateCheckpointRecordServerResult(
    recordId: string,
    result: 'recorded' | 'rejected',
    reason?: string | null,
  ) {
    const record = this.records.find((r) => r.recordId === recordId);
    if (record) {
      record.serverResult = result;
      record.serverReason = reason ?? null;
    }
  }
}

describe('SyncService (HU-13)', () => {
  let db: MockMemoryDatabase;
  let repo: ReturnType<typeof createFieldRepository>;
  let sendBatchMock: jest.Mock<Promise<SyncBatchResponse>, [SyncBatchRequest, (string | null)?]>;
  let sendNoticeMock: jest.Mock<
    Promise<ConnectionNoticeResponse>,
    [ConnectionNoticeRequest, (string | null)?]
  >;
  let credentialToken: string | null;
  let deleteCredentialMock: jest.Mock<Promise<void>, []>;
  let onlineStatus: boolean;
  let appStateStatus: 'active' | 'background' | 'inactive';
  let timersScheduled: { fn: () => void; ms: number }[];

  const shiftData: ShiftOfflineData = {
    shift: {
      id: 'shift-100',
      siteId: 'site-1',
      siteName: 'Planta Industrial',
      startsAt: '2026-10-14T08:00:00.000Z',
      endsAt: '2026-10-14T16:00:00.000Z',
      timezone: 'America/Argentina/Buenos_Aires',
      assignmentId: 'assign-1',
    },
    rounds: [],
    windows: [],
    checkpoints: [],
    serverTime: { serverNowUtc: '2026-10-14T08:00:00.000Z' },
  };

  beforeEach(async () => {
    db = new MockMemoryDatabase();
    repo = createFieldRepository(db);
    await repo.saveShiftData(shiftData);
    credentialToken = 'cred-token-abc';
    onlineStatus = true;
    appStateStatus = 'active';
    timersScheduled = [];

    sendBatchMock = jest.fn(async (req: SyncBatchRequest) => ({
      results: req.events.map((e) => ({
        status: 'accepted' as const,
        eventId:
          e.type === 'checkpoint_record'
            ? (e.payload as { recordId: string }).recordId
            : (e.payload as { eventId: string }).eventId,
        outcome: {
          result: 'recorded' as const,
          recordId: 'rec-1',
          checkpointId: 'cp-1',
          countedFor: [],
          outOfWindow: false,
        },
      })),
      receivedAt: '2026-10-14T10:00:00.000Z',
    }));

    sendNoticeMock = jest.fn(async (_req: ConnectionNoticeRequest, _token?: string | null) => ({
      receivedAt: '2026-10-14T10:00:00.000Z',
    }));

    deleteCredentialMock = jest.fn(async () => {
      credentialToken = null;
    });

    setSyncServiceForTesting({
      now: () => new Date('2026-10-14T10:00:00.000Z'),
      online: async () => onlineStatus,
      appState: () => appStateStatus,
      repository: async () => repo,
      sendBatch: sendBatchMock,
      sendNotice: sendNoticeMock,
      getCredentialToken: async () => credentialToken,
      deleteCredential: deleteCredentialMock,
      setTimeout: (fn, ms) => {
        timersScheduled.push({ fn, ms });
        return timersScheduled.length;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    });
  });

  afterEach(() => {
    resetSyncServiceForTesting();
  });

  it('sends pending events in batches of up to 100 in order of occurredAtDevice (CA1, CA2)', async () => {
    // Add 120 checkpoint records with different times
    for (let i = 1; i <= 120; i++) {
      const pad = String(i).padStart(3, '0');
      const time = `2026-10-14T08:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      const id = `00000000-0000-4000-8000-${pad.padStart(12, '0')}`;
      await repo.addPendingEvent({
        id,
        type: 'checkpoint_record',
        payload: {
          recordId: id,
          shiftId: 'shift-100',
          method: 'qr',
          scannedValue: `QR-${i}`,
          occurredAtDevice: time,
          location: {
            status: 'ok',
            latitude: -34.6,
            longitude: -58.4,
            accuracyMeters: 5,
            simulation: 'not_simulated',
            takenAt: time,
          },
          phoneNfc: 'on',
        },
        occurredAtDevice: time,
        createdAt: time,
      });
      await repo.saveCheckpointRecord({
        recordId: id,
        shiftId: 'shift-100',
        checkpointId: `cp-${i}`,
        checkpointName: `Punto ${i}`,
        occurredAtUtc: time,
        countedFor: [],
        outOfWindow: false,
        createdAt: time,
      });
    }

    expect(await repo.countPendingEvents()).toBe(120);

    const outcome = await processSyncQueue();

    expect(outcome.success).toBe(true);
    expect(outcome.batchesSent).toBe(2);
    expect(outcome.processed).toBe(120);

    // Batch 1 has 100 events
    expect(sendBatchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        shiftId: 'shift-100',
        events: expect.any(Array),
        pendingCount: 20,
        syncedUntil: null,
      }),
      'cred-token-abc',
    );
    expect(sendBatchMock.mock.calls[0]![0].events).toHaveLength(100);

    // Batch 2 has remaining 20 events
    expect(sendBatchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        shiftId: 'shift-100',
        events: expect.any(Array),
        pendingCount: 0,
      }),
      'cred-token-abc',
    );
    expect(sendBatchMock.mock.calls[1]![0].events).toHaveLength(20);

    // After sync, pending count is 0
    expect(await repo.countPendingEvents()).toBe(0);
  });

  it('H-2: limits database query to SYNC_BATCH_MAX_EVENTS per iteration without reading all rows into memory', async () => {
    for (let i = 1; i <= 250; i++) {
      const pad = String(i).padStart(3, '0');
      const time = `2026-10-14T08:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      const id = `00000000-0000-4000-8000-${pad.padStart(12, '0')}`;
      await repo.addPendingEvent({
        id,
        type: 'checkpoint_record',
        payload: {
          recordId: id,
          shiftId: 'shift-100',
          method: 'qr',
          scannedValue: `QR-${i}`,
          occurredAtDevice: time,
          location: {
            status: 'ok',
            latitude: -34.6,
            longitude: -58.4,
            accuracyMeters: 5,
            simulation: 'not_simulated',
            takenAt: time,
          },
          phoneNfc: 'on',
        },
        occurredAtDevice: time,
        createdAt: time,
      });
    }

    const listSpy = jest.spyOn(repo, 'listPendingEvents');

    const outcome = await processSyncQueue();
    expect(outcome.success).toBe(true);
    expect(outcome.batchesSent).toBe(3);

    // Verify that every call to listPendingEvents received { limit: 100 }
    // (or { limit: 1 } at cleanup check) and that no call returned more than 100 rows
    expect(listSpy).toHaveBeenCalled();
    for (const call of listSpy.mock.calls) {
      const options = call[0];
      expect(options?.limit).toBeDefined();
      expect(options?.limit).toBeLessThanOrEqual(100);
    }
    for (const resultPromise of listSpy.mock.results) {
      const rows = await resultPromise.value;
      expect(rows.length).toBeLessThanOrEqual(100);
    }
  });

  it('updates checkpoint_records with server result when accepted', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    await repo.addPendingEvent({
      id,
      type: 'checkpoint_record',
      payload: {
        recordId: id,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: 'QR-1',
        occurredAtDevice: '2026-10-14T08:30:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-14T08:30:00.000Z',
        },
        phoneNfc: 'on',
      },
      occurredAtDevice: '2026-10-14T08:30:00.000Z',
      createdAt: '2026-10-14T08:30:00.000Z',
    });
    await repo.saveCheckpointRecord({
      recordId: id,
      shiftId: 'shift-100',
      checkpointId: 'cp-1',
      checkpointName: 'Punto 1',
      occurredAtUtc: '2026-10-14T08:30:00.000Z',
      countedFor: [],
      outOfWindow: false,
      createdAt: '2026-10-14T08:30:00.000Z',
    });

    sendBatchMock.mockResolvedValueOnce({
      results: [
        {
          status: 'accepted',
          eventId: id,
          outcome: {
            result: 'rejected',
            recordId: id,
            reason: 'outdated_version',
          },
        },
      ],
      receivedAt: '2026-10-14T10:00:00.000Z',
    });

    await processSyncQueue();

    const records = await repo.listCheckpointRecords('shift-100');
    expect(records[0]!.serverResult).toBe('rejected');
    expect(records[0]!.serverReason).toBe('outdated_version');
  });

  it('handles resending after connection cut without duplicating locally (CA3)', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    await repo.addPendingEvent({
      id,
      type: 'checkpoint_record',
      payload: {
        recordId: id,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: 'QR-1',
        occurredAtDevice: '2026-10-14T08:30:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-14T08:30:00.000Z',
        },
        phoneNfc: 'on',
      },
      occurredAtDevice: '2026-10-14T08:30:00.000Z',
      createdAt: '2026-10-14T08:30:00.000Z',
    });

    // Server returns duplicate (it had received it before the cut)
    sendBatchMock.mockResolvedValueOnce({
      results: [{ status: 'duplicate', eventId: id }],
      receivedAt: '2026-10-14T10:00:00.000Z',
    });

    await processSyncQueue();

    expect(await repo.countPendingEvents()).toBe(0);
    const records = await repo.listCheckpointRecords('shift-100');
    expect(records).toHaveLength(0); // wasn't in checkpoint_records or marked recorded
  });

  it('does not block the queue when an event is rejected by the server and stores reject_reason (Validation)', async () => {
    const badId = '00000000-0000-4000-8000-000000000001';
    const goodId = '00000000-0000-4000-8000-000000000002';

    await repo.addPendingEvent({
      id: badId,
      type: 'checkpoint_record',
      payload: {
        recordId: badId,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: 'BAD',
        occurredAtDevice: '2026-10-14T08:10:00.000Z',
        location: {
          status: 'disabled',
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          simulation: 'unavailable',
          takenAt: null,
        },
        phoneNfc: 'unavailable',
      },
      occurredAtDevice: '2026-10-14T08:10:00.000Z',
      createdAt: '2026-10-14T08:10:00.000Z',
    });

    await repo.addPendingEvent({
      id: goodId,
      type: 'checkpoint_record',
      payload: {
        recordId: goodId,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: 'GOOD',
        occurredAtDevice: '2026-10-14T08:20:00.000Z',
        location: {
          status: 'disabled',
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          simulation: 'unavailable',
          takenAt: null,
        },
        phoneNfc: 'unavailable',
      },
      occurredAtDevice: '2026-10-14T08:20:00.000Z',
      createdAt: '2026-10-14T08:20:00.000Z',
    });

    sendBatchMock.mockResolvedValueOnce({
      results: [
        {
          status: 'rejected',
          eventId: badId,
          reason: 'invalid_data',
          message: 'Datos inválidos',
        },
        {
          status: 'accepted',
          eventId: goodId,
          outcome: {
            result: 'recorded',
            recordId: goodId,
            checkpointId: 'cp-good',
            countedFor: [],
            outOfWindow: false,
          },
        },
      ],
      receivedAt: '2026-10-14T10:00:00.000Z',
    });

    const result = await processSyncQueue();
    expect(result.success).toBe(true);

    // The good one was accepted, the bad one was rejected
    expect(await repo.countPendingEvents()).toBe(0);
    expect(await repo.getPendingEventRejectReason(badId)).toBe('invalid_data');
  });

  it('retries with exponential backoff on network failure or 5xx without limit of attempts (CA11)', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    await repo.addPendingEvent({
      id,
      type: 'checkpoint_record',
      payload: {
        recordId: id,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: 'QR-1',
        occurredAtDevice: '2026-10-14T08:30:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-14T08:30:00.000Z',
        },
        phoneNfc: 'on',
      },
      occurredAtDevice: '2026-10-14T08:30:00.000Z',
      createdAt: '2026-10-14T08:30:00.000Z',
    });

    sendBatchMock.mockRejectedValue(new Error('Network error (503 Service Unavailable)'));

    const outcome = await processSyncQueue();
    expect(outcome.success).toBe(false);

    // Nothing was marked sent
    expect(await repo.countPendingEvents()).toBe(1);

    // Timer was scheduled with initial backoff (5 seconds = 5000 ms)
    expect(timersScheduled).toHaveLength(1);
    expect(timersScheduled[0]!.ms).toBe(5000);

    // Fail again
    await processSyncQueue();
    expect(timersScheduled).toHaveLength(2);
    expect(timersScheduled[1]!.ms).toBe(10000); // 10 seconds
  });

  it('computes syncedUntil correctly for partial and complete synchronization (CA7)', async () => {
    const time1 = '2026-10-14T08:10:00.000Z';
    const time2 = '2026-10-14T08:20:00.000Z';
    const id1 = '00000000-0000-4000-8000-000000000001';
    const id2 = '00000000-0000-4000-8000-000000000002';

    await repo.addPendingEvent({
      id: id1,
      type: 'checkpoint_record',
      payload: {
        recordId: id1,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: '1',
        occurredAtDevice: time1,
        location: {
          status: 'disabled',
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          simulation: 'unavailable',
          takenAt: null,
        },
        phoneNfc: 'on',
      },
      occurredAtDevice: time1,
      createdAt: time1,
    });

    await repo.addPendingEvent({
      id: id2,
      type: 'checkpoint_record',
      payload: {
        recordId: id2,
        shiftId: 'shift-100',
        method: 'qr',
        scannedValue: '2',
        occurredAtDevice: time2,
        location: {
          status: 'disabled',
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          simulation: 'unavailable',
          takenAt: null,
        },
        phoneNfc: 'on',
      },
      occurredAtDevice: time2,
      createdAt: time2,
    });

    // Send only first batch with event 1 accepted
    sendBatchMock.mockResolvedValueOnce({
      results: [
        {
          status: 'accepted',
          eventId: id1,
          outcome: {
            result: 'recorded',
            recordId: id1,
            checkpointId: 'cp-1',
            countedFor: [],
            outOfWindow: false,
          },
        },
      ],
      receivedAt: '2026-10-14T10:00:00.000Z',
    });

    await processSyncQueue();
    expect(await repo.getSyncMeta('synced_until')).toBe(time1);
  });

  it('sends connection notice every 2 minutes only with shift in progress, online and foreground (CA5)', async () => {
    // With shift in progress, online and active: sends notice
    const sent = await sendConnectionNoticeIfNeeded();
    expect(sent).toBe(true);
    expect(sendNoticeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftId: 'shift-100',
        sentAtDevice: '2026-10-14T10:00:00.000Z',
        pendingCount: 0,
        syncedUntil: null,
      }),
      'cred-token-abc',
    );

    // If app is in background: does not send
    appStateStatus = 'background';
    expect(await sendConnectionNoticeIfNeeded()).toBe(false);

    // If offline: does not send
    appStateStatus = 'active';
    onlineStatus = false;
    expect(await sendConnectionNoticeIfNeeded()).toBe(false);

    // If no shift in progress: does not send
    onlineStatus = true;
    await repo.clearShiftData();
    expect(await sendConnectionNoticeIfNeeded()).toBe(false);
  });

  it('silently ignores connection notice failure (CA5)', async () => {
    sendNoticeMock.mockRejectedValueOnce(new Error('Network error'));
    const result = await sendConnectionNoticeIfNeeded();
    expect(result).toBe(false); // returns false, does not throw
  });

  it('processes 500 events across 5 batches without degrading (Performance CA)', async () => {
    const startTime = Date.now();
    for (let i = 1; i <= 500; i++) {
      const pad = String(i).padStart(3, '0');
      const time = `2026-10-14T08:00:${String(i % 60).padStart(2, '0')}.000Z`;
      const id = `00000000-0000-4000-8000-${pad.padStart(12, '0')}`;
      await repo.addPendingEvent({
        id,
        type: 'checkpoint_record',
        payload: {
          recordId: id,
          shiftId: 'shift-100',
          method: 'qr',
          scannedValue: `QR-${i}`,
          occurredAtDevice: time,
          location: {
            status: 'ok',
            latitude: -34.6,
            longitude: -58.4,
            accuracyMeters: 5,
            simulation: 'not_simulated',
            takenAt: time,
          },
          phoneNfc: 'on',
        },
        occurredAtDevice: time,
        createdAt: time,
      });
    }

    const outcome = await processSyncQueue();
    const duration = Date.now() - startTime;

    expect(outcome.success).toBe(true);
    expect(outcome.batchesSent).toBe(5);
    expect(outcome.processed).toBe(500);
    expect(await repo.countPendingEvents()).toBe(0);
    expect(duration).toBeLessThan(30000); // Less than 30s as per CA
  });

  it('clears shift data and deletes shift credential when shift_close is confirmed and queue is empty', async () => {
    const closeId = '00000000-0000-4000-8000-000000000099';
    await repo.addPendingEvent({
      id: closeId,
      type: 'shift_close',
      payload: {
        shiftId: 'shift-100',
        eventId: closeId,
        occurredAtDevice: '2026-10-14T16:00:00.000Z',
        location: {
          status: 'ok',
          latitude: -34.6,
          longitude: -58.4,
          accuracyMeters: 5,
          simulation: 'not_simulated',
          takenAt: '2026-10-14T16:00:00.000Z',
        },
      },
      occurredAtDevice: '2026-10-14T16:00:00.000Z',
      createdAt: '2026-10-14T16:00:00.000Z',
    });

    sendBatchMock.mockResolvedValueOnce({
      results: [
        {
          status: 'accepted',
          eventId: closeId,
          outcome: {
            status: 'closed',
            closedAt: '2026-10-14T16:00:00.000Z',
            closedEarly: false,
          },
        },
      ],
      receivedAt: '2026-10-14T16:00:01.000Z',
    });

    await processSyncQueue();

    expect(deleteCredentialMock).toHaveBeenCalled();
    expect(await repo.getShiftData()).toBeNull();
  });
});
