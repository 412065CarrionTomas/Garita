import type * as SQLite from 'expo-sqlite';
import { readClock, saveTimeReference, prepareEventClocks } from '@/lib/clock/clock';
import GaritaNative from '../../../modules/garita-native/src';
import { createFieldRepository, ExpoFieldDatabase, migrateDatabase } from './database';

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
}

interface RawSqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

declare const require: (module: string) => {
  DatabaseSync: new (path: string) => RawSqliteDatabase;
};
const { DatabaseSync } = require('node:sqlite');

function createNodeSqliteExpoAdapter(): {
  adapter: SQLite.SQLiteDatabase;
  rawDb: RawSqliteDatabase;
} {
  const rawDb = new DatabaseSync(':memory:');

  const adapter = {
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const stmt = rawDb.prepare(sql);
      const row = stmt.get(...params);
      return (row as T) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const stmt = rawDb.prepare(sql);
      const rows = stmt.all(...params);
      return rows as T[];
    },
    async runAsync(sql: string, ...params: unknown[]): Promise<SQLite.SQLiteRunResult> {
      const stmt = rawDb.prepare(sql);
      const result = stmt.run(...params);
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      };
    },
    async execAsync(sql: string): Promise<void> {
      rawDb.exec(sql);
    },
    async withTransactionAsync<T>(work: () => Promise<T>): Promise<T> {
      rawDb.exec('BEGIN TRANSACTION');
      try {
        const result = await work();
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    },
  } as unknown as SQLite.SQLiteDatabase;

  return { adapter, rawDb };
}

