import { Platform } from 'react-native';
import * as SMS from 'expo-sms';
import { buildPanicSms, type ShiftOfflineData } from '@garita/shared';
import GaritaNative from '../../../../modules/garita-native/src';
import {
  createDefaultFieldRepository,
  createFieldRepository,
  type FieldDatabase,
  type LocalPanicAlert,
} from '@/lib/db/database';
import {
  dispatchPanicAlert,
  resetPanicTransportForTesting,
  setPanicTransportForTesting,
} from '../transport';
import { sendPanicSms } from './send-panic-sms';

jest.mock('@/lib/db/database', () => ({
  ...jest.requireActual('@/lib/db/database'),
  createDefaultFieldRepository: jest.fn(),
}));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('@/lib/cola/credential', () => ({ getShiftCredentialToken: async () => 'credential' }));
jest.mock('expo-sms', () => ({ isAvailableAsync: jest.fn(), sendSMSAsync: jest.fn() }));
jest.mock('../../../../modules/garita-native/src', () => ({
  __esModule: true,
  default: { getSmsCapability: jest.fn(), sendSms: jest.fn(), addListener: jest.fn() },
}));

const data: ShiftOfflineData = {
  shift: {
    id: 'shift',
    siteId: 'site',
    siteName: 'Predio Álamos Ñandú',
    startsAt: '2035-01-01T00:00:00Z',
    endsAt: '2035-01-02T00:00:00Z',
    timezone: 'America/Argentina/Buenos_Aires',
    assignmentId: 'assignment',
    panicSms: { destination: '+5493511234567', shiftCode: '483920', backup: true },
  },
  rounds: [],
  windows: [],
  checkpoints: [],
  serverTime: { serverNowUtc: '2035-01-01T12:00:00Z' },
};
const alert: LocalPanicAlert = {
  request: {
    alertId: 'a1234567-0000-4000-8000-000000000001',
    shiftId: 'shift',
    occurredAtDevice: '2035-01-01T06:10:00Z',
    location: {
      status: 'ok',
      latitude: -31.42013,
      longitude: -64.18877,
      accuracyMeters: 10,
      simulation: 'unavailable',
      takenAt: '2035-01-01T06:10:00Z',
    },
  },
  state: null,
  smsState: 'pending',
  smsAttempted: false,
  attempts: 0,
};

