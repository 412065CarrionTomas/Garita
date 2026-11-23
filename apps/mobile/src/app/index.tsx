import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { homePath } from '@/features/legal/legal-screens';
import { getRunningPanicShift } from '@/features/panico/running-shift';
import { createDefaultFieldRepository } from '@/lib/db/database';

async function hasRunningShift() {
  try {
    return (await getRunningPanicShift(await createDefaultFieldRepository())) !== null;
  } catch {
    return false;
  }
}

export default function Index() {
  const { user, loading } = useAuth();
  const needsAcceptance = Boolean(user?.legalAcceptanceRequired);
  const [runningShift, setRunningShift] = useState<boolean | null>(null);
  useEffect(() => {
    if (!needsAcceptance) return;
    let mounted = true;
    void hasRunningShift().then((running) => {
      if (mounted) setRunningShift(running);
    });
    return () => {
      mounted = false;
    };
  }, [needsAcceptance]);
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (needsAcceptance && runningShift === null) return null;
  // Un turno en curso nunca queda detrás de la aceptación: el pánico debe seguir a mano.
  if (runningShift)
    return <Redirect href={user.role === 'guard' ? '/(guard)' : '/(configuration)'} />;
  return <Redirect href={homePath(user)} />;
}
