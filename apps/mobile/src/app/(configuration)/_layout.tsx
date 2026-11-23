import { Redirect, Stack } from 'expo-router';
import { useStackOptions } from '@/ui';
import { useAuth } from '@/features/auth/auth-context';
import { ACCEPT_LEGAL_PATH, useLegalGate } from '@/features/legal/legal-screens';
export default function ConfigurationLayout() {
  const options = useStackOptions();
  const { user, loading } = useAuth();
  const legal = useLegalGate(user);
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role === 'client' || user.role === 'guard') return <Redirect href="/(auth)/login" />;
  if (legal === 'checking') return null;
  if (legal === 'require') return <Redirect href={ACCEPT_LEGAL_PATH} />;
  return <Stack screenOptions={options} />;
}
