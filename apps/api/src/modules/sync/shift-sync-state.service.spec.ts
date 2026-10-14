import { ShiftSyncStateService } from './shift-sync-state.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Clock } from '../../common/clock';

describe('ShiftSyncStateService', () => {
  const fixedNow = new Date('2026-10-14T12:00:00.000Z');
  let clock: Clock;
  let prisma: PrismaService;
  let service: ShiftSyncStateService;
  let syncStates: Map<string, any>;
  let notices: any[];

  beforeEach(() => {
    syncStates = new Map();
    notices = [];

    clock = { now: () => fixedNow };
    prisma = {
      systemPrisma: {
        shiftSyncState: {
          findUnique: jest.fn(async ({ where }) => syncStates.get(where.shiftId) ?? null),
          findMany: jest.fn(async ({ where }) => {
            const ids: string[] = where?.shiftId?.in ?? [];
            return ids.map((id) => syncStates.get(id)).filter(Boolean);
          }),
          upsert: jest.fn(async ({ where, create, update }) => {
            const existing = syncStates.get(where.shiftId);
            if (existing) {
              const updated = { ...existing, ...update };
              syncStates.set(where.shiftId, updated);
              return updated;
            }
            syncStates.set(where.shiftId, create);
            return create;
          }),
        },
        connectionNotice: {
          create: jest.fn(async ({ data }) => {
            notices.push(data);
            return { id: 'notice-1', ...data };
          }),
        },
      },
    } as unknown as PrismaService;

    service = new ShiftSyncStateService(prisma, clock);
  });

  describe('avance monótono de syncedUntil', () => {
    it('establece syncedUntil inicial si antes era null', async () => {
      const t1 = new Date('2026-10-14T10:00:00.000Z');
      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 5,
        syncedUntil: t1,
        contactAt: fixedNow,
        isBatch: false,
      });

      const state = syncStates.get('shift-1');
      expect(state.syncedUntil).toEqual(t1);
      expect(state.lastPendingCount).toBe(5);
    });

    it('avanza syncedUntil si el nuevo valor es posterior al actual', async () => {
      const t1 = new Date('2026-10-14T10:00:00.000Z');
      const t2 = new Date('2026-10-14T11:00:00.000Z');

      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 5,
        syncedUntil: t1,
        contactAt: fixedNow,
        isBatch: false,
      });

      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 2,
        syncedUntil: t2,
        contactAt: fixedNow,
        isBatch: true,
      });

      const state = syncStates.get('shift-1');
      expect(state.syncedUntil).toEqual(t2);
      expect(state.lastPendingCount).toBe(2);
      expect(state.lastBatchAt).toEqual(fixedNow);
    });

    it('no retrocede syncedUntil si el nuevo valor es anterior', async () => {
      const t1 = new Date('2026-10-14T11:00:00.000Z');
      const tEarlier = new Date('2026-10-14T09:00:00.000Z');

      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 5,
        syncedUntil: t1,
        contactAt: fixedNow,
        isBatch: false,
      });

      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 3,
        syncedUntil: tEarlier,
        contactAt: fixedNow,
        isBatch: false,
      });

      const state = syncStates.get('shift-1');
      expect(state.syncedUntil).toEqual(t1);
      expect(state.lastPendingCount).toBe(3);
    });

    it('no retrocede syncedUntil si el nuevo valor es null', async () => {
      const t1 = new Date('2026-10-14T11:00:00.000Z');

      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 5,
        syncedUntil: t1,
        contactAt: fixedNow,
        isBatch: false,
      });

      await service.updateSyncState({
        companyId: 'company-1',
        shiftId: 'shift-1',
        pendingCount: 0,
        syncedUntil: null,
        contactAt: fixedNow,
        isBatch: false,
      });

      const state = syncStates.get('shift-1');
      expect(state.syncedUntil).toEqual(t1);
      expect(state.lastPendingCount).toBe(0);
    });
  });

  describe('recordNotice', () => {
    it('guarda aviso de conexión y actualiza el estado', async () => {
      const result = await service.recordNotice('company-1', 'shift-1', {
        shiftId: 'shift-1',
        sentAtDevice: '2026-10-14T11:59:00.000Z',
        pendingCount: 4,
        syncedUntil: '2026-10-14T11:30:00.000Z',
      });

      expect(result).toEqual({ receivedAt: fixedNow.toISOString() });
      expect(notices).toHaveLength(1);
      expect(notices[0].pendingCount).toBe(4);
      expect(syncStates.get('shift-1').lastPendingCount).toBe(4);
    });
  });

  describe('getForShifts', () => {
    it('retorna los estados de sincronización para los IDs indicados', async () => {
      syncStates.set('s-1', { shiftId: 's-1', lastPendingCount: 2 });
      syncStates.set('s-2', { shiftId: 's-2', lastPendingCount: 0 });

      const result = await service.getForShifts(['s-1', 's-2', 's-3']);
      expect(result).toHaveLength(2);
      expect(result.map((r: any) => r.shiftId)).toEqual(['s-1', 's-2']);
    });
  });
});
