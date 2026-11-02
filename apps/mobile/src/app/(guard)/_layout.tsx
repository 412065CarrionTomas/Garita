import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useStackOptions } from '@/ui';
import { useAuth } from '@/features/auth/auth-context';
import { checkFieldPermissions, type FieldPermissionState } from '@/features/permisos/permissions';
import { initSyncService } from '@/lib/cola';
import { createDefaultFieldRepository, subscribePanicChanges } from '@/lib/db/database';
import { getRunningPanicShift } from '@/features/panico/running-shift';
import { AppState, View } from 'react-native';
import {
  reconcilePanicNotification,
  recordLockedPanicFailure,
  subscribeLockedPanicResponses,
} from '@/features/panico/bloqueado/notification';
import { PanicOverlay } from '@/features/panico/panic-overlay';
export default function GuardLayout() {
  const screenOptions = useStackOptions();
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [permissionState, setPermissionState] = useState<FieldPermissionState | null>(null);
  const [savedShiftId, setSavedShiftId] = useState<string | null>(null);
  const [localCheckPath, setLocalCheckPath] = useState<string | null>(null);
  const [panicShiftId, setPanicShiftId] = useState<string | null>(null);
  useEffect(() => {
    if (loading || user?.role !== 'guard') return;
    const unsubscribeResponses = subscribeLockedPanicResponses();
    let mounted = true;
    const refresh = async () => {
      const saved = await getRunningPanicShift(await createDefaultFieldRepository());
      if (mounted) setPanicShiftId(saved?.shift.id ?? null);
      if (mounted) await reconcilePanicNotification().catch(recordLockedPanicFailure);
    };
    const update = () => {
      void refresh().catch(() => {
        if (mounted) setPanicShiftId(null);
      });
    };
    const unsubscribe = subscribePanicChanges(update);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    update();
    return () => {
      mounted = false;
      unsubscribe();
      appState.remove();
      unsubscribeResponses();
    };
  }, [loading, user?.role]);
  useEffect(() => {
    return initSyncService();
  }, []);
  useEffect(() => {
    let mounted = true;
    void checkFieldPermissions()
      .then((state) => {
        if (mounted) setPermissionState(state);
      })
      .catch(() => {
        if (mounted) setPermissionState('location_denied');
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (permissionState !== 'ok') return;
    let mounted = true;
    void createDefaultFieldRepository()
      .then((repository) => repository.getShiftData())
      .then((saved) => {
        if (mounted) {
          setSavedShiftId(saved?.shift.id ?? null);
          setLocalCheckPath(pathname);
        }
      })
      .catch(() => {
        if (mounted) {
          setSavedShiftId(null);
          setLocalCheckPath(pathname);
        }
      });
    return () => {
      mounted = false;
    };
  }, [pathname, permissionState]);
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== 'guard') return <Redirect href="/(configuration)" />;
  if (permissionState === null) return null;
  if (permissionState !== 'ok') return <Redirect href="/permisos" />;
  const isAllowedSubroute =
    pathname.endsWith(`/turno/${savedShiftId}`) || pathname.includes('escaneo');
  if (savedShiftId && localCheckPath === pathname && !isAllowedSubroute) {
    return <Redirect href={`/turno/${savedShiftId}`} />;
  }
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={screenOptions} />
      {panicShiftId && <PanicOverlay />}
    </View>
  );
}
