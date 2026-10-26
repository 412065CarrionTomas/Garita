import { act, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { NotificationNavigation } from './notification-navigation';

const mockPush = jest.fn();
let notificationListener: ((response: Notifications.NotificationResponse) => void) | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: { role: 'guard' } }) }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn((listener) => {
    notificationListener = listener;
    return { remove: jest.fn() };
  }),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
}));

const response = (kind: string, shiftId?: string) =>
  ({
    notification: { request: { content: { data: { kind, shiftId } } } },
  }) as unknown as Notifications.NotificationResponse;

describe('notification navigation', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('opens the assigned shift when the notification is tapped', async () => {
    await render(<NotificationNavigation />);
    await act(async () => {
      notificationListener?.(response('shift_assigned', 'shift-1'));
    });
    expect(mockPush).toHaveBeenCalledWith('/turno/shift-1');
  });

  it('opens current shifts for a cancelled or removed shift', async () => {
    await render(<NotificationNavigation />);
    await act(async () => {
      notificationListener?.(response('shift_cancelled', 'shift-1'));
    });
    expect(mockPush).toHaveBeenCalledWith('/(guard)');
  });

  it('handles a notification that launched the app', async () => {
    jest
      .mocked(Notifications.getLastNotificationResponseAsync)
      .mockResolvedValueOnce(response('shift_changed', 'shift-2'));
    await render(<NotificationNavigation />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/turno/shift-2'));
  });
});
