import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Network from 'expo-network';
import { z } from 'zod';
import { nfcConfigurationSitesSchema, normalizeNfcUid } from '@garita/shared';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError, apiDelete, apiGet, apiRequest } from '@/lib/api-client';
import { cancelNfcRead, nfcAvailability, openNfcSettings, readFactoryUid } from '@/lib/nfc';

const checkpointListSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    etiquetaNfc: z
      .looseObject({ status: z.string(), uid: z.string().optional() })
      .nullable()
      .optional(),
  }),
);
const resultSchema = z.looseObject({ id: z.string(), status: z.string() });
const emptySchema = z.unknown();
type CheckpointItem = z.infer<typeof checkpointListSchema>[number];

export default function ConfigurationHome() {
  const { user, logout } = useAuth();
  const [sites, setSites] = useState<z.infer<typeof nfcConfigurationSitesSchema>>([]);
  const [siteId, setSiteId] = useState('');
  const [points, setPoints] = useState<CheckpointItem[]>([]);
  const [availability, setAvailability] = useState<
    'checking' | 'unsupported' | 'disabled' | 'ready'
  >('checking');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const player = useAudioPlayer(require('../../../assets/sounds/nfc-confirmation.wav'));

  const loadPoints = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setPoints(
        await apiGet(
          `/predios/${encodeURIComponent(id)}/puntos?incluirEtiqueta=true`,
          checkpointListSchema,
        ),
      );
    } catch {
      setMessage('No pudimos cargar los puntos. Revisá tu conexión.');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      apiGet('/configuracion/predios', nfcConfigurationSitesSchema),
      nfcAvailability(),
    ])
      .then(([availableSites, state]) => {
        if (!mounted) return;
        setSites(availableSites);
        setSiteId(availableSites[0]?.id ?? '');
        setAvailability(state);
      })
      .catch(() => {
        if (mounted) setMessage('No pudimos cargar la configuración. Revisá tu conexión.');
      });
    return () => {
      mounted = false;
      void cancelNfcRead();
    };
  }, []);

  useEffect(() => {
    if (!siteId) return;
    let mounted = true;
    void apiGet(
      `/predios/${encodeURIComponent(siteId)}/puntos?incluirEtiqueta=true`,
      checkpointListSchema,
    )
      .then((loadedPoints) => {
        if (mounted) setPoints(loadedPoints);
      })
      .catch(() => {
        if (mounted) setMessage('No pudimos cargar los puntos. Revisá tu conexión.');
      });
    return () => {
      mounted = false;
    };
  }, [siteId]);

  const associate = async (point: CheckpointItem, uid: string, confirmMove = false) => {
    try {
      await apiRequest(
        'PUT',
        `/puntos/${encodeURIComponent(point.id)}/etiqueta-nfc`,
        resultSchema,
        { uid: normalizeNfcUid(uid), confirmMove },
      );
      await loadPoints(siteId);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      player.seekTo(0);
      player.play();
      setMessage(`Etiqueta asociada a ${point.name}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const payload = error.payload as { checkpointName?: unknown } | undefined;
        const other =
          typeof payload?.checkpointName === 'string' ? payload.checkpointName : 'otro punto';
        Alert.alert(`La etiqueta está asociada a ${other}. ¿Moverla a ${point.name}?`, '', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Mover etiqueta', onPress: () => void associate(point, uid, true) },
        ]);
      } else if (error instanceof ApiError && error.status === 422)
        setMessage('Etiqueta no disponible');
      else setMessage('No pudimos asociar la etiqueta. Revisá tu conexión.');
    }
  };

  const startAssociation = async (point: CheckpointItem) => {
    const network = await Network.getNetworkStateAsync();
    if (!network.isConnected || !network.isInternetReachable) {
      setMessage('Se necesita conexión para asociar una etiqueta.');
      return;
    }
    if (availability !== 'ready') return;
    setBusyId(point.id);
    setMessage('Acercá la etiqueta al celular…');
    try {
      await associate(point, await readFactoryUid());
    } catch {
      setMessage('No se pudo leer la etiqueta. Volvé a intentarlo.');
    } finally {
      setBusyId('');
      await cancelNfcRead();
    }
  };

  const removeTag = async (point: CheckpointItem) => {
    try {
      await apiDelete(`/puntos/${encodeURIComponent(point.id)}/etiqueta-nfc`, emptySchema);
      await loadPoints(siteId);
      setMessage(`Etiqueta quitada de ${point.name}`);
    } catch {
      setMessage('No pudimos quitar la etiqueta.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.role}>{user?.role === 'admin' ? 'Administrador' : 'Supervisor'}</Text>
        <Text style={styles.title}>Modo de configuración</Text>
        <Text style={styles.subtitle}>Asociá las etiquetas NFC de los puntos de control.</Text>
        {availability === 'unsupported' && (
          <Text accessibilityRole="alert" style={styles.alert}>
            Tu celular no puede leer etiquetas NFC
          </Text>
        )}
        {availability === 'disabled' && (
          <View>
            <Text accessibilityRole="alert" style={styles.alert}>
              NFC está apagado. Activá NFC para asociar etiquetas.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir ajustes de NFC"
              style={styles.button}
              onPress={() => void openNfcSettings()}
            >
              <Text style={styles.buttonText}>Abrir ajustes de NFC</Text>
            </Pressable>
          </View>
        )}
        {!!message && (
          <Text accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        )}
        <Text style={styles.section}>Predios</Text>
        {sites.map((site) => (
          <Pressable
            key={site.id}
            accessibilityRole="button"
            accessibilityLabel={`Seleccionar predio ${site.name}`}
            accessibilityState={{ selected: siteId === site.id }}
            style={[styles.siteButton, siteId === site.id && styles.selected]}
            onPress={() => setSiteId(site.id)}
          >
            <Text style={styles.siteText}>{site.name}</Text>
          </Pressable>
        ))}
        <Text style={styles.section}>Puntos</Text>
        {points.map((point) => (
          <View key={point.id} style={styles.point}>
            <Text style={styles.pointTitle}>{point.name}</Text>
            <Text>
              {point.etiquetaNfc?.status === 'active'
                ? 'Etiqueta NFC asociada'
                : 'Sin etiqueta NFC'}
            </Text>
            {availability === 'ready' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${point.etiquetaNfc?.status === 'active' ? 'Reemplazar' : 'Asociar'} etiqueta NFC a ${point.name}`}
                disabled={busyId === point.id}
                style={styles.button}
                onPress={() => void startAssociation(point)}
              >
                <Text style={styles.buttonText}>
                  {busyId === point.id
                    ? 'Leyendo…'
                    : point.etiquetaNfc?.status === 'active'
                      ? 'Reemplazar etiqueta'
                      : 'Asociar etiqueta'}
                </Text>
              </Pressable>
            )}
            {point.etiquetaNfc?.status === 'active' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Quitar etiqueta NFC de ${point.name}`}
                style={styles.removeButton}
                onPress={() => void removeTag(point)}
              >
                <Text>Quitar etiqueta</Text>
              </Pressable>
            )}
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
          style={styles.logout}
          onPress={() => void logout()}
        >
          <Text style={styles.link}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { gap: 12, padding: 20 },
  role: { color: '#525252', fontSize: 16 },
  title: { fontSize: 30, fontWeight: '700' },
  subtitle: { fontSize: 16 },
  section: { marginTop: 12, fontSize: 22, fontWeight: '700' },
  siteButton: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 8,
  },
  selected: { borderColor: '#174ea6', backgroundColor: '#eef4ff' },
  siteText: { fontSize: 18 },
  point: { gap: 8, padding: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  pointTitle: { fontSize: 19, fontWeight: '600' },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#174ea6',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  removeButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#777',
    borderRadius: 8,
  },
  alert: { color: '#9f1d1d', fontSize: 17, fontWeight: '600' },
  message: { color: '#174ea6', fontSize: 16 },
  logout: { marginTop: 14, minHeight: 48, justifyContent: 'center' },
  link: { color: '#174ea6', fontSize: 16 },
});
