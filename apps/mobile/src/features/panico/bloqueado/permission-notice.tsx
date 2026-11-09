import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Banner } from '@/ui';

export function LockedPanicPermissionNotice({ shiftId }: { shiftId: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;
    const check = async () => {
      const key = `garita:locked-panic-permission:${shiftId}`;
      if ((await Notifications.getPermissionsAsync()).granted || (await AsyncStorage.getItem(key)))
        return;
      await AsyncStorage.setItem(key, 'shown');
      if (mounted) setVisible(true);
    };
    void check().catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [shiftId]);
  return visible ? (
    <Banner tone="info" role="text" accessibilityLiveRegion="polite">
      Activá las notificaciones para usar el pánico con el celular bloqueado
    </Banner>
  ) : null;
}
