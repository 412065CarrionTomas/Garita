import { Stack } from 'expo-router';
import { useStackOptions } from '@/ui';
export default function AuthLayout() {
  const options = useStackOptions();
  return <Stack screenOptions={options} />;
}
