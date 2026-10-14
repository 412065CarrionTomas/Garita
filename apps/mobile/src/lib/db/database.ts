import * as SQLite from 'expo-sqlite';
import { z } from 'zod';
import {
  pendingFieldEventSchema,
  shiftOfflineDataSchema,
  type PendingFieldEvent,
  type ShiftOfflineData,
} from '@garita/shared';

export const localCheckpointRecordSchema = z.object({
  recordId: z.string().uuid(),
  shiftId: z.string().min(1),
  checkpointId: z.string().min(1),
  checkpointName: z.string().min(1),
  occurredAtUtc: z.string(),
  countedFor: z.array(
    z.object({
      roundId: z.string(),
      windowIndex: z.number().int(),
      late: z.boolean(),
    }),
  ),
  outOfWindow: z.boolean(),
  serverResult: z.enum(['recorded', 'rejected']).nullable().optional(),
  serverReason: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type LocalCheckpointRecord = z.infer<typeof localCheckpointRecordSchema>;

export interface FieldDatabase {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  replaceShift(data: ShiftOfflineData | null): Promise<void>;
  readShift(): Promise<unknown | null>;
  insertEvent(event: PendingFieldEvent): Promise<void>;
  markEventSent(id: string): Promise<void>;
  markEventRejected(id: string, reason: string): Promise<void>;
  countPendingEvents(): Promise<number>;
  readEvents(limit?: number): Promise<unknown[]>;
  readPendingEvents?(limit?: number): Promise<unknown[]>;
  getSyncMeta?(key: string): Promise<string | null>;
  setSyncMeta?(key: string, value: string): Promise<void>;
  getPendingEventRejectReason?(id: string): Promise<string | null>;
  insertCheckpointRecord(record: LocalCheckpointRecord): Promise<void>;
  readCheckpointRecords(shiftId?: string): Promise<unknown[]>;
  updateCheckpointRecordServerResult(
    recordId: string,
    result: 'recorded' | 'rejected',
    reason?: string | null,
  ): Promise<void>;
}

export interface MigrationDatabase {
  getVersion(): Promise<number>;
  setVersion(version: number): Promise<void>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
}

export async function migrateDatabase(database: MigrationDatabase): Promise<void> {
  const version = await database.getVersion();
  if (version < 1) {
    await database.transaction(async () => {
      await database.exec(
        'CREATE TABLE IF NOT EXISTS current_shift (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)',
      );
      await database.exec(
        'CREATE TABLE IF NOT EXISTS shift_rounds (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      await database.exec(
        'CREATE TABLE IF NOT EXISTS shift_windows (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      await database.exec(
        'CREATE TABLE IF NOT EXISTS shift_checkpoints (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      await database.exec(
        'CREATE TABLE IF NOT EXISTS server_time (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)',
      );
      await database.exec(
        'CREATE TABLE IF NOT EXISTS pending_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, occurred_at_device TEXT NOT NULL, created_at TEXT NOT NULL)',
      );
      await database.setVersion(1);
    });
  }
  if (version < 2) {
    await database.transaction(async () => {
      await database.exec('ALTER TABLE pending_events ADD COLUMN sent INTEGER NOT NULL DEFAULT 0');
      await database.setVersion(2);
    });
  }
  if (version < 3) {
    await database.transaction(async () => {
      await database.exec(
        'CREATE TABLE IF NOT EXISTS checkpoint_records (record_id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, checkpoint_name TEXT NOT NULL, occurred_at_utc TEXT NOT NULL, counted_for TEXT NOT NULL, out_of_window INTEGER NOT NULL DEFAULT 0, server_result TEXT, server_reason TEXT, created_at TEXT NOT NULL)',
      );
      await database.setVersion(3);
    });
  }
  if (version < 4) {
    await database.transaction(async () => {
      await database.exec('ALTER TABLE pending_events ADD COLUMN reject_reason TEXT');
      await database.exec(
        'CREATE INDEX IF NOT EXISTS idx_pending_events_queue ON pending_events (sent, occurred_at_device, created_at)',
      );
      await database.exec(
        'CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      );
      await database.setVersion(4);
    });
  }
}

class ExpoFieldDatabase implements FieldDatabase, MigrationDatabase {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}
  async getVersion(): Promise<number> {
    return this.db
      .getFirstAsync<{ user_version: number }>('PRAGMA user_version')
      .then((row) => row?.user_version ?? 0);
  }
  async setVersion(version: number): Promise<void> {
    await this.db.execAsync(`PRAGMA user_version = ${version}`);
  }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    let result: T;
    await this.db.withTransactionAsync(async () => {
      result = await work();
    });
    return result!;
  }
  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }
  async replaceShift(data: ShiftOfflineData | null): Promise<void> {
    await this.db.runAsync('DELETE FROM current_shift');
    await this.db.runAsync('DELETE FROM shift_rounds');
    await this.db.runAsync('DELETE FROM shift_windows');
    await this.db.runAsync('DELETE FROM shift_checkpoints');
    await this.db.runAsync('DELETE FROM server_time');
    await this.db.runAsync('DELETE FROM checkpoint_records');
    if (!data) return;
    await this.db.runAsync(
      'INSERT INTO current_shift (id, data) VALUES (1, ?)',
      JSON.stringify(data.shift),
    );
    for (const [index, item] of data.rounds.entries())
      await this.db.runAsync(
        'INSERT INTO shift_rounds (id, data) VALUES (?, ?)',
        `${index}:${item.roundId}`,
        JSON.stringify(item),
      );
    for (const [index, item] of data.windows.entries())
      await this.db.runAsync(
        'INSERT INTO shift_windows (id, data) VALUES (?, ?)',
        `${index}:${item.roundId}`,
        JSON.stringify(item),
      );
    for (const item of data.checkpoints)
      await this.db.runAsync(
        'INSERT INTO shift_checkpoints (id, data) VALUES (?, ?)',
        item.id,
        JSON.stringify(item),
      );
    await this.db.runAsync(
      'INSERT INTO server_time (id, data) VALUES (1, ?)',
      JSON.stringify(data.serverTime),
    );
  }
  async readShift(): Promise<unknown | null> {
    const shift = await this.db.getFirstAsync<{ data: string }>(
      'SELECT data FROM current_shift WHERE id = 1',
    );
    if (!shift) return null;
    const [rounds, windows, checkpoints, serverTime] = await Promise.all([
      this.db.getAllAsync<{ data: string }>('SELECT data FROM shift_rounds ORDER BY rowid'),
      this.db.getAllAsync<{ data: string }>('SELECT data FROM shift_windows ORDER BY rowid'),
      this.db.getAllAsync<{ data: string }>('SELECT data FROM shift_checkpoints ORDER BY rowid'),
      this.db.getFirstAsync<{ data: string }>('SELECT data FROM server_time WHERE id = 1'),
    ]);
    if (!serverTime) return null;
    return {
      shift: JSON.parse(shift.data) as unknown,
      rounds: rounds.map((row) => JSON.parse(row.data) as unknown),
      windows: windows.map((row) => JSON.parse(row.data) as unknown),
      checkpoints: checkpoints.map((row) => JSON.parse(row.data) as unknown),
      serverTime: JSON.parse(serverTime.data) as unknown,
    };
  }
  async insertEvent(event: PendingFieldEvent): Promise<void> {
    await this.db.runAsync(
      'INSERT OR IGNORE INTO pending_events (id, type, payload, occurred_at_device, created_at) VALUES (?, ?, ?, ?, ?)',
      event.id,
      event.type,
      JSON.stringify(event.payload),
      event.occurredAtDevice,
      event.createdAt,
    );
  }
  async markEventSent(id: string): Promise<void> {
    await this.db.runAsync('UPDATE pending_events SET sent = 1 WHERE id = ?', id);
  }
  async markEventRejected(id: string, reason: string): Promise<void> {
    await this.db.runAsync('UPDATE pending_events SET reject_reason = ? WHERE id = ?', reason, id);
  }
  async countPendingEvents(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM pending_events WHERE sent = 0 AND reject_reason IS NULL',
    );
    return row?.count ?? 0;
  }
  async readEvents(limit?: number): Promise<unknown[]> {
    const query =
      limit !== undefined && limit > 0
        ? `SELECT id, type, payload, occurred_at_device, created_at FROM pending_events WHERE sent = 0 AND reject_reason IS NULL ORDER BY occurred_at_device ASC, created_at ASC LIMIT ${Math.floor(limit)}`
        : 'SELECT id, type, payload, occurred_at_device, created_at FROM pending_events WHERE sent = 0 AND reject_reason IS NULL ORDER BY occurred_at_device ASC, created_at ASC';
    return (
      await this.db.getAllAsync<{
        id: string;
        type: string;
        payload: string;
        occurred_at_device: string;
        created_at: string;
      }>(query)
    ).map((row) => ({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload) as unknown,
      occurredAtDevice: row.occurred_at_device,
      createdAt: row.created_at,
    }));
  }
  async readPendingEvents(limit?: number): Promise<unknown[]> {
    return this.readEvents(limit);
  }
  async getSyncMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_state WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  }
  async setSyncMeta(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)',
      key,
      value,
    );
  }
  async getPendingEventRejectReason(id: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ reject_reason: string | null }>(
      'SELECT reject_reason FROM pending_events WHERE id = ?',
      id,
    );
    return row?.reject_reason ?? null;
  }
  async insertCheckpointRecord(record: LocalCheckpointRecord): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO checkpoint_records (record_id, shift_id, checkpoint_id, checkpoint_name, occurred_at_utc, counted_for, out_of_window, server_result, server_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      record.recordId,
      record.shiftId,
      record.checkpointId,
      record.checkpointName,
      record.occurredAtUtc,
      JSON.stringify(record.countedFor),
      record.outOfWindow ? 1 : 0,
      record.serverResult ?? null,
      record.serverReason ?? null,
      record.createdAt,
    );
  }
  async readCheckpointRecords(shiftId?: string): Promise<unknown[]> {
    const query = shiftId
      ? 'SELECT record_id, shift_id, checkpoint_id, checkpoint_name, occurred_at_utc, counted_for, out_of_window, server_result, server_reason, created_at FROM checkpoint_records WHERE shift_id = ? ORDER BY occurred_at_utc ASC'
      : 'SELECT record_id, shift_id, checkpoint_id, checkpoint_name, occurred_at_utc, counted_for, out_of_window, server_result, server_reason, created_at FROM checkpoint_records ORDER BY occurred_at_utc ASC';
    const params = shiftId ? [shiftId] : [];
    const rows = await this.db.getAllAsync<{
      record_id: string;
      shift_id: string;
      checkpoint_id: string;
      checkpoint_name: string;
      occurred_at_utc: string;
      counted_for: string;
      out_of_window: number;
      server_result: string | null;
      server_reason: string | null;
      created_at: string;
    }>(query, ...params);
    return rows.map((row) => ({
      recordId: row.record_id,
      shiftId: row.shift_id,
      checkpointId: row.checkpoint_id,
      checkpointName: row.checkpoint_name,
      occurredAtUtc: row.occurred_at_utc,
      countedFor: JSON.parse(row.counted_for) as unknown,
      outOfWindow: Boolean(row.out_of_window),
      serverResult: row.server_result as 'recorded' | 'rejected' | null,
      serverReason: row.server_reason,
      createdAt: row.created_at,
    }));
  }
  async updateCheckpointRecordServerResult(
    recordId: string,
    result: 'recorded' | 'rejected',
    reason?: string | null,
  ): Promise<void> {
    await this.db.runAsync(
      'UPDATE checkpoint_records SET server_result = ?, server_reason = ? WHERE record_id = ?',
      result,
      reason ?? null,
      recordId,
    );
  }
}

