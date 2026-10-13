import type { PendingFieldEvent, ShiftOfflineData } from '@garita/shared';
import {
  createFieldRepository,
  migrateDatabase,
  type FieldDatabase,
  type MigrationDatabase,
} from './database';

class MemoryDatabase implements FieldDatabase, MigrationDatabase {
  version = 0;
  shift: unknown | null = null;
  events: PendingFieldEvent[] = [];
  tables: string[] = [];
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
  }
  async readShift() {
    return this.shift;
  }
  async insertEvent(event: PendingFieldEvent) {
    this.events.push(event);
  }
  async readEvents() {
    return this.events;
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
    expect(fresh.version).toBe(1);
    expect(fresh.tables).toHaveLength(6);
    const prior = new MemoryDatabase();
    prior.version = 0;
    await migrateDatabase(prior);
    expect(prior.version).toBe(1);
    await migrateDatabase(prior);
    expect(prior.tables).toHaveLength(6);
  });
  it('saves, reopens, replaces, clears, and validates pending events', async () => {
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
      type: 'shift_start',
      payload: {},
      occurredAtDevice: '2026-10-13T10:00:00.000Z',
      createdAt: '2026-10-13T10:00:01.000Z',
    };
    await reopenedApp.addPendingEvent(event);
    await expect(reopenedApp.listPendingEvents()).resolves.toEqual([event]);
    await expect(reopenedApp.addPendingEvent({ ...event, id: 'bad' })).rejects.toThrow();
    await reopenedApp.clearShiftData();
    await expect(reopenedApp.getShiftData()).resolves.toBeNull();
  });
});
