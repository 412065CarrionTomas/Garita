import { PANIC_SMS_FALLBACK_SECONDS, type CreatePanicAlertRequest } from '@garita/shared';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { getShiftCredentialToken } from '@/lib/cola/credential';
import {
  dispatchPanicAlert,
  resetPanicTransportForTesting,
  setPanicTransportForTesting,
} from './transport';

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
      updatePanicAlert: jest.fn().mockResolvedValue(undefined),
      listPanicAlerts: jest.fn().mockResolvedValue([alert]),
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
});
