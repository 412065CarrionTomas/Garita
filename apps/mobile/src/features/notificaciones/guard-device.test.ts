import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { apiDelete, apiRequest } from '@/lib/api-client';
import { registerGuardDevice, unregisterGuardDevice } from './guard-device';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('@/lib/api-client', () => ({
  apiDelete: jest.fn(),
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

describe('guard notification device', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  });

  it('registers the native Android FCM token when permission is granted', async () => {
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValue({ granted: true } as never);
    jest
      .mocked(Notifications.getDevicePushTokenAsync)
      .mockResolvedValue({ data: 'fcm-token' } as never);
    jest.mocked(apiRequest).mockResolvedValue({ id: 'device-1' } as never);
    await registerGuardDevice();
    expect(apiRequest).toHaveBeenCalledWith('POST', '/dispositivos', expect.anything(), {
      token: 'fcm-token',
      kind: 'app',
      platform: 'android',
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'garita:guard-notification-device',
      'device-1',
    );
  });

  it('explains a denied permission without registering', async () => {
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValue({ granted: false } as never);
    await registerGuardDevice();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Notificaciones desactivadas',
      expect.stringContaining('Ajustes'),
    );
  });

  it('deletes its own registered device before logout', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('device-1');
    jest.mocked(apiDelete).mockResolvedValue({ ok: true } as never);
    await unregisterGuardDevice();
    expect(apiDelete).toHaveBeenCalledWith('/dispositivos/device-1', expect.anything());
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('garita:guard-notification-device');
  });

  it('does not send an APNs token to FCM', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    await registerGuardDevice();
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });
});
