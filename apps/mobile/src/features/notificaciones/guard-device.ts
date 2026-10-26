import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform, Alert } from 'react-native';
import { deviceSchema } from '@garita/shared';
import { z } from 'zod';
import { ApiError, apiDelete, apiRequest } from '@/lib/api-client';

const deviceKey = 'garita:guard-notification-device';

export async function registerGuardDevice(): Promise<void> {
  // TODO(HU-45-iOS): APNs tokens are not FCM tokens; use native Firebase messaging or an APNs sender.
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('turnos', {
    name: 'Cambios de turnos',
    importance: Notifications.AndroidImportance.HIGH,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      'Notificaciones desactivadas',
      'No te enterarás de los cambios de turno fuera de la app. Podés activarlas en Ajustes del celular > Garita > Notificaciones.',
    );
    return;
  }
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    const device = await apiRequest('POST', '/dispositivos', deviceSchema, {
      token: String(token.data),
      kind: 'app',
      platform: 'android',
    });
    await AsyncStorage.setItem(deviceKey, device.id);
  } catch {
    Alert.alert(
      'Notificaciones no disponibles',
      'No pudimos registrar este celular. Abrí la app con conexión para volver a intentarlo.',
    );
  }
}

export async function unregisterGuardDevice(): Promise<void> {
  const id = await AsyncStorage.getItem(deviceKey);
  if (!id) return;
  try {
    await apiDelete(`/dispositivos/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  await AsyncStorage.removeItem(deviceKey);
}