let databasePromise: Promise<ExpoFieldDatabase> | undefined;
export async function openFieldDatabase(): Promise<FieldDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync('garita-field.db').then(async (db) => {
    const adapter = new ExpoFieldDatabase(db);
    await migrateDatabase(adapter);
    return adapter;
  });
  return databasePromise;
}

export function createFieldRepository(database: FieldDatabase) {
  return {
    async saveShiftData(input: unknown): Promise<ShiftOfflineData> {
      const data = shiftOfflineDataSchema.parse(input);
      await database.transaction(() => database.replaceShift(data));
      return data;
    },
    async getShiftData(): Promise<ShiftOfflineData | null> {
      const data = await database.readShift();
      return data === null ? null : shiftOfflineDataSchema.parse(data);
    },
    async clearShiftData(): Promise<void> {
      await database.transaction(() => database.replaceShift(null));
    },
    async addPendingEvent(input: unknown): Promise<void> {
      const event = pendingFieldEventSchema.parse(input);
      await database.insertEvent(event);
    },
    async listPendingEvents(options?: { limit?: number }): Promise<PendingFieldEvent[]> {
      const rows = database.readPendingEvents
        ? await database.readPendingEvents(options?.limit)
        : await database.readEvents(options?.limit);
      return rows.map((event) => pendingFieldEventSchema.parse(event));
    },
    async markPendingEventSent(id: string): Promise<void> {
      await database.markEventSent(id);
    },
    async markPendingEventRejected(id: string, reason: string): Promise<void> {
      if (database.markEventRejected) {
        await database.markEventRejected(id, reason);
      }
    },
    async countPendingEvents(): Promise<number> {
      if (database.countPendingEvents) {
        return database.countPendingEvents();
      }
      return (await database.readEvents()).length;
    },
    async getSyncMeta(key: string): Promise<string | null> {
      if (database.getSyncMeta) {
        return database.getSyncMeta(key);
      }
      return null;
    },
    async setSyncMeta(key: string, value: string): Promise<void> {
      if (database.setSyncMeta) {
        await database.setSyncMeta(key, value);
      }
    },
    async getPendingEventRejectReason(id: string): Promise<string | null> {
      if (database.getPendingEventRejectReason) {
        return database.getPendingEventRejectReason(id);
      }
      return null;
    },
    async saveCheckpointRecord(input: unknown): Promise<LocalCheckpointRecord> {
      const record = localCheckpointRecordSchema.parse(input);
      await database.insertCheckpointRecord(record);
      return record;
    },
    async listCheckpointRecords(shiftId?: string): Promise<LocalCheckpointRecord[]> {
      const records = await database.readCheckpointRecords(shiftId);
      return records.map((record) => localCheckpointRecordSchema.parse(record));
    },
    async updateCheckpointRecordServerResult(
      recordId: string,
      result: 'recorded' | 'rejected',
      reason?: string | null,
    ): Promise<void> {
      await database.updateCheckpointRecordServerResult(recordId, result, reason);
    },
  };
}

export type FieldRepository = ReturnType<typeof createFieldRepository>;

export async function createDefaultFieldRepository() {
  return createFieldRepository(await openFieldDatabase());
}
