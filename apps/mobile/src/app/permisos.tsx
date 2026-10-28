import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { space } from '@garita/tokens';
import { Banner, Button, Card, Screen, Text } from '@/ui';
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
    <Screen scroll style={styles.container}>
      <Text variant="title" accessibilityRole="header">
        Permisos para trabajar
      </Text>
      <Card>
        <Text variant="heading">Ubicación precisa</Text>
        <Text>
          La ubicación precisa se usa únicamente al iniciar y cerrar el turno y al registrar un
          punto. Se utiliza para verificar el recorrido informado, conforme a la finalidad
          comunicada bajo la Ley 25.326.
        </Text>
      </Card>
      <Card>
        <Text variant="heading">Cámara</Text>
        <Text>
          La cámara se usa para leer los códigos QR de los puntos de control. Las notificaciones se
          configurarán más adelante.
        </Text>
      </Card>
      <Button
        size="lg"
        label="Configurar permisos"
        accessibilityLabel="Permitir ubicación precisa y cámara"
        onPress={request}
        loading={loading}
      />
      {state === 'ok' && (
        <Button
          variant="outline"
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
  container: { flexGrow: 1, justifyContent: 'center', gap: space[5] },
});
