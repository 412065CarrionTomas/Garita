import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';
import { Badge, Banner, Button, Card, Screen, Text } from '@/ui';
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
  // location_* se evalúa antes que la cámara: sin ubicación no sabemos el estado de la cámara.
  const locationOk = state === 'ok' || state === 'camera_denied';
  const permissions = [
    {
      key: 'location',
      title: 'Ubicación precisa',
      granted: locationOk,
      action: 'Permitir ubicación precisa',
      text: 'Se usa únicamente al iniciar y cerrar el turno y al registrar un punto. Se utiliza para verificar el recorrido informado, conforme a la finalidad comunicada bajo la Ley 25.326.',
    },
    {
      key: 'camera',
      title: 'Cámara',
      granted: state === 'ok',
      action: 'Permitir cámara',
      text: 'Se usa para leer los códigos QR de los puntos de control.',
    },
    // TODO(foja): notificaciones; hoy se configuran más adelante y no se piden acá.
  ];
  return (
    <Screen scroll style={styles.container}>
      <Text variant="title" accessibilityRole="header">
        Permisos para trabajar
      </Text>
      {permissions.map((permission) => (
        <Card key={permission.key}>
          <View style={styles.head}>
            <Text variant="heading" style={styles.title}>
              {permission.title}
            </Text>
            {permission.granted ? (
              <Badge tone="success" label="Permitida" />
            ) : (
              <Button
                label="Permitir"
                accessibilityLabel={permission.action}
                onPress={request}
                disabled={loading}
              />
            )}
          </View>
          <Text>{permission.text}</Text>
        </Card>
      ))}
      <Banner tone="info" role="text">
        Sin señal el celular guarda todo y lo envía después. La hora se verifica contra el servidor.
      </Banner>
      {state === 'ok' && (
        <Button
          size="lg"
          label="Continuar"
          accessibilityLabel="Continuar a mis turnos"
          onPress={() => router.replace('/(guard)')}
        />
      )}
      {state && (
        <Banner
          tone={state === 'ok' ? 'success' : 'danger'}
          role="text"
          accessibilityLiveRegion="polite"
        >
          {messages[state]}
        </Banner>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', gap: space[4] },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  title: { flex: 1 },
});
