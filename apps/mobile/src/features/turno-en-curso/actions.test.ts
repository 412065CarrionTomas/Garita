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
  addPendingEvent: jest.fn(async () => undefined),
  listPendingEvents: jest.fn(async () => []),
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
    repository: async () => repo,
    redirectToPermissions,
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

  it('starts online, validates and saves the offline shift data', async () => {
    setup();
    await expect(
      beginShift('shift-1', shiftData.shift.startsAt, shiftData.shift.endsAt),
    ).resolves.toMatchObject({ status: 'started', data: shiftData, late: false });
    expect(start).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({
        eventId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        location: expect.objectContaining({ status: 'ok' }),
      }),
    );
    expect(repo.saveShiftData).toHaveBeenCalledWith(shiftData);
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

  it('sends an early close with a reason, marks it sent and clears local shift', async () => {
    setup({ now: () => new Date('2030-01-02T04:00:00.000Z') });
    await expect(finishShift(shiftData, 'Relevo solicitado')).resolves.toEqual({
      status: 'closed',
    });
    expect(close).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ reason: 'Relevo solicitado' }),
    );
    expect(repo.markPendingEventSent).toHaveBeenCalledWith('0199c2c6-958d-7a4a-9f4f-f2ca1b852040');
    expect(repo.clearShiftData).toHaveBeenCalled();
  });
});
