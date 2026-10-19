import { Alert } from 'react-native';
import { Button, Screen, Text, ThemeSwitch } from '@/ui';
import { useAuth } from '@/features/auth/auth-context';
import { MyShiftsScreen } from '@/features/turnos/my-shifts-screen';
import { createDefaultFieldRepository } from '@/lib/db/database';

export default function GuardHome() {
  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      const repository = await createDefaultFieldRepository();
      const count = await repository.countPendingEvents();
      if (count > 0) {
        const text =
          count === 1
            ? 'Tenés 1 registro pendiente de envío. Si cerrás sesión, no se descartará pero no se enviará hasta que vuelvas a ingresar o haya conexión. ¿Querés cerrar sesión igual?'
            : `Tenés ${count} registros pendientes de envío. Si cerrás sesión, no se descartarán pero no se enviarán hasta que vuelvas a ingresar o haya conexión. ¿Querés cerrar sesión igual?`;
        Alert.alert('Registros pendientes de envío', text, [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Cerrar sesión',
            style: 'destructive',
            onPress: () => {
              void logout();
            },
          },
        ]);
        return;
      }
    } catch {
      // If error checking database, proceed with normal logout
    }
    await logout();
  };

  return (
    <Screen>
      <Text variant="caption" color="mutedForeground">
        Vigilador
      </Text>
      <MyShiftsScreen />
      <ThemeSwitch />
      <Button
        variant="ghost"
        label="Cerrar sesión"
        accessibilityRole="button"
        accessibilityLabel="Cerrar sesión"
        onPress={() => void handleLogout()}
      />
    </Screen>
  );
}
