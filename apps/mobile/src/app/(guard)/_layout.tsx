import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { checkFieldPermissions, type FieldPermissionState } from '@/features/permisos/permissions';
import { initSyncService } from '@/lib/cola';
import { createDefaultFieldRepository } from '@/lib/db/database';
export default function GuardLayout() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [permissionState, setPermissionState] = useState<FieldPermissionState | null>(null);
  const [savedShiftId, setSavedShiftId] = useState<string | null>(null);
  const [localCheckPath, setLocalCheckPath] = useState<string | null>(null);
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
  return <Stack screenOptions={{ headerShown: false }} />;
}
