import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/auth-context';
export default function ConfigurationHome() {
  const { user, logout } = useAuth();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.role}>{user?.role === 'admin' ? 'Administrador' : 'Supervisor'}</Text>
        <Text style={styles.title}>Modo de configuración</Text>
        <Text>Esta app no habilita funciones de turnos ni registro de puntos para este rol.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
          onPress={() => void logout()}
        >
          <Text style={styles.link}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
  role: { color: '#525252', fontSize: 16 },
  title: { fontSize: 30, fontWeight: '700' },
  link: { color: '#174ea6', fontSize: 16, paddingVertical: 16 },
});
