import * as SQLite from 'expo-sqlite';
import {
  pendingFieldEventSchema,
  shiftOfflineDataSchema,
  type PendingFieldEvent,
  type ShiftOfflineData,
} from '@garita/shared';

export interface FieldDatabase {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  replaceShift(data: ShiftOfflineData | null): Promise<void>;
  readShift(): Promise<unknown | null>;
  insertEvent(event: PendingFieldEvent): Promise<void>;
  readEvents(): Promise<unknown[]>;
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
  async readEvents(): Promise<unknown[]> {
    return (
      await this.db.getAllAsync<{
        id: string;
        type: string;
        payload: string;
        occurred_at_device: string;
        created_at: string;
      }>('SELECT * FROM pending_events ORDER BY created_at')
    ).map((row) => ({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload) as unknown,
      occurredAtDevice: row.occurred_at_device,
      createdAt: row.created_at,
    }));
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
    async listPendingEvents(): Promise<PendingFieldEvent[]> {
      return (await database.readEvents()).map((event) => pendingFieldEventSchema.parse(event));
    },
  };
}

export async function createDefaultFieldRepository() {
  return createFieldRepository(await openFieldDatabase());
}
