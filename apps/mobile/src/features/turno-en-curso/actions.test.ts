import { SHIFT_EXECUTION_ERROR_CODES, type ShiftOfflineData } from '@garita/shared';
import { ShiftExecutionApiError } from './api';
import {
  beginShift,
  finishShift,
  resetShiftActionsForTesting,
  setShiftActionsForTesting,
} from './actions';

const shiftData: ShiftOfflineData = {
  shift: {
    id: 'shift-1',
    siteId: 'site-1',
    siteName: 'Predio',
    startsAt: '2030-01-01T22:00:00.000Z',
    endsAt: '2030-01-02T06:00:00.000Z',
    timezone: 'UTC',
    assignmentId: 'assignment-1',
  },
  rounds: [
    {
      roundId: 'round-1',
      roundVersionId: 'version-1',
      name: 'Perimetral',
      frequencyMinutes: 60,
      windowStartLocal: '00:00',
      windowEndLocal: '01:00',
      graceMinutes: 5,
      checkpointIds: ['point-1'],
    },
  ],
  windows: [
    {
      roundId: 'round-1',
      index: 0,
      startUtc: '2030-01-01T22:00:00.000Z',
      endUtc: '2030-01-02T00:00:00.000Z',
      label: '22:00–00:00',
    },
  ],
  checkpoints: [{ id: 'point-1', name: 'Entrada', qrVersion: 1, nfcUid: null, isIndoor: false }],
  serverTime: { serverNowUtc: '2030-01-01T22:00:00.000Z' },
};

const repo = {
  saveShiftData: jest.fn(async () => shiftData),
  getShiftData: jest.fn(async () => shiftData),
  clearShiftData: jest.fn(async () => undefined),
  addPendingEvent: jest.fn(async (_event: unknown) => undefined),
  listPendingEvents: jest.fn(async (_options?: { limit?: number }) => []),
  isPendingEventConfirmed: jest.fn(async () => false),
  markPendingEventSent: jest.fn(async () => undefined),
  saveCheckpointRecord: jest.fn(async (rec) => rec as never),
  listCheckpointRecords: jest.fn(async () => []),
  updateCheckpointRecordServerResult: jest.fn(async () => undefined),
};
const start = jest.fn(async () => ({
  status: 'in_progress' as const,
  startedAt: '2030-01-01T22:00:00.000Z',
  lateStartMinutes: null,
  data: shiftData,
}));
const close = jest.fn(async () => ({
  status: 'closed' as const,
  closedAt: '2030-01-02T04:00:00.000Z',
  closedEarly: true,
}));
const redirectToPermissions = jest.fn();
const saveCredential = jest.fn(async () => undefined);
const deleteCredential = jest.fn(async () => undefined);
const triggerSync = jest.fn(async () => undefined);

function setup(overrides: Parameters<typeof setShiftActionsForTesting>[0] = {}) {
  jest.clearAllMocks();
  setShiftActionsForTesting({
    now: () => new Date('2030-01-01T22:00:00.000Z'),
    online: async () => true,
    permissions: async () => 'ok',
    location: async () => ({
      status: 'ok',
      latitude: -34,
      longitude: -58,
      accuracyMeters: 5,
      simulation: 'not_simulated',
      takenAt: '2030-01-01T22:00:00.000Z',
    }),
    uuid: () => '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    start,
    close,
    repository: async () => repo as never,
    redirectToPermissions,
    saveCredential,
    deleteCredential,
    triggerSync,
    ...overrides,
  });
}

