import { Alert, PermissionsAndroid, Platform } from 'react-native';
import type { FieldRepository } from '@/lib/db/database';

export async function requestPanicSmsPermission(
  repository: FieldRepository,
  shiftId: string,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  const key = `sms_permission:${shiftId}`;
  if ((await repository.getSyncMeta(key)) === 'asked') return;
  await repository.setSyncMeta(key, 'asked');
  try {
    if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS)) return;
    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'SMS de emergencia',
        'Garita usa el permiso SMS exclusivamente para enviar el pánico cuando no hay datos o la central no confirma. Sin el permiso se abrirá la pantalla del sistema y tendrás que tocar enviar.',
        [
          { text: 'Ahora no', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continuar', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (accepted) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  } catch {
    // Permission errors leave the system composer available for this shift.
  }
}
