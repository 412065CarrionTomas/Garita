import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  requestFieldPermissions,
  type FieldPermissionState,
} from '../features/permisos/permissions';

const messages: Record<FieldPermissionState, string> = {
  ok: 'Los permisos están listos para iniciar tu turno.',
  location_denied: 'Necesitamos que permitas la ubicación precisa.',
  location_approximate:
    'La ubicación aproximada no alcanza; elegí ubicación precisa en los ajustes.',
  location_services_off: 'Activá los servicios de ubicación del celular.',
  camera_denied: 'Necesitamos acceso a la cámara para leer los códigos QR.',
};

export default function PermissionsScreen() {
  const router = useRouter();
  const [state, setState] = useState<FieldPermissionState | null>(null);
  const [loading, setLoading] = useState(false);
  const request = async () => {
    setLoading(true);
    try {
      setState(await requestFieldPermissions());
    } finally {
      setLoading(false);
    }
  };
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Permisos para trabajar
      </Text>
      <Text style={styles.copy}>
        La ubicación precisa se usa únicamente al iniciar y cerrar el turno y al registrar un punto.
        Se utiliza para verificar el recorrido informado, conforme a la finalidad comunicada bajo la
        Ley 25.326.
      </Text>
      <Text style={styles.copy}>
        La cámara se usa para leer los códigos QR de los puntos de control. Las notificaciones se
        configurarán más adelante.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Permitir ubicación precisa y cámara"
        onPress={request}
        disabled={loading}
        style={styles.button}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Configurar permisos</Text>
        )}
      </Pressable>
      {state === 'ok' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continuar a mis turnos"
          onPress={() => router.replace('/(guard)')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Continuar</Text>
        </Pressable>
      )}
      {state && (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {messages[state]}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 20,
    backgroundColor: '#171717',
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  copy: { color: '#fff', fontSize: 18, lineHeight: 27 },
  button: {
    minHeight: 64,
    backgroundColor: '#facc15',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  buttonText: { color: '#171717', fontSize: 19, fontWeight: '700' },
  status: { color: '#fff', fontSize: 18 },
});
