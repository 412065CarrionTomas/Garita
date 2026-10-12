import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/features/auth/auth-context';
export default function GuardLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== 'guard') return <Redirect href="/(configuration)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
