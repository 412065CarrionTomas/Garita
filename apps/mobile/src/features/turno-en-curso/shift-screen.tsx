import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  currentRoundProgress,
  isWithinStartMargin,
  lateStartMinutes,
  type ShiftOfflineData,
} from '@garita/shared';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { beginShift, finishShift } from './actions';

const shiftsSchema = z.array(
  z.looseObject({
    id: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    site: z.looseObject({ name: z.string() }),
  }),
);
type ScheduledShift = z.infer<typeof shiftsSchema>[number];

export function ShiftScreen({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [scheduled, setScheduled] = useState<ScheduledShift | null>(null);
  const [data, setData] = useState<ShiftOfflineData | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const refreshLocal = useCallback(async () => {
    try {
      const repository = await createDefaultFieldRepository();
      const saved = await repository.getShiftData();
      if (saved?.shift.id === shiftId) {
        setData(saved);
        const pending = await repository.listPendingEvents();
        setPendingClose(
          pending.some(
            (event) =>
              event.type === 'shift_close' &&
              event.payload !== null &&
              typeof event.payload === 'object' &&
              'shiftId' in event.payload &&
              event.payload.shiftId === shiftId,
          ),
        );
        return true;
      }
    } catch {
      setMessage('No pudimos leer los datos guardados del turno.');
    }
    return false;
  }, [shiftId]);
  const load = useCallback(async () => {
    if (await refreshLocal()) return;
    try {
      const shifts = await apiGet('/mis-turnos', shiftsSchema);
      setScheduled(shifts.find((shift) => shift.id === shiftId) ?? null);
    } catch {
      setMessage('No pudimos cargar este turno. Revisá tu conexión.');
    }
  }, [refreshLocal, shiftId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(new Date());
        void refreshLocal();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refreshLocal]);

  const start = async () => {
    if (!scheduled) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await beginShift(shiftId, scheduled.startsAt, scheduled.endsAt);
      if (result.status === 'permissions') router.replace('/permisos');
      else if (result.status === 'started') {
        setData(result.data);
        setMessage(result.late ? 'Turno iniciado con demora.' : 'Turno iniciado.');
      } else if (result.status === 'error') setMessage(result.message);
    } catch {
      setMessage('No pudimos guardar el turno en el celular. Volvé a intentar.');
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const result = await finishShift(data, reason);
      if (result.status === 'closed') {
        setData(null);
        setMessage('Turno cerrado.');
        router.replace('/(guard)');
      } else if (result.status === 'closed_pending') {
        setPendingClose(true);
        setMessage('Turno cerrado, pendiente de envío. Sincronizá cuando tengas conexión.');
      } else if (result.status === 'error') setMessage(result.message);
    } catch {
      setMessage('No pudimos guardar el cierre. Volvé a intentar.');
    } finally {
      setBusy(false);
    }
  };

  const shift = data?.shift;
  const startsAt = shift?.startsAt ?? scheduled?.startsAt;
  const endsAt = shift?.endsAt ?? scheduled?.endsAt;
  const startAllowed = scheduled
    ? isWithinStartMargin(scheduled.startsAt, scheduled.endsAt, now.toISOString())
    : false;
  const early = shift ? now.getTime() < Date.parse(shift.endsAt) : false;
  const progress = data ? currentRoundProgress(data, now.toISOString()) : [];
  const checkpointNames = new Map(
    data?.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint.name]) ?? [],
  );
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Turno
      </Text>
      {startsAt && endsAt && (
        <>
          <Text style={styles.site}>{shift?.siteName ?? scheduled?.site.name}</Text>
          <Text style={styles.copy}>
            Horario: {formatTime(startsAt)}–{formatTime(endsAt)}
          </Text>
        </>
      )}
      {!data && scheduled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Iniciar turno"
          disabled={busy || !startAllowed}
          onPress={() => void start()}
          style={[styles.button, (!startAllowed || busy) && styles.disabled]}
        >
          <Text style={styles.buttonText}>Iniciar turno</Text>
        </Pressable>
      )}
      {!data && !scheduled && (
        <Text style={styles.copy}>El turno no está disponible o ya no está asignado.</Text>
      )}
      {data && (
        <>
          {pendingClose && (
            <Text accessibilityRole="alert" style={styles.message}>
              Turno cerrado, pendiente de envío.
            </Text>
          )}
          {lateStartMinutes(data.shift.startsAt, data.serverTime.serverNowUtc) !== null && (
            <Text style={styles.copy}>
              Inicio tardío: {lateStartMinutes(data.shift.startsAt, data.serverTime.serverNowUtc)}{' '}
              minutos.
            </Text>
          )}
          {!pendingClose && (
            <>
              <Text style={styles.section}>Ventanas y puntos pendientes</Text>
              {progress.map((round) => {
                const definition = data.rounds.find((item) => item.roundId === round.roundId);
                return (
                  <View key={round.roundId} style={styles.card}>
                    <Text style={styles.cardTitle}>{definition?.name ?? 'Ronda'}</Text>
                    <Text style={styles.copy}>
                      {round.currentWindow
                        ? `Ventana ${round.currentWindow.label}`
                        : 'Sin ventana activa'}
                    </Text>
                    {round.pendingCheckpointIds.length ? (
                      round.pendingCheckpointIds.map((id) => (
                        <Text key={id} style={styles.copy}>
                          • {checkpointNames.get(id) ?? id}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.copy}>Sin puntos pendientes en esta ventana.</Text>
                    )}
                  </View>
                );
              })}
              {early && (
                <TextInput
                  accessibilityLabel="Motivo del cierre anticipado"
                  placeholder="Motivo del cierre anticipado"
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  style={styles.input}
                />
              )}
              {early && reason.trim().length < 3 && (
                <Text style={styles.copy}>
                  Para cerrar antes de hora, indicá un motivo de al menos 3 caracteres.
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cerrar turno"
                disabled={busy || (early && reason.trim().length < 3)}
                onPress={() => void close()}
                style={[styles.button, styles.closeButton]}
              >
                <Text style={[styles.buttonText, styles.closeButtonText]}>Cerrar turno</Text>
              </Pressable>
            </>
          )}
        </>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      )}
    </ScrollView>
  );
}
function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 16, padding: 24, backgroundColor: '#171717' },
  title: { color: '#fff', fontSize: 30, fontWeight: '700' },
  site: { color: '#fff', fontSize: 22, fontWeight: '600' },
  copy: { color: '#fff', fontSize: 18 },
  section: { marginTop: 8, color: '#fff', fontSize: 22, fontWeight: '700' },
  card: { gap: 8, padding: 18, borderWidth: 1, borderColor: '#777', borderRadius: 10 },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '600' },
  button: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#facc15',
    padding: 16,
  },
  closeButton: { backgroundColor: '#dc2626' },
  buttonText: { color: '#171717', fontSize: 19, fontWeight: '700' },
  closeButtonText: { color: '#fff' },
  disabled: { opacity: 0.45 },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 18,
  },
  message: { color: '#fff', fontSize: 18 },
});