describe('panic SMS through the priority transport', () => {
  let repository: ReturnType<typeof createFieldRepository>;
  let receive: (event: unknown) => void;
  const remove = jest.fn();
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'android');
    let stored: ShiftOfflineData | null = null;
    let alerts: LocalPanicAlert[] = [];
    const disk = {
      transaction: async <T>(work: () => Promise<T>) => work(),
      replaceShift: async (value: ShiftOfflineData | null) => {
        stored = value;
      },
      readShift: async () => stored,
      insertPanicAlert: async (value: LocalPanicAlert) => {
        alerts.unshift(value);
      },
      readPanicAlerts: async () => alerts,
      updatePanicAlert: async (value: LocalPanicAlert) => {
        alerts = alerts.map((item) =>
          item.request.alertId === value.request.alertId ? value : item,
        );
      },
      countPendingEvents: async () => 0,
      readPendingEvents: async () => [],
    } as unknown as FieldDatabase;
    repository = createFieldRepository(disk);
    await repository.saveShiftData(data);
    await repository.savePanicAlert(alert);
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(repository);
    jest.mocked(GaritaNative.getSmsCapability).mockResolvedValue({ canSendInBackground: true });
    jest.mocked(GaritaNative.sendSms).mockResolvedValue({ id: 'native-id' });
    jest.mocked(GaritaNative.addListener).mockImplementation((_name, listener) => {
      receive = listener;
      return { remove };
    });
    jest.mocked(SMS.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(SMS.sendSMSAsync).mockResolvedValue({ result: 'sent' });
    setPanicTransportForTesting({ online: async () => false });
  });
  afterEach(() => {
    resetPanicTransportForTesting();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const flush = () => jest.advanceTimersByTimeAsync(0);

  it('CA1: starts one background SMS under two seconds and reports only native acknowledgements', async () => {
    const started = Date.now();
    await dispatchPanicAlert(alert);
    await flush();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(GaritaNative.sendSms).toHaveBeenCalledTimes(1);
    expect(GaritaNative.sendSms).toHaveBeenCalledWith({
      destination: '+5493511234567',
      message: buildPanicSms({
        alertId: alert.request.alertId,
        shiftCode: '483920',
        time: '03:10',
        latitude: -31.42013,
        longitude: -64.18877,
        backup: { siteName: data.shift.siteName },
      }),
    });
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('pending');
    receive({ id: 'unrelated', status: 'sent' });
    receive({ id: 'native-id', status: 'bogus' });
    await flush();
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('pending');
    receive({ id: 'native-id', status: 'sent' });
    await flush();
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('sent');
    receive({ id: 'native-id', status: 'delivered' });
    receive({ id: 'native-id', status: 'sent' });
    await flush();
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('delivered');
    expect(remove).toHaveBeenCalled();
    expect(SMS.sendSMSAsync).not.toHaveBeenCalled();
  });

  it.each(['android', 'ios'] as const)(
    'CA2: opens one recipient on %s without background capability',
    async (os) => {
      jest.replaceProperty(Platform, 'OS', os);
      jest.mocked(GaritaNative.getSmsCapability).mockResolvedValue({ canSendInBackground: false });
      await sendPanicSms(alert);
      expect(SMS.sendSMSAsync).toHaveBeenCalledWith(['+5493511234567'], expect.any(String));
      expect(GaritaNative.sendSms).not.toHaveBeenCalled();
      expect((await repository.listPanicAlerts())[0]?.smsState).toBe('prepared');
    },
  );

  it.each([
    ['sent', 'prepared'],
    ['unknown', 'prepared'],
    ['cancelled', 'failed'],
  ] as const)('composer %s becomes %s and preserves the internet queue', async (result, state) => {
    jest.mocked(GaritaNative.getSmsCapability).mockResolvedValue({ canSendInBackground: false });
    jest.mocked(SMS.sendSMSAsync).mockResolvedValue({ result });
    await sendPanicSms(alert);
    expect((await repository.listPanicAlerts())[0]).toMatchObject({ smsState: state, state: null });
    expect(await repository.countPendingEvents()).toBe(1);
  });

  it('does not block internet retries while the system composer remains open', async () => {
    jest.mocked(GaritaNative.getSmsCapability).mockResolvedValue({ canSendInBackground: false });
    jest.mocked(SMS.sendSMSAsync).mockImplementation(() => new Promise(() => undefined));
    await dispatchPanicAlert(alert);
    await flush();
    const state = {
      alertId: alert.request.alertId,
      status: 'active' as const,
      receivedAt: '2035-01-01T12:00:00Z',
      confirmedAt: null,
    };
    const send = jest.fn().mockResolvedValue(state);
    setPanicTransportForTesting({ online: async () => true, send });
    await jest.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await repository.listPanicAlerts())[0]?.state).toEqual(state);
    expect(await repository.countPendingEvents()).toBe(0);
  });

  it('CA6: waits exactly eight seconds with degraded data and keeps only one SMS across retries', async () => {
    setPanicTransportForTesting({
      online: async () => true,
      send: () => new Promise(() => undefined),
    });
    void dispatchPanicAlert(alert);
    await jest.advanceTimersByTimeAsync(7999);
    expect(GaritaNative.sendSms).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(GaritaNative.sendSms).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(14000);
    expect(GaritaNative.sendSms).toHaveBeenCalledTimes(1);
  });

  it('never retries an attempted SMS after reopen or repeated offline activations', async () => {
    const second = {
      ...alert,
      request: { ...alert.request, alertId: 'b1234567-0000-4000-8000-000000000002' },
    };
    await repository.savePanicAlert(second);
    await Promise.all([sendPanicSms(alert), sendPanicSms(second)]);
    await sendPanicSms(alert);
    expect(GaritaNative.sendSms).toHaveBeenCalledTimes(1);
    expect((await repository.listPanicAlerts()).every((item) => item.smsAttempted)).toBe(true);
    receive({ id: 'native-id', status: 'sent' });
    await flush();
    expect((await repository.listPanicAlerts()).every((item) => item.smsState === 'sent')).toBe(
      true,
    );
  });

  it('fails without a destination and never invokes either channel', async () => {
    await repository.saveShiftData({
      ...data,
      shift: { ...data.shift, panicSms: { ...data.shift.panicSms!, destination: null } },
    });
    await sendPanicSms(alert);
    expect(GaritaNative.sendSms).not.toHaveBeenCalled();
    expect(SMS.sendSMSAsync).not.toHaveBeenCalled();
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('failed');
    expect(await repository.countPendingEvents()).toBe(1);
  });

  it('allows one SMS for a new alert after the previous alert is resolved', async () => {
    await sendPanicSms(alert);
    await repository.patchPanicAlert(alert.request.alertId, {
      state: {
        alertId: alert.request.alertId,
        status: 'resolved',
        receivedAt: alert.request.occurredAtDevice,
        confirmedAt: alert.request.occurredAtDevice,
      },
    });
    const next = await repository.savePanicAlert({
      ...alert,
      request: { ...alert.request, alertId: 'b1234567-0000-4000-8000-000000000002' },
    });
    await sendPanicSms(next);
    expect(GaritaNative.sendSms).toHaveBeenCalledTimes(2);
  });

  it('persists a native acknowledgement that arrives before sendSms resolves', async () => {
    jest.mocked(GaritaNative.sendSms).mockImplementation(async () => {
      receive({ id: 'native-id', status: 'sent' });
      return { id: 'native-id' };
    });
    await sendPanicSms(alert);
    await flush();
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('sent');
  });

  it('reports native send failure without dropping the queued alert', async () => {
    await sendPanicSms(alert);
    receive({ id: 'native-id', status: 'failed' });
    await flush();
    expect((await repository.listPanicAlerts())[0]?.smsState).toBe('failed');
    expect(await repository.countPendingEvents()).toBe(1);
  });

  it.each([true, false])(
    'CA3: keeps the message GSM safe and under 160 characters (backup %s)',
    async (backup) => {
      await repository.saveShiftData({
        ...data,
        shift: { ...data.shift, panicSms: { ...data.shift.panicSms!, backup } },
      });
      await sendPanicSms(alert);
      const message = jest.mocked(GaritaNative.sendSms).mock.calls[0]![0].message;
      expect(message.length).toBeLessThanOrEqual(160);
      expect(message).toMatch(/^GARITA PANICO A1234567 T:483920 03:10 -31\.42013,-64\.18877/);
      expect(message).toMatch(/^[A-Za-z0-9 .,:/?=\-]+$/);
      expect(message.includes('Predio Alamos Nandu')).toBe(backup);
      expect(message.includes('maps.google.com/?q=-31.42013,-64.18877')).toBe(backup);
    },
  );
});
