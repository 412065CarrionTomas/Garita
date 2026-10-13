import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as Camera from 'expo-camera';
import * as Location from 'expo-location';

export type FieldPermissionState =
  'ok' | 'location_denied' | 'location_approximate' | 'location_services_off' | 'camera_denied';
export async function checkFieldPermissions(): Promise<FieldPermissionState> {
  const location = await Location.getForegroundPermissionsAsync();
  if (!location.granted) return 'location_denied';
  if (Platform.OS === 'ios' && location.ios?.accuracy === 'reduced') return 'location_approximate';
  if (Platform.OS === 'android' && location.android?.accuracy !== 'fine')
    return 'location_approximate';
  if (!(await Location.hasServicesEnabledAsync())) return 'location_services_off';
  const camera = await Camera.Camera.getCameraPermissionsAsync();
  if (!camera.granted) return 'camera_denied';
  return 'ok';
}

export function usePermissionsGate() {
  const [state, setState] = useState<FieldPermissionState | null>(null);
  const check = useCallback(async () => {
    const next = await checkFieldPermissions();
    setState(next);
    return next;
  }, []);
  return { state, check };
}

export async function requestFieldPermissions(): Promise<FieldPermissionState> {
  await Location.requestForegroundPermissionsAsync();
  await Camera.Camera.requestCameraPermissionsAsync();
  return checkFieldPermissions();
}
