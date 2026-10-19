import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';
import { Badge, Banner, Button, Card, Input, Screen, Text } from '@/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  currentRoundProgress,
  isWithinStartMargin,
  lateStartMinutes,
  type ShiftOfflineData,
} from '@garita/shared';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';
import { getSyncSnapshot, subscribeSyncState } from '@/lib/cola';
import { createDefaultFieldRepository, type LocalCheckpointRecord } from '@/lib/db/database';
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
  const [checkpointRecords, setCheckpointRecords] = useState<LocalCheckpointRecord[]>([]);
  const [pendingClose, setPendingClose] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
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
        const count = repository.countPendingEvents
          ? await repository.countPendingEvents()
          : pending.length;
        setPendingCount(count);
        const syncMeta = repository.getSyncMeta
          ? await repository.getSyncMeta('last_sync_at')
          : null;
        setLastSyncAt(syncMeta);
        const snapshot = await getSyncSnapshot();
        setIsSyncing(snapshot.isSyncing);
        setIsOffline(snapshot.isOffline);
        const records = (await repository.listCheckpointRecords?.(shiftId)) ?? [];
        setCheckpointRecords(records);
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
      setData(null);
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
  useEffect(() => {
    const unsubscribe = subscribeSyncState(() => {
      void refreshLocal();
    });
    return unsubscribe;
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
  const recordedMap = new Map<string, Set<string>>();
  for (const record of checkpointRecords) {
    if (record.serverResult === 'rejected') continue;
    for (const item of record.countedFor) {
      const key = `${item.roundId}:${item.windowIndex}`;
      let set = recordedMap.get(key);
      if (!set) {
        set = new Set<string>();
        recordedMap.set(key, set);
      }
      set.add(record.checkpointId);
    }
  }
  const progress = data ? currentRoundProgress(data, now.toISOString(), recordedMap) : [];
  const rejectedRecords = checkpointRecords.filter((r) => r.serverResult === 'rejected');
  const checkpointNames = new Map(
    data?.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint.name]) ?? [],
  );
  return (
    <Screen scroll>
      <Text variant="heading" accessibilityRole="header">
        Turno
      </Text>
      {startsAt && endsAt && (
        <Card>
          <Text variant="title">{shift?.siteName ?? scheduled?.site.name}</Text>
          <Text>
            Horario: {formatTime(startsAt)}–{formatTime(endsAt)}
          </Text>
          {data && (
            <>
              <Badge
                tone={pendingClose ? 'warning' : 'signal'}
                label={pendingClose ? 'Cerrado, pendiente de envío' : 'En curso'}
              />
              {isOffline && (
                <View accessible accessibilityRole="text">
                  <Badge tone="warning" label="Sin conexión" />
                </View>
              )}
              {isSyncing && (
                <View accessible accessibilityRole="text">
                  <Badge tone="info" label="Enviando…" />
                </View>
              )}
              <View accessible accessibilityRole="text">
                <Badge
                  tone="warning"
                  label={
                    pendingCount === 1
                      ? '1 registro pendiente de envío'
                      : `${pendingCount} registros pendientes de envío`
                  }
                />
              </View>
              <Text accessibilityRole="text" color="mutedForeground">
                {lastSyncAt
                  ? `Último envío: ${formatTime(lastSyncAt, data.shift.timezone)}`
                  : 'Todavía no se envió nada'}
              </Text>
            </>
          )}
        </Card>
      )}
      {!data && scheduled && (
        <Button
          label="Iniciar turno"
          variant="signal"
          size="lg"
          disabled={busy || !startAllowed}
          onPress={() => void start()}
        />
      )}
      {!data && !scheduled && (
        <Banner tone="warning">El turno no está disponible o ya no está asignado.</Banner>
      )}
      {data && (
        <>
          {pendingClose && <Banner tone="warning">Turno cerrado, pendiente de envío.</Banner>}
          {lateStartMinutes(data.shift.startsAt, data.serverTime.serverNowUtc) !== null && (
            <Text>
              Inicio tardío: {lateStartMinutes(data.shift.startsAt, data.serverTime.serverNowUtc)}{' '}
              minutos.
            </Text>
          )}
          {!pendingClose && (
            <>
              <Button
                label="Escanear código QR"
                variant="signal"
                size="lg"
                onPress={() => router.push('/escaneo')}
              />
              {rejectedRecords.length > 0 && (
                <Banner tone="danger" title="Registros observados por el servidor">
                  {rejectedRecords.map((r) => (
                    <Text key={r.recordId} color="danger">
                      • {r.checkpointName}: {formatServerReason(r.serverReason)}
                    </Text>
                  ))}
                </Banner>
              )}
              <Text variant="heading">Ventanas y puntos pendientes</Text>
              {progress.map((round) => {
                const definition = data.rounds.find((item) => item.roundId === round.roundId);
                return (
                  <Card key={round.roundId}>
                    <Text variant="subheading">{definition?.name ?? 'Ronda'}</Text>
                    <Text>
                      {round.currentWindow
                        ? `Ventana ${round.currentWindow.label}`
                        : 'Sin ventana activa'}
                    </Text>
                    {round.currentWindow && (
                      <Text color="mutedForeground">
                        {formatTime(round.currentWindow.startUtc, data.shift.timezone)}–
                        {formatTime(round.currentWindow.endUtc, data.shift.timezone)}
                      </Text>
                    )}
                    {round.pendingCheckpointIds.length ? (
                      round.pendingCheckpointIds.map((id) => (
                        <View key={id} style={styles.checkpoint}>
                          <Text style={styles.checkpointName}>
                            • {checkpointNames.get(id) ?? id}
                          </Text>
                          <Badge tone="warning" label="Pendiente" />
                        </View>
                      ))
                    ) : (
                      <Text color="mutedForeground">Sin puntos pendientes en esta ventana.</Text>
                    )}
                  </Card>
                );
              })}
              {early && (
                <Input
                  label="Motivo del cierre anticipado"
                  accessibilityLabel="Motivo del cierre anticipado"
                  placeholder="Motivo del cierre anticipado"
                  value={reason}
                  onChangeText={setReason}
                  multiline
                />
              )}
              {early && reason.trim().length < 3 && (
                <Text color="mutedForeground">
                  Para cerrar antes de hora, indicá un motivo de al menos 3 caracteres.
                </Text>
              )}
              <Button
                label="Cerrar turno"
                variant="danger"
                disabled={busy || (early && reason.trim().length < 3)}
                onPress={() => void close()}
              />
            </>
          )}
        </>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert">
          {message}
        </Text>
      )}
    </Screen>
  );
}
function formatTime(value: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  }
}
function formatServerReason(reason?: string | null): string {
  switch (reason) {
    case 'outdated_version':
      return 'Código QR desactualizado';
    case 'other_site':
      return 'Este punto no pertenece a tu turno';
    case 'malformed':
      return 'Código QR no válido';
    case 'signature':
      return 'Firma inválida';
    case 'tag_not_associated':
      return 'Etiqueta no asociada';
    case 'tag_replaced':
      return 'Etiqueta reemplazada';
    default:
      return reason ?? 'Rechazado';
  }
}
const styles = StyleSheet.create({
  checkpoint: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  checkpointName: { flexShrink: 1 },
});
