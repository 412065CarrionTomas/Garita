import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { radius, space, touch } from '@garita/tokens';
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  incidentReportSchema,
  type IncidentReport,
  type ShiftOfflineData,
} from '@garita/shared';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Button, Input, Screen, Text, useTheme } from '@/ui';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { readClock } from '@/lib/clock/clock';
import { getCurrentLocation } from '@/lib/location';
import { processSyncQueue } from '@/lib/cola';
import { reduceIncidentPhoto } from '@/lib/fotos/reduce-photo';
import { processIncidentPhotos } from '@/lib/fotos/photo-queue';

type SelectedPhoto = { uri: string; width: number; height: number };
function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    })
  );
}

export function IncidentFormScreen({
  shiftId,
  shiftData,
}: {
  shiftId: string;
  shiftData: ShiftOfflineData;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const [type, setType] = useState<(typeof INCIDENT_TYPES)[number]>('intrusion');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [eventSaved, setEventSaved] = useState(false);
  const [message, setMessage] = useState('');

  const addPhoto = async (camera: boolean) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Se necesita permiso para acceder a las fotos.');
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled)
      setPhotos((current) => [
        ...current,
        ...result.assets
          .slice(0, 5 - current.length)
          .map(({ uri, width, height }) => ({ uri, width, height })),
      ]);
  };

  const submit = async () => {
    const incidentId = newId();
    const now = new Date().toISOString();
    const repository = await createDefaultFieldRepository();
    let queued = false;
    setBusy(true);
    setMessage('');
    try {
      const clock = await readClock(repository, now);
      let location: IncidentReport['location'];
      try {
        const reading = await getCurrentLocation({ timeoutMs: 5000 });
        location = {
          status: 'ok',
          latitude: reading.latitude,
          longitude: reading.longitude,
          accuracyMeters: reading.accuracyMeters,
          simulation: reading.simulation,
          takenAt: reading.timestamp,
        };
      } catch {
        location = {
          status: 'unverifiable',
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          simulation: 'unavailable',
          takenAt: null,
        };
      }
      const payload = incidentReportSchema.parse({
        incidentId,
        shiftId,
        type,
        ...(description.trim() ? { description: description.trim() } : {}),
        occurredAtDevice: now,
        clock,
        location,
        photoCount: photos.length,
      });
      await repository.addPendingEvent({
        id: incidentId,
        type: 'incident',
        payload,
        occurredAtDevice: now,
        createdAt: now,
      });
      queued = true;
      setEventSaved(true);
      void processSyncQueue();
      const reduced = await Promise.all(
        photos.map((photo) => reduceIncidentPhoto(photo.uri, newId(), photo.width, photo.height)),
      );
      for (const photo of reduced) {
        await repository.addIncidentPhoto({
          photoId: newId(),
          incidentId,
          uri: photo.uri,
          attempts: 0,
          nextAttemptAt: null,
        });
      }
      void processIncidentPhotos();
      setMessage('Incidente guardado. Las fotos se enviarán cuando haya conexión.');
      router.back();
    } catch (error: unknown) {
      setMessage(
        queued
          ? 'Incidente guardado. No se pudieron preparar todas las fotos.'
          : error instanceof Error
            ? error.message
            : 'No pudimos guardar el incidente.',
      );
      if (queued) void processSyncQueue();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text variant="heading" accessibilityRole="header">
        Reportar incidente
      </Text>
      <Text>Turno en {shiftData.shift.siteName}</Text>
      <Text variant="subheading">Tipo de incidente</Text>
      <View style={styles.segmented}>
        {INCIDENT_TYPES.map((item) => {
          const selected = type === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={INCIDENT_TYPE_LABELS[item]}
              accessibilityState={{ selected }}
              onPress={() => setType(item)}
              style={[
                styles.chip,
                {
                  borderColor: colors.input,
                  backgroundColor: selected ? colors.primary : colors.card,
                },
              ]}
            >
              <Text
                variant="label"
                accessibilityRole="none"
                style={{ color: selected ? colors.primaryForeground : colors.foreground }}
              >
                {INCIDENT_TYPE_LABELS[item]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label="Descripción"
        value={description}
        onChangeText={setDescription}
        maxLength={1000}
        multiline
        hint={`${description.length}/1000`}
      />
      {type === 'other' && !description.trim() && (
        <Text color="danger" accessibilityRole="alert">
          Describí el incidente para continuar.
        </Text>
      )}
      <Text variant="subheading">Fotos ({photos.length}/5)</Text>
      <View>
        <Button
          label="Tomar foto"
          variant="secondary"
          size="lg"
          disabled={photos.length >= 5}
          onPress={() => void addPhoto(true)}
        />
        <Button
          label="Elegir de galería"
          variant="secondary"
          size="lg"
          disabled={photos.length >= 5}
          onPress={() => void addPhoto(false)}
        />
      </View>
      <View style={styles.previews}>
        {photos.map((photo, index) => (
          <Image
            key={`${photo.uri}-${index}`}
            source={{ uri: photo.uri }}
            accessibilityLabel={`Foto ${index + 1}`}
            style={styles.preview}
          />
        ))}
      </View>
      <Button
        label="Guardar incidente"
        size="lg"
        disabled={busy || eventSaved || (type === 'other' && !description.trim())}
        onPress={() => void submit()}
      />
      {!!message && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Chips pegados: los bordes se solapan 1.5 px para que el control se lea como una sola pieza.
  segmented: { flexDirection: 'row', flexWrap: 'wrap', paddingRight: 1.5, paddingBottom: 1.5 },
  chip: {
    minHeight: touch.min,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space[4],
    borderWidth: 1.5,
    borderRadius: 0,
    marginRight: -1.5,
    marginBottom: -1.5,
  },
  previews: { flexDirection: 'row', flexWrap: 'wrap' },
  preview: { width: touch.action, height: touch.action, borderRadius: radius.md, margin: space[1] },
});
