import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { checkFieldPermissions, type FieldPermissionState } from '@/features/permisos/permissions';
import { createDefaultFieldRepository } from '@/lib/db/database';
export default function GuardLayout() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [permissionState, setPermissionState] = useState<FieldPermissionState | null>(null);
  const [savedShiftId, setSavedShiftId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void checkFieldPermissions().then(async (state) => {
      if (mounted) setPermissionState(state);
      if (state === 'ok') {
        try {
          const saved = await (await createDefaultFieldRepository()).getShiftData();
          if (mounted && saved) setSavedShiftId(saved.shift.id);
        } catch {
          // A local database read failure should not prevent access to the shift list.
        }
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== 'guard') return <Redirect href="/(configuration)" />;
  if (permissionState === null) return null;
  if (permissionState !== 'ok') return <Redirect href="/permisos" />;
  if (savedShiftId && !pathname.endsWith(`/turno/${savedShiftId}`))
    return <Redirect href={`/turno/${savedShiftId}`} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
