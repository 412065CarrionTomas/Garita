import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type * as ReactNative from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDefaultFieldRepository } from '@/lib/db/database';
import {
  dismissPanicNotification,
  NOTIFICATION_ID,
  reconcilePanicNotification,
} from './notification';
import './register';

jest.mock('react-native', () => {
  const native = jest.requireActual<typeof ReactNative>('react-native');
  Object.defineProperty(native.Platform, 'OS', { value: 'android', configurable: true });
  return native;
});
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
jest.mock('../actions', () => ({ triggerPanic: jest.fn() }));

const executor = jest.mocked(TaskManager.defineTask).mock.calls[0]?.[1];

it('publishes Pánico completely before the headless task resolves at expiration', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(10000);
  await AsyncStorage.clear();
  jest.mocked(createDefaultFieldRepository).mockResolvedValue({
    getShiftData: async () => ({ shift: { id: 'shift-1' } }),
    getSyncMeta: async () => null,
    listPendingEvents: async () => [],
  } as never);
  await reconcilePanicNotification();
  let releasePublication: () => void = () => undefined;
  const publication = new Promise<void>((resolve) => {
    releasePublication = resolve;
  });
  const order: string[] = [];
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request) => {
    if (request.content.categoryIdentifier === 'panic-ready') {
      order.push('publishing');
      await publication;
      order.push('published');
    }
    return NOTIFICATION_ID;
  });
  expect(executor).toBeDefined();
  const task = Promise.resolve(
    executor?.({
      data: {
        actionIdentifier: 'panic',
        notification: { request: { identifier: NOTIFICATION_ID } },
      },
      error: null,
      executionInfo: { taskName: 'garita-locked-panic', eventId: 'tap' },
    }),
  ).then(() => {
    order.push('finished');
  });
  await jest.advanceTimersByTimeAsync(5000);
  expect(order).toEqual(['publishing']);
  releasePublication();
  await jest.advanceTimersByTimeAsync(0);
  await task;
  expect(order).toEqual(['publishing', 'published', 'finished']);
  await dismissPanicNotification();
  jest.useRealTimers();
});
