import { Redirect } from 'expo-router';
import { useAuth } from '@/features/auth/auth-context';
import { roleHome } from '@/features/legal/legal-screens';

/** La aceptación pendiente la exige el layout de cada área, no este punto de entrada. */
export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Redirect href={roleHome(user)} />;
}
