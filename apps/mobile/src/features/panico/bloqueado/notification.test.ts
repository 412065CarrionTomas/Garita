import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type * as TaskManager from 'expo-task-manager';
import type * as ReactNative from 'react-native';
import { Platform } from 'react-native';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { triggerPanic } from '../actions';
import {
  dismissPanicNotification,
  handleLockedPanicResponse,
  NOTIFICATION_ID,
  reconcilePanicNotification,
} from './notification';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({
  registerTaskAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'notification'),
  dismissNotificationAsync: jest.fn(async () => undefined),
  AndroidImportance: { LOW: 2 },
  AndroidNotificationPriority: { LOW: 'low' },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));
jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('../actions', () => ({ triggerPanic: jest.fn(async () => ({})) }));

const getShiftData = jest.fn(async () => ({ shift: { id: 'shift-1' } }));
const getSyncMeta = jest.fn(async () => null);
const listPendingEvents = jest.fn(async () => []);
const response = (actionIdentifier: string) => ({
  actionIdentifier,
  notification: { request: { identifier: NOTIFICATION_ID } },
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(10000);
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  await AsyncStorage.clear();
  jest.clearAllMocks();
  getShiftData.mockResolvedValue({ shift: { id: 'shift-1' } });
  listPendingEvents.mockResolvedValue([]);
  getSyncMeta.mockResolvedValue(null);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest
    .mocked(createDefaultFieldRepository)
    .mockResolvedValue({ getShiftData, getSyncMeta, listPendingEvents } as never);
});
afterEach(async () => {
  await dismissPanicNotification();
  jest.useRealTimers();
});

it('publishes a silent, ongoing notification with accessible actions and no site data', async () => {
  await reconcilePanicNotification();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'Turno en curso',
      categoryIdentifier: 'panic-ready',
      sticky: true,
      autoDismiss: false,
      sound: false,
      priority: 'low',
    },
    trigger: { channelId: 'panico-bloqueado' },
  });
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
    'panico-bloqueado',
    expect.objectContaining({ sound: null, enableVibrate: false, lockscreenVisibility: 1 }),
  );
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith('panic-ready', [
    {
      identifier: 'panic',
      buttonTitle: 'Pánico',
      options: { opensAppToForeground: false, isAuthenticationRequired: false },
    },
  ]);
});

it('two taps dispatch once; confirmation consumes the persisted arm', async () => {
  await reconcilePanicNotification();
  await handleLockedPanicResponse(response('panic'));
  expect(triggerPanic).not.toHaveBeenCalled();
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenLastCalledWith(
    'panic-confirm',
    expect.arrayContaining([expect.objectContaining({ buttonTitle: 'Confirmar pánico' })]),
  );
  jest.setSystemTime(14900);
  await handleLockedPanicResponse(response('confirm'));
  await handleLockedPanicResponse(response('confirm'));
  expect(triggerPanic).toHaveBeenCalledTimes(1);
});

it('reads the persisted arm after process restart and ignores malformed or unrelated responses', async () => {
  await AsyncStorage.setItem(
    'garita:locked-panic',
    JSON.stringify({ shiftId: 'shift-1', armedUntil: 15000 }),
  );
  await handleLockedPanicResponse({ actionIdentifier: 'confirm' });
  await handleLockedPanicResponse({
    ...response('confirm'),
    notification: { request: { identifier: 'another' } },
  });
  expect(triggerPanic).not.toHaveBeenCalled();
  await handleLockedPanicResponse(response('confirm'));
  expect(triggerPanic).toHaveBeenCalledTimes(1);
});

it('restores Pánico at 5 s and treats an expired confirmation as a first tap', async () => {
  await reconcilePanicNotification();
  await handleLockedPanicResponse(response('panic'));
  await jest.advanceTimersByTimeAsync(5000);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ categoryIdentifier: 'panic-ready' }),
    }),
  );
  await handleLockedPanicResponse(response('confirm'));
  expect(triggerPanic).not.toHaveBeenCalled();
});

it.each(['no-data', 'queued-close', 'confirmed-close'])(
  'dismisses and never sends for %s',
  async (kind) => {
    await reconcilePanicNotification();
    if (kind === 'no-data') getShiftData.mockResolvedValue(null as never);
    if (kind === 'queued-close')
      listPendingEvents.mockResolvedValue([
        { type: 'shift_close', payload: { shiftId: 'shift-1' } },
      ] as never);
    if (kind === 'confirmed-close') getSyncMeta.mockResolvedValue('true' as never);
    await handleLockedPanicResponse(response('panic'));
    await handleLockedPanicResponse(response('confirm'));
    await reconcilePanicNotification();
    expect(triggerPanic).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(NOTIFICATION_ID);
  },
);

it('dismissal disables stale actions after logout even with cached running shift', async () => {
  await reconcilePanicNotification();
  await handleLockedPanicResponse(response('panic'));
  await dismissPanicNotification();
  await handleLockedPanicResponse(response('confirm'));
  expect(triggerPanic).not.toHaveBeenCalled();
});

it('does not request permission again and dismisses when it is denied', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
  await reconcilePanicNotification();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.dismissNotificationAsync).toHaveBeenCalled();
});

it('is a complete no-op on iOS', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  await reconcilePanicNotification();
  await handleLockedPanicResponse(response('panic'));
  await dismissPanicNotification();
  expect(createDefaultFieldRepository).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('registers the task outside components', () => {
  jest.isolateModules(() => {
    const notifications = jest.requireMock<typeof Notifications>('expo-notifications');
    const taskManager = jest.requireMock<typeof TaskManager>('expo-task-manager');
    const native = jest.requireActual<typeof ReactNative>('react-native');
    Object.defineProperty(native.Platform, 'OS', { value: 'android', configurable: true });
    jest.requireActual('./register');
    expect(taskManager.defineTask).toHaveBeenCalledWith(
      'garita-locked-panic',
      expect.any(Function),
    );
    expect(notifications.registerTaskAsync).toHaveBeenCalledWith('garita-locked-panic');
  });
});
