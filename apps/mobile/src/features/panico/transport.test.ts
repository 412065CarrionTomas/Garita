import { PANIC_SMS_FALLBACK_SECONDS, type CreatePanicAlertRequest } from '@garita/shared';
import { createDefaultFieldRepository, type LocalPanicAlert } from '@/lib/db/database';
import { getShiftCredentialToken } from '@/lib/cola/credential';
import {
  dispatchPanicAlert,
  sendBetterLocation,
  resetPanicTransportForTesting,
  setPanicTransportForTesting,
} from './transport';
import { apiRequest } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({ apiRequest: jest.fn() }));

jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('@/lib/cola/credential', () => ({ getShiftCredentialToken: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));

const request: CreatePanicAlertRequest = {
  alertId: '00000000-0000-4000-8000-000000000001',
  shiftId: 'shift',
  occurredAtDevice: '2035-01-01T12:00:00.000Z',
  location: {
    status: 'unverifiable',
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    simulation: 'unavailable',
    takenAt: null,
  },
};
const alert = { request, state: null, smsState: 'pending' as const, attempts: 0 };

describe('priority panic transport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(getShiftCredentialToken).mockResolvedValue('credential');
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      patchPanicAlert: jest.fn(async (_id: string, patch: Partial<LocalPanicAlert>) => ({
        ...alert,
        ...patch,
      })),
      listPanicAlerts: jest.fn().mockResolvedValue([alert]),
      listPendingEvents: async () => [],
    } as never);
  });
  afterEach(() => {
    resetPanicTransportForTesting();
    jest.useRealTimers();
  });

  it('starts SMS after eight seconds without server confirmation and keeps the alert pending', async () => {
    const sms = jest.fn().mockResolvedValue(undefined);
    setPanicTransportForTesting({
      online: async () => true,
      send: () => new Promise(() => undefined),
      sms,
    });
    void dispatchPanicAlert(alert);
    await jest.advanceTimersByTimeAsync(PANIC_SMS_FALLBACK_SECONDS * 1000);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createDefaultFieldRepository)).toHaveBeenCalled();
  });

  it('starts SMS immediately without internet', async () => {
    const sms = jest.fn().mockResolvedValue(undefined);
    setPanicTransportForTesting({ online: async () => false, sms });
    await dispatchPanicAlert(alert);
    expect(sms).toHaveBeenCalledTimes(1);
  });

  it('retries a stalled request and persists only a server-confirmed state', async () => {
    const send = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValue({
        alertId: request.alertId,
        status: 'active',
        receivedAt: request.occurredAtDevice,
        confirmedAt: null,
      });
    setPanicTransportForTesting({ online: async () => true, send, sms: async () => undefined });
    const pending = dispatchPanicAlert(alert);
    const repo = await createDefaultFieldRepository();
    await jest.advanceTimersByTimeAsync(7999);
    expect(repo.patchPanicAlert).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(repo.patchPanicAlert).toHaveBeenCalledWith(request.alertId, { attempts: 1 });
    await jest.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(repo.patchPanicAlert).toHaveBeenCalledWith(
      request.alertId,
      expect.objectContaining({
        state: expect.objectContaining({ status: 'active' }),
      }),
    );
  });

  it('cancels the SMS timer after receipt and patches only a more precise location', async () => {
    const state = {
      alertId: request.alertId,
      status: 'active' as const,
      receivedAt: request.occurredAtDevice,
      confirmedAt: null,
    };
    const sms = jest.fn();
    setPanicTransportForTesting({ online: async () => true, send: async () => state, sms });
    await dispatchPanicAlert(alert);
    await jest.advanceTimersByTimeAsync(8000);
    expect(sms).not.toHaveBeenCalled();
    const location = {
      ...request.location,
      status: 'ok' as const,
      latitude: -34.6,
      longitude: -58.4,
      accuracyMeters: 5,
    };
    await sendBetterLocation({ ...alert, state }, location);
    expect(apiRequest).toHaveBeenCalledWith(
      'PATCH',
      `/alertas-panico/${request.alertId}/ubicacion`,
      expect.anything(),
      { location },
      expect.objectContaining({ headers: { Authorization: 'Bearer credential' } }),
    );
    jest.mocked(apiRequest).mockClear();
    await sendBetterLocation(
      { ...alert, state, request: { ...request, location } },
      { ...location, accuracyMeters: 20 },
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('H3: shares the in-flight promise with queue callers until receipt is persisted', async () => {
    let receive!: (state: NonNullable<LocalPanicAlert['state']>) => void;
    const send = jest.fn(
      () =>
        new Promise<NonNullable<LocalPanicAlert['state']>>((resolve) => {
          receive = resolve;
        }),
    );
    setPanicTransportForTesting({ online: async () => true, send });
    const direct = dispatchPanicAlert(alert);
    const queued = dispatchPanicAlert(alert);
    expect(queued).toBe(direct);
    await jest.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    receive({
      alertId: request.alertId,
      status: 'active',
      receivedAt: request.occurredAtDevice,
      confirmedAt: null,
    });
    await Promise.all([direct, queued]);
    const repo = await createDefaultFieldRepository();
    expect(repo.patchPanicAlert).toHaveBeenCalledWith(
      request.alertId,
      expect.objectContaining({ state: expect.anything() }),
    );
  });

  it.each([
    { status: 'unverifiable' as const, latitude: null, longitude: null },
    { status: 'ok' as const, latitude: null, longitude: -58 },
    { status: 'ok' as const, latitude: -34, longitude: null },
  ])('H3: never patches unusable coordinates even with better accuracy: %j', async (invalid) => {
    jest.mocked(apiRequest).mockClear();
    await sendBetterLocation(
      {
        ...alert,
        state: {
          alertId: request.alertId,
          status: 'active',
          receivedAt: request.occurredAtDevice,
          confirmedAt: null,
        },
      },
      { ...request.location, ...invalid, accuracyMeters: 1 },
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
