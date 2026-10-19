import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Badge, Banner, Button, Card, ListItem, Screen, Text, ThemeSwitch } from '@/ui';
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
    <Screen scroll>
      <Text variant="caption" color="mutedForeground">
        {user?.role === 'admin' ? 'Administrador' : 'Supervisor'}
      </Text>
      <Text variant="title">Modo de configuración</Text>
      <Text color="mutedForeground">Asociá las etiquetas NFC de los puntos de control.</Text>
      {availability === 'unsupported' && (
        <Banner tone="warning">Tu celular no puede leer etiquetas NFC</Banner>
      )}
      {availability === 'disabled' && (
        <>
          <Banner tone="warning">NFC está apagado. Activá NFC para asociar etiquetas.</Banner>
          <Button
            variant="outline"
            label="Abrir ajustes de NFC"
            accessibilityRole="button"
            accessibilityLabel="Abrir ajustes de NFC"
            onPress={() => void openNfcSettings()}
          />
        </>
      )}
      {!!message && <Banner tone="info">{message}</Banner>}
      <Text variant="heading">Predios</Text>
      {sites.map((site) => (
        <ListItem
          key={site.id}
          title={site.name}
          trailing={siteId === site.id ? <Badge tone="info" label="Seleccionado" /> : undefined}
          accessibilityRole="button"
          accessibilityLabel={`Seleccionar predio ${site.name}`}
          accessibilityState={{ selected: siteId === site.id }}
          onPress={() => setSiteId(site.id)}
        />
      ))}
      <Text variant="heading">Puntos</Text>
      {points.map((point) => (
        <Card key={point.id}>
          <Text variant="subheading">{point.name}</Text>
          <Badge
            tone={point.etiquetaNfc?.status === 'active' ? 'success' : 'neutral'}
            label={
              point.etiquetaNfc?.status === 'active' ? 'Etiqueta NFC asociada' : 'Sin etiqueta NFC'
            }
          />
          {availability === 'ready' && (
            <Button
              label={
                busyId === point.id
                  ? 'Leyendo…'
                  : point.etiquetaNfc?.status === 'active'
                    ? 'Reemplazar etiqueta'
                    : 'Asociar etiqueta'
              }
              accessibilityRole="button"
              accessibilityLabel={`${point.etiquetaNfc?.status === 'active' ? 'Reemplazar' : 'Asociar'} etiqueta NFC a ${point.name}`}
              disabled={busyId === point.id}
              onPress={() => void startAssociation(point)}
            />
          )}
          {point.etiquetaNfc?.status === 'active' && (
            <Button
              variant="outline"
              label="Quitar etiqueta"
              accessibilityRole="button"
              accessibilityLabel={`Quitar etiqueta NFC de ${point.name}`}
              onPress={() => void removeTag(point)}
            />
          )}
        </Card>
      ))}
      <ThemeSwitch />
      <Button
        variant="ghost"
        label="Cerrar sesión"
        accessibilityRole="button"
        accessibilityLabel="Cerrar sesión"
        onPress={() => void logout()}
      />
    </Screen>
  );
}
