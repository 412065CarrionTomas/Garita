import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';
import { Badge, Banner, Button, Card, Screen, Text } from '@/ui';
import {
  checkFieldPermissions,
  requestFieldPermissions,
  type FieldPermissionState,
} from '../features/permisos/permissions';

const messages: Record<FieldPermissionState, string> = {
  ok: 'Los permisos están listos para iniciar tu turno.',
  location_denied: 'Necesitamos que permitas la ubicación precisa.',
  location_approximate:
    'La ubicación aproximada no alcanza; elegí ubicación precisa en los ajustes.',
  location_services_off: 'Activá la ubicación del celular y tocá Siguiente.',
  camera_denied: 'Necesitamos acceso a la cámara para leer los códigos QR.',
};

export default function PermissionsScreen() {
  const router = useRouter();
  const [state, setState] = useState<FieldPermissionState | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async (action: () => Promise<FieldPermissionState>) => {
    setLoading(true);
    try {
      const next = await action();
      setState(next);
      return next;
    } finally {
      setLoading(false);
    }
  };
  const request = () => run(requestFieldPermissions);
  // Vuelve a revisar sin pedir nada: el vigilador pudo activar la ubicación desde el celular.
  const next = async () => {
    if ((await run(checkFieldPermissions)) === 'ok') router.replace('/(guard)');
  };
  // location_* se evalúa antes que la cámara: sin ubicación no sabemos el estado de la cámara.
  const permissionsGranted = state === 'ok' || state === 'location_services_off';
  const locationOk = permissionsGranted || state === 'camera_denied';
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
      granted: permissionsGranted,
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
        Sin señal el celular guarda todo y lo envía después.
      </Banner>
      {state && (
        <Banner
          tone={state === 'ok' ? 'success' : 'danger'}
          role="text"
          accessibilityLiveRegion="polite"
        >
          {messages[state]}
        </Banner>
      )}
      {permissionsGranted && (
        <Button
          size="lg"
          label="Siguiente"
          accessibilityLabel="Siguiente: ir a mis turnos"
          onPress={next}
          disabled={loading}
        />
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
