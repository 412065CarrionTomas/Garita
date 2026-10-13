import * as Camera from 'expo-camera';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { checkFieldPermissions } from './permissions';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));
jest.mock('expo-camera', () => ({ Camera: { getCameraPermissionsAsync: jest.fn() } }));

const locationResult = (
  granted: boolean,
  accuracy: 'full' | 'reduced' | 'fine' | 'coarse' = 'fine',
) =>
  ({
    granted,
    canAskAgain: true,
    expires: 'never' as const,
    status: granted ? ('granted' as const) : ('denied' as const),
    ios: { accuracy: accuracy === 'reduced' ? ('reduced' as const) : ('full' as const) },
    android: { accuracy: accuracy === 'coarse' ? ('coarse' as const) : ('fine' as const) },
  }) as Location.LocationPermissionResponse;

describe('checkFieldPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
    jest.mocked(Camera.Camera.getCameraPermissionsAsync).mockResolvedValue(locationResult(true));
  });
  it('detects denied location, approximate location, disabled services, and denied camera', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResult(false));
    await expect(checkFieldPermissions()).resolves.toBe('location_denied');
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(locationResult(true, 'reduced'));
    jest.replaceProperty(Platform, 'OS', 'ios');
    await expect(checkFieldPermissions()).resolves.toBe('location_approximate');
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResult(true));
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await expect(checkFieldPermissions()).resolves.toBe('location_services_off');
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
    jest.mocked(Camera.Camera.getCameraPermissionsAsync).mockResolvedValue(locationResult(false));
    await expect(checkFieldPermissions()).resolves.toBe('camera_denied');
  });
  it('accepts precise location and camera access', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(locationResult(true));
    jest.replaceProperty(Platform, 'OS', 'android');
    await expect(checkFieldPermissions()).resolves.toBe('ok');
  });
});
