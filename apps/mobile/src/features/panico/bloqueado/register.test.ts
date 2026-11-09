import type * as TaskManager from 'expo-task-manager';
import type * as Notifications from 'expo-notifications';
import type * as ReactNative from 'react-native';
import type * as LockedPanic from './notification';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({ registerTaskAsync: jest.fn(async () => null) }));
jest.mock('./notification', () => ({
  expireLockedPanicArm: jest.fn(async () => undefined),
  handleLockedPanicResponse: jest.fn(async () => 5000),
  recordLockedPanicFailure: jest.fn(),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('bounds the wait for a stuck reconciliation after expiration', async () => {
  await jest.isolateModulesAsync(async () => {
    const { Platform } = jest.requireActual<typeof ReactNative>('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const tasks = jest.requireMock<typeof TaskManager>('expo-task-manager');
    const panic = jest.requireMock<typeof LockedPanic>('./notification');
    jest.mocked(panic.handleLockedPanicResponse).mockResolvedValue(5000);
    jest.mocked(panic.expireLockedPanicArm).mockReturnValue(new Promise<void>(() => undefined));
    jest.requireActual('./register');
    const executor = jest.mocked(tasks.defineTask).mock.calls[0]?.[1];
    expect(executor).toBeDefined();
    let finished = false;
    const task = Promise.resolve(
      executor?.({
        data: {},
        error: null,
        executionInfo: { taskName: 'garita-locked-panic', eventId: 'tap' },
      }),
    ).then(() => {
      finished = true;
    });
    await jest.advanceTimersByTimeAsync(6999);
    expect(finished).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await task;
    expect(finished).toBe(true);
  });
});

it.each([5000, 10000])(
  'keeps the headless task alive for %i ms after dispatch without awaiting network',
  async (budget) => {
    await jest.isolateModulesAsync(async () => {
      const { Platform } = jest.requireActual<typeof ReactNative>('react-native');
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      const taskManager = jest.requireMock<typeof TaskManager>('expo-task-manager');
      const { handleLockedPanicResponse } = jest.requireMock<typeof LockedPanic>('./notification');
      jest.mocked(handleLockedPanicResponse).mockResolvedValue(budget);
      jest.requireActual('./register');
      const executor = jest.mocked(taskManager.defineTask).mock.calls[0]?.[1];
      expect(executor).toBeDefined();
      let finished = false;
      const task = Promise.resolve(
        executor?.({
          data: { actionIdentifier: 'panic' },
          error: null,
          executionInfo: { taskName: 'garita-locked-panic', eventId: 'tap' },
        }),
      ).then(() => {
        finished = true;
      });
      await jest.advanceTimersByTimeAsync(budget - 1);
      expect(handleLockedPanicResponse).toHaveBeenCalledTimes(1);
      expect(finished).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await task;
      expect(finished).toBe(true);
    });
  },
);

it('does not register a task or handle anything on iOS', () => {
  jest.isolateModules(() => {
    const { Platform } = jest.requireActual<typeof ReactNative>('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const taskManager = jest.requireMock<typeof TaskManager>('expo-task-manager');
    const notifications = jest.requireMock<typeof Notifications>('expo-notifications');
    jest.requireActual('./register');
    expect(taskManager.defineTask).not.toHaveBeenCalled();
    expect(notifications.registerTaskAsync).not.toHaveBeenCalled();
  });
});