describe('ExpoFieldDatabase with real SQLite engine (H-5)', () => {
  it('HU-14: persists boot references and recalculated payload across repository reopen, preserves insertion order after wall-clock rollback', async () => {
    const { adapter } = createNodeSqliteExpoAdapter();
    const database = new ExpoFieldDatabase(adapter);
    await migrateDatabase(database);
    const repo = createFieldRepository(database);
    jest
      .mocked(GaritaNative.getMonotonicClock)
      .mockResolvedValue({ elapsedMs: 1000, bootId: 'boot-a' });
    await saveTimeReference(repo, '2026-10-19T01:00:00.000Z');
    const reopened = createFieldRepository(new ExpoFieldDatabase(adapter));
    expect((await readClock(reopened, '2026-10-19T04:00:00.000Z')).trustedAt).toBe(
      '2026-10-19T01:00:00.000Z',
    );
    jest
      .mocked(GaritaNative.getMonotonicClock)
      .mockResolvedValue({ elapsedMs: 0, bootId: 'boot-b' });
    const clock = await readClock(reopened, '2026-10-19T00:00:00.000Z');
    expect(clock.timeStatus).toBe('pending');
    const recordId = '00000000-0000-4000-8000-000000000001';
    const closeId = '00000000-0000-4000-8000-000000000002';
    await reopened.addPendingEvent({
      id: recordId,
      type: 'checkpoint_record',
      payload: { clock },
      occurredAtDevice: '2026-10-19T04:00:00.000Z',
      createdAt: clock.deviceTime,
    });
    await reopened.addPendingEvent({
      id: closeId,
      type: 'shift_close',
      payload: {},
      occurredAtDevice: clock.deviceTime,
      createdAt: clock.deviceTime,
    });
    await saveTimeReference(reopened, '2026-10-19T02:00:00.000Z');
    const events = await reopened.listPendingEvents();
    expect(events.map(({ id }) => id)).toEqual([recordId, closeId]);
    await prepareEventClocks(reopened, events);
    const restored = await createFieldRepository(
      new ExpoFieldDatabase(adapter),
    ).listPendingEvents();
    expect(restored[0]?.payload).toMatchObject({
      clock: {
        timeStatus: 'recalculated',
        trustedAt: '2026-10-19T02:00:00.000Z',
        referenceOffsetMs: expect.any(Number),
      },
    });
    jest
      .mocked(GaritaNative.getMonotonicClock)
      .mockResolvedValue({ elapsedMs: 1000, bootId: 'test-boot' });
  });
  it('executes real migrations 1 to 6, creates tables, indexes, and upgrades version to 6', async () => {
    const { adapter, rawDb } = createNodeSqliteExpoAdapter();
    const db = new ExpoFieldDatabase(adapter);

    expect(await db.getVersion()).toBe(0);
    await migrateDatabase(db);
    expect(await db.getVersion()).toBe(6);

    // Verify tables exist in SQLite
    const tables = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('current_shift');
    expect(tableNames).toContain('shift_rounds');
    expect(tableNames).toContain('shift_windows');
    expect(tableNames).toContain('shift_checkpoints');
    expect(tableNames).toContain('server_time');
    expect(tableNames).toContain('pending_events');
    expect(tableNames).toContain('checkpoint_records');
    expect(tableNames).toContain('sync_state');
    expect(tableNames).toContain('incident_photos');

    // Verify index exists
    const indexes = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as {
      name: string;
    }[];
    expect(indexes.map((i) => i.name)).toContain('idx_pending_events_queue');

    // Verify column reject_reason in pending_events
    const cols = rawDb.prepare('PRAGMA table_info(pending_events)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('reject_reason');

    const repo = createFieldRepository(db);
    const incidentId = '0199c2c6-958d-7a4a-9f4f-f2ca1b852044';
    await repo.addPendingEvent({
      id: incidentId,
      type: 'incident',
      payload: {},
      occurredAtDevice: '2026-10-13T10:00:00.000Z',
      createdAt: '2026-10-13T10:00:00.000Z',
    });
    await repo.addIncidentPhoto({
      photoId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852043',
      incidentId,
      uri: 'file:///incident/photo.jpg',
      attempts: 0,
      nextAttemptAt: null,
    });
    await expect(repo.listIncidentPhotos()).resolves.toEqual([]);
    await repo.markPendingEventSent(incidentId);
    await expect(repo.listIncidentPhotos()).resolves.toMatchObject([{ incidentId }]);
  });

  it('migration 5 converts existing invalid_scan_attempt to checkpoint_record in real SQLite', async () => {
    const { adapter, rawDb } = createNodeSqliteExpoAdapter();
    const db = new ExpoFieldDatabase(adapter);

    // Run up to version 4
    await db.exec('PRAGMA user_version = 0');
    await migrateDatabase(db);

    // Simulate an existing invalid_scan_attempt before migration 5
    rawDb.exec(`
      INSERT INTO pending_events (id, type, payload, occurred_at_device, created_at, sent)
      VALUES ('00000000-0000-4000-8000-000000000001', 'invalid_scan_attempt', '{}', '2026-10-14T10:00:00.000Z', '2026-10-14T10:00:00.000Z', 0)
    `);

    // Reset user_version to 4 to test step 5
    rawDb.exec('PRAGMA user_version = 4');
    await migrateDatabase(db);
    expect(await db.getVersion()).toBe(6);

    const row = rawDb
      .prepare("SELECT type FROM pending_events WHERE id = '00000000-0000-4000-8000-000000000001'")
      .get() as {
      type: string;
    };
    expect(row.type).toBe('checkpoint_record');
  });

  it('verifies EXPLAIN QUERY PLAN uses idx_pending_events_queue index and handles 5,000 events efficiently', async () => {
    const { adapter, rawDb } = createNodeSqliteExpoAdapter();
    const db = new ExpoFieldDatabase(adapter);
    await migrateDatabase(db);
    const repo = createFieldRepository(db);

    // Check EXPLAIN QUERY PLAN
    const explain = rawDb
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id, type, payload, occurred_at_device, created_at FROM pending_events WHERE sent = 0 AND reject_reason IS NULL AND type IN ('checkpoint_record', 'shift_close', 'incident') ORDER BY rowid ASC LIMIT 100",
      )
      .all() as { detail: string }[];
    const details = explain.map((e) => e.detail).join('; ');
    expect(details).toMatch(/idx_pending_events_queue/);

    // Insert 5,000 events in a transaction
    rawDb.exec('BEGIN TRANSACTION');
    const insertStmt = rawDb.prepare(
      'INSERT INTO pending_events (id, type, payload, occurred_at_device, created_at, sent) VALUES (?, ?, ?, ?, ?, 0)',
    );
    for (let i = 1; i <= 5000; i++) {
      const pad = String(i).padStart(12, '0');
      const timeSec = String(i % 60).padStart(2, '0');
      const timeMin = String(Math.floor((i / 60) % 60)).padStart(2, '0');
      const timeHour = String(Math.floor(i / 3600)).padStart(2, '0');
      const isoTime = `2026-10-14T${timeHour}:${timeMin}:${timeSec}.000Z`;
      insertStmt.run(
        `00000000-0000-4000-8000-${pad}`,
        'checkpoint_record',
        JSON.stringify({ recordId: `00000000-0000-4000-8000-${pad}` }),
        isoTime,
        isoTime,
      );
    }
    rawDb.exec('COMMIT');

    const startCount = Date.now();
    const count = await repo.countPendingEvents();
    const countDuration = Date.now() - startCount;
    expect(count).toBe(5000);
    expect(countDuration).toBeLessThan(100);

    const startRead = Date.now();
    const batch = await repo.listPendingEvents({ limit: 100 });
    const readDuration = Date.now() - startRead;
    expect(batch).toHaveLength(100);
    expect(readDuration).toBeLessThan(50);
    expect(batch[0]?.id).toBe('00000000-0000-4000-8000-000000000001');

    // Mark one rejected: should discount from count and be excluded from next batch
    await repo.markPendingEventRejected('00000000-0000-4000-8000-000000000001', 'invalid_data');
    expect(await repo.countPendingEvents()).toBe(4999);
    expect(await repo.getPendingEventRejectReason('00000000-0000-4000-8000-000000000001')).toBe(
      'invalid_data',
    );

    const nextBatch = await repo.listPendingEvents({ limit: 100 });
    expect(nextBatch).toHaveLength(100);
    expect(nextBatch[0]?.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(await repo.isPendingEventConfirmed('00000000-0000-4000-8000-000000000002')).toBe(false);
    expect(await repo.isPendingEventConfirmed('00000000-0000-4000-8000-000000000001')).toBe(false);
    await repo.markPendingEventSent('00000000-0000-4000-8000-000000000002');
    expect(await repo.isPendingEventConfirmed('00000000-0000-4000-8000-000000000002')).toBe(true);
  });

  it('manages sync_state meta, shift data, and checkpoint_records accurately in SQLite', async () => {
    const { adapter } = createNodeSqliteExpoAdapter();
    const db = new ExpoFieldDatabase(adapter);
    await migrateDatabase(db);
    const repo = createFieldRepository(db);

    // Sync meta
    await repo.setSyncMeta('synced_until', '2026-10-14T12:00:00.000Z');
    expect(await repo.getSyncMeta('synced_until')).toBe('2026-10-14T12:00:00.000Z');
    expect(await repo.getSyncMeta('last_sync_at')).toBeNull();

    // Checkpoint records
    await repo.saveCheckpointRecord({
      recordId: '00000000-0000-4000-8000-000000000001',
      shiftId: 'shift-1',
      checkpointId: 'cp-1',
      checkpointName: 'Punto 1',
      occurredAtUtc: '2026-10-14T12:00:00.000Z',
      countedFor: [{ roundId: 'r-1', windowIndex: 0, late: false }],
      outOfWindow: false,
      serverResult: null,
      serverReason: null,
      createdAt: '2026-10-14T12:00:01.000Z',
    });

    const records = await repo.listCheckpointRecords('shift-1');
    expect(records).toHaveLength(1);
    expect(records[0]?.checkpointName).toBe('Punto 1');

    await repo.updateCheckpointRecordServerResult(
      '00000000-0000-4000-8000-000000000001',
      'recorded',
    );
    const updated = await repo.listCheckpointRecords('shift-1');
    expect(updated[0]?.serverResult).toBe('recorded');

    // Clear shift data clears checkpoint records
    await repo.clearShiftData();
    expect(await repo.listCheckpointRecords('shift-1')).toEqual([]);
    expect(await repo.getShiftData()).toBeNull();
  });
});
