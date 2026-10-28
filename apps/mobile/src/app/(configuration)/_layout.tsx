import { Redirect, Stack } from 'expo-router';
import { useStackOptions } from '@/ui';
import { useAuth } from '@/features/auth/auth-context';
export default function ConfigurationLayout() {
  const options = useStackOptions();
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role === 'client' || user.role === 'guard') return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={options} />;
}