describe('shift execution actions', () => {
  afterEach(resetShiftActionsForTesting);

  it('blocks start without connection and does not call the API', async () => {
    setup({ online: async () => false });
    await expect(
      beginShift('shift-1', shiftData.shift.startsAt, shiftData.shift.endsAt),
    ).resolves.toMatchObject({
      status: 'error',
      message: 'Necesitás conexión para iniciar el turno',
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('redirects when permissions are missing and never starts', async () => {
    setup({ permissions: async () => 'location_approximate' });
    await expect(
      beginShift('shift-1', shiftData.shift.startsAt, shiftData.shift.endsAt),
    ).resolves.toMatchObject({ status: 'permissions', permission: 'location_approximate' });
    expect(redirectToPermissions).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('starts online, validates and saves the offline shift data and credential', async () => {
    const cred = { token: 'tok-123', expiresAt: '2030-01-08T22:00:00.000Z' };
    setup({
      start: jest.fn(async () => ({
        status: 'in_progress' as const,
        startedAt: '2030-01-01T22:00:00.000Z',
        lateStartMinutes: null,
        data: shiftData,
        credential: cred,
      })),
    });
    await expect(
      beginShift('shift-1', shiftData.shift.startsAt, shiftData.shift.endsAt),
    ).resolves.toMatchObject({ status: 'started', data: shiftData, late: false });
    expect(repo.saveShiftData).toHaveBeenCalledWith(shiftData);
    expect(saveCredential).toHaveBeenCalledWith(cred);
  });

  it('maps reassigned and outside-margin errors and checks the local margin', async () => {
    setup({
      start: jest
        .fn()
        .mockRejectedValue(new ShiftExecutionApiError(SHIFT_EXECUTION_ERROR_CODES.reassigned)),
    });
    await expect(
      beginShift('shift-1', shiftData.shift.startsAt, shiftData.shift.endsAt),
    ).resolves.toMatchObject({
      status: 'error',
      message: 'Tu turno fue reasignado. Consultá a tu supervisor',
    });
    setup({ now: () => new Date('2030-01-01T20:00:00.000Z') });
    await expect(
      beginShift('shift-1', shiftData.shift.startsAt, shiftData.shift.endsAt),
    ).resolves.toMatchObject({
      status: 'error',
      message: 'Todavía no podés iniciar este turno o el turno ya terminó',
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('requires an early-close reason, then persists before offline send', async () => {
    setup({ now: () => new Date('2030-01-02T04:00:00.000Z'), online: async () => false });
    await expect(finishShift(shiftData, '')).resolves.toMatchObject({ status: 'error' });
    expect(repo.addPendingEvent).not.toHaveBeenCalled();
    await expect(finishShift(shiftData, 'Relevo solicitado')).resolves.toMatchObject({
      status: 'closed_pending',
    });
    expect(repo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shift_close',
        payload: expect.objectContaining({ reason: 'Relevo solicitado' }),
      }),
    );
    expect(close).not.toHaveBeenCalled();
  });

  it('H-1: enqueues shift_close and triggers sync without direct close or premature deletion', async () => {
    setup({ now: () => new Date('2030-01-02T04:00:00.000Z') });
    repo.isPendingEventConfirmed.mockResolvedValueOnce(true);
    await expect(finishShift(shiftData, 'Relevo solicitado')).resolves.toEqual({
      status: 'closed',
    });
    // Never calls legacy close endpoint
    expect(close).not.toHaveBeenCalled();
    // Enqueued shift_close
    expect(repo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shift_close',
        payload: expect.objectContaining({ reason: 'Relevo solicitado' }),
      }),
    );
    // Triggered synchronization
    expect(triggerSync).toHaveBeenCalledTimes(1);
    // Does not prematurely delete credentials or shift data directly in finishShift
    expect(deleteCredential).not.toHaveBeenCalled();
    expect(repo.clearShiftData).not.toHaveBeenCalled();
  });

  it('H-1: returns closed_pending when shift_close remains pending in queue', async () => {
    repo.listPendingEvents.mockResolvedValueOnce([
      {
        id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        type: 'shift_close',
        payload: {},
        occurredAtDevice: '2030-01-02T04:00:00.000Z',
        createdAt: '2030-01-02T04:00:00.000Z',
      } as never,
    ]);
    setup({ now: () => new Date('2030-01-02T04:00:00.000Z') });

    await expect(finishShift(shiftData, 'Relevo solicitado')).resolves.toEqual({
      status: 'closed_pending',
    });
    expect(triggerSync).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('H-1: returns closed_pending after a network cut with more than 100 earlier events', async () => {
    const events: {
      id: string;
      type: string;
      payload: unknown;
      occurredAtDevice: string;
      createdAt: string;
    }[] = [];
    repo.addPendingEvent.mockImplementation(async (event: unknown) => {
      events.push(event as (typeof events)[number]);
    });
    repo.listPendingEvents.mockImplementation(
      async ({ limit } = {}) => events.slice(0, limit ?? events.length) as never,
    );
    // The queue absorbs sendBatch's network error and returns after scheduling a retry.
    const syncWithNetworkCut = jest.fn(async () => undefined);
    setup({
      now: () => new Date('2030-01-02T04:00:00.000Z'),
      repository: async () => repo as never,
      triggerSync: syncWithNetworkCut,
    });

    for (let index = 0; index < 101; index++) {
      events.push({
        id: `prior-${index}`,
        type: 'checkpoint_record',
        payload: {},
        occurredAtDevice: `2030-01-02T03:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        createdAt: '2030-01-02T03:00:00.000Z',
      });
    }

    await expect(finishShift(shiftData, 'Relevo solicitado')).resolves.toEqual({
      status: 'closed_pending',
    });
    expect(repo.isPendingEventConfirmed).toHaveBeenCalledWith(
      '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    );
    expect(repo.listPendingEvents).not.toHaveBeenCalled();
  });

  it('H-1 Scenario TC-16: pending checkpoint records + close online sends records first, then close, and only deletes credentials when queue is empty', async () => {
    const queue: {
      id: string;
      type: string;
      payload: unknown;
      occurredAtDevice: string;
      createdAt: string;
      sent?: boolean;
    }[] = [];
    const sentBatches: { id: string; type: string }[][] = [];
    let credentialDeleted = false;
    let shiftDataCleared = false;

    // Simulate 3 pending checkpoint records taken offline
    for (let i = 1; i <= 3; i++) {
      queue.push({
        id: `point-${i}`,
        type: 'checkpoint_record',
        payload: { recordId: `point-${i}`, checkpointId: `cp-${i}` },
        occurredAtDevice: `2030-01-02T01:00:0${i}.000Z`,
        createdAt: `2030-01-02T01:00:0${i}.000Z`,
      });
    }

    const testRepo = {
      ...repo,
      addPendingEvent: jest.fn(async (event: (typeof queue)[0]) => {
        queue.push(event);
      }),
      listPendingEvents: jest.fn(async () => queue.filter((e) => !e.sent)),
      isPendingEventConfirmed: jest.fn(async () => true),
      countPendingEvents: jest.fn(async () => queue.filter((e) => !e.sent).length),
      markPendingEventSent: jest.fn(async (id: string) => {
        const item = queue.find((e) => e.id === id);
        if (item) item.sent = true;
      }),
      clearShiftData: jest.fn(async () => {
        shiftDataCleared = true;
      }),
    };

    const simulatedDeleteCredential = jest.fn(async () => {
      credentialDeleted = true;
    });

    const simulatedTriggerSync = jest.fn(async () => {
      // Simulate sync-service: reads queue in order
      const pendingBeforeSync = queue.filter((e) => !e.sent);
      sentBatches.push(pendingBeforeSync.map((e) => ({ id: e.id, type: e.type })));

      // Assert shift_close travels AFTER the checkpoint records
      expect(pendingBeforeSync[0]?.type).toBe('checkpoint_record');
      expect(pendingBeforeSync[1]?.type).toBe('checkpoint_record');
      expect(pendingBeforeSync[2]?.type).toBe('checkpoint_record');
      expect(pendingBeforeSync[3]?.type).toBe('shift_close');

      // Assert credentials have NOT been deleted before/during sync
      expect(credentialDeleted).toBe(false);

      // Simulate server confirming all events
      for (const e of pendingBeforeSync) {
        e.sent = true;
      }

      // After queue is empty and shift_close confirmed, sync-service clears shift and deletes credential
      if (queue.every((e) => e.sent)) {
        await testRepo.clearShiftData();
        await simulatedDeleteCredential();
      }
    });

    setup({
      now: () => new Date('2030-01-02T04:00:00.000Z'),
      online: async () => true,
      repository: async () => testRepo as never,
      triggerSync: simulatedTriggerSync,
      deleteCredential: simulatedDeleteCredential,
    });

    const result = await finishShift(shiftData, 'Fin de turno regular');

    expect(result).toEqual({ status: 'closed' });
    expect(testRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shift_close',
      }),
    );
    expect(sentBatches).toHaveLength(1);
    expect(sentBatches[0]).toEqual([
      { id: 'point-1', type: 'checkpoint_record' },
      { id: 'point-2', type: 'checkpoint_record' },
      { id: 'point-3', type: 'checkpoint_record' },
      { id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040', type: 'shift_close' },
    ]);
    expect(credentialDeleted).toBe(true);
    expect(shiftDataCleared).toBe(true);
  });
});
