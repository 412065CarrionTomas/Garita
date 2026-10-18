import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.role}>Vigilador</Text>
        <MyShiftsScreen />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
          onPress={() => void handleLogout()}
        >
          <Text style={styles.link}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, padding: 24 },
  role: { color: '#525252', fontSize: 16 },
  title: { fontSize: 30, fontWeight: '700' },
  link: { color: '#174ea6', fontSize: 16, paddingVertical: 16 },
});
