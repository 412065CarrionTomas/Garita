import type { PendingFieldEvent, ShiftOfflineData } from '@garita/shared';
import {
  createFieldRepository,
  migrateDatabase,
  type FieldDatabase,
  type LocalCheckpointRecord,
  type MigrationDatabase,
} from './database';

class MemoryDatabase implements FieldDatabase, MigrationDatabase {
  version = 0;
  shift: unknown | null = null;
  events: PendingFieldEvent[] = [];
  sent = new Set<string>();
  rejected = new Map<string, string>();
  records: LocalCheckpointRecord[] = [];
  tables: string[] = [];
  meta = new Map<string, string>();
  async getVersion() {
    return this.version;
  }
  async setVersion(version: number) {
    this.version = version;
  }
  async exec(sql: string) {
    this.tables.push(sql);
  }
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
    const existingIndex = this.records.findIndex((r) => r.recordId === record.recordId);
    if (existingIndex >= 0) {
      this.records[existingIndex] = record;
    } else {
      this.records.push(record);
    }
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
const shift = {
  shift: {
    id: 'shift',
    siteId: 'site',
    siteName: 'Predio',
    startsAt: '2026-10-13T10:00:00.000Z',
    endsAt: '2026-10-13T18:00:00.000Z',
    timezone: 'UTC',
    assignmentId: 'assignment',
  },
  rounds: [],
  windows: [],
  checkpoints: [],
  serverTime: { serverNowUtc: '2026-10-13T10:00:00.000Z' },
} satisfies ShiftOfflineData;

describe('field database', () => {
  it('migrates an empty database and upgrades the previous version', async () => {
    const fresh = new MemoryDatabase();
    await migrateDatabase(fresh);
    expect(fresh.version).toBe(5);
    expect(fresh.tables).toHaveLength(12);
    const prior = new MemoryDatabase();
    prior.version = 0;
    await migrateDatabase(prior);
    expect(prior.version).toBe(5);
    await migrateDatabase(prior);
    expect(prior.tables).toHaveLength(12);
  });
  it('saves, reopens, replaces, clears, and validates pending events and checkpoint records', async () => {
    const disk = new MemoryDatabase();
    const firstApp = createFieldRepository(disk);
    await firstApp.saveShiftData(shift);
    const reopenedApp = createFieldRepository(disk);
    await expect(reopenedApp.getShiftData()).resolves.toEqual(shift);
    const replacement = { ...shift, shift: { ...shift.shift, id: 'next' } };
    await reopenedApp.saveShiftData(replacement);
    await expect(firstApp.getShiftData()).resolves.toEqual(replacement);
    const event = {
      id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      type: 'checkpoint_record',
      payload: {},
      occurredAtDevice: '2026-10-13T10:00:00.000Z',
      createdAt: '2026-10-13T10:00:01.000Z',
    };
    await reopenedApp.addPendingEvent(event);
    await expect(reopenedApp.listPendingEvents()).resolves.toEqual([event]);
    expect(await reopenedApp.countPendingEvents()).toBe(1);

    // Event rejection test
    const rejectedEvent = {
      id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852042',
      type: 'checkpoint_record',
      payload: {},
      occurredAtDevice: '2026-10-13T10:01:00.000Z',
      createdAt: '2026-10-13T10:01:01.000Z',
    };
    await reopenedApp.addPendingEvent(rejectedEvent);
    expect(await reopenedApp.countPendingEvents()).toBe(2);
    await reopenedApp.markPendingEventRejected(rejectedEvent.id, 'invalid_data');
    expect(await reopenedApp.getPendingEventRejectReason(rejectedEvent.id)).toBe('invalid_data');
    expect(await reopenedApp.countPendingEvents()).toBe(1);
    await expect(reopenedApp.listPendingEvents()).resolves.toEqual([event]);

    // Sync meta test
    await reopenedApp.setSyncMeta('synced_until', '2026-10-13T10:00:00.000Z');
    expect(await reopenedApp.getSyncMeta('synced_until')).toBe('2026-10-13T10:00:00.000Z');
    expect(await reopenedApp.getSyncMeta('non_existent')).toBeNull();

    await reopenedApp.markPendingEventSent(event.id);
    await expect(reopenedApp.listPendingEvents()).resolves.toEqual([]);
    expect(await reopenedApp.countPendingEvents()).toBe(0);
    await expect(reopenedApp.addPendingEvent({ ...event, id: 'bad' })).rejects.toThrow();

    // Checkpoint records
    const record = {
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852041',
      shiftId: 'next',
      checkpointId: 'cp-1',
      checkpointName: 'Portón trasero',
      occurredAtUtc: '2026-10-13T10:05:00.000Z',
      countedFor: [{ roundId: 'r-1', windowIndex: 0, late: false }],
      outOfWindow: false,
      createdAt: '2026-10-13T10:05:01.000Z',
    };
    await reopenedApp.saveCheckpointRecord(record);
    await expect(reopenedApp.listCheckpointRecords('next')).resolves.toEqual([
      expect.objectContaining({ recordId: record.recordId, checkpointName: 'Portón trasero' }),
    ]);
    await reopenedApp.updateCheckpointRecordServerResult(
      record.recordId,
      'rejected',
      'outdated_version',
    );
    const updated = await reopenedApp.listCheckpointRecords('next');
    expect(updated[0]?.serverResult).toBe('rejected');
    expect(updated[0]?.serverReason).toBe('outdated_version');

    await reopenedApp.clearShiftData();
    await expect(reopenedApp.getShiftData()).resolves.toBeNull();
    await expect(reopenedApp.listCheckpointRecords('next')).resolves.toEqual([]);
  });

  it('migration 5 and syncable types: converts invalid_scan_attempt and counts only syncable types', async () => {
    const db = new MemoryDatabase();
    db.version = 4;
    await migrateDatabase(db);
    expect(db.version).toBe(5);
    expect(
      db.tables.some((sql) => sql.includes("UPDATE pending_events SET type = 'checkpoint_record'")),
    ).toBe(true);

    const repo = createFieldRepository(db);
    // Add invalid_scan_attempt directly to events
    db.events.push({
      id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852099',
      type: 'invalid_scan_attempt',
      payload: {},
      occurredAtDevice: '2026-10-13T10:00:00.000Z',
      createdAt: '2026-10-13T10:00:00.000Z',
    });
    // Add a valid checkpoint_record
    await repo.addPendingEvent({
      id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852098',
      type: 'checkpoint_record',
      payload: {},
      occurredAtDevice: '2026-10-13T10:01:00.000Z',
      createdAt: '2026-10-13T10:01:00.000Z',
    });

    // countPendingEvents should only count the 1 checkpoint_record, NOT the invalid_scan_attempt
    expect(await repo.countPendingEvents()).toBe(1);
    const pending = await repo.listPendingEvents();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('0199c2c6-958d-7a4a-9f4f-f2ca1b852098');
  });
});
