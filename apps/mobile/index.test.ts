import type * as TaskManager from 'expo-task-manager';
import type * as ReactNative from 'react-native';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({ registerTaskAsync: jest.fn(async () => null) }));
jest.mock('./src/features/panico/bloqueado/notification', () => ({
  handleLockedPanicResponse: jest.fn(async () => 0),
  recordLockedPanicFailure: jest.fn(),
}));
jest.mock('expo-router/entry', () => {
  const loadRouter = jest.fn();
  loadRouter();
  return { loadRouter };
});

it('registers the headless task once before Router loads, without mounting UI', () => {
  jest.isolateModules(() => {
    const { Platform } = jest.requireActual<typeof ReactNative>('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const tasks = jest.requireMock<typeof TaskManager>('expo-task-manager');
    jest.requireActual('./index');
    jest.requireActual('./index');
    const router = jest.requireMock<{ loadRouter: jest.Mock }>('expo-router/entry');
    expect(tasks.defineTask).toHaveBeenCalledTimes(1);
    expect(router.loadRouter).toHaveBeenCalledTimes(1);
    expect(jest.mocked(tasks.defineTask).mock.invocationCallOrder[0]).toBeLessThan(
      router.loadRouter.mock.invocationCallOrder[0] ?? Infinity,
    );
  });
});
