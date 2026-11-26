import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { radius, space } from '@garita/tokens';
import {
  Badge,
  Banner,
  Button,
  Card,
  Input,
  PointWindowList,
  Screen,
  Text,
  WindowBar,
  useTheme,
} from '@/ui';
import type { PointItem, PointStatus, WindowStatus } from '@/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { currentRoundProgress, lateStartMinutes, type ShiftOfflineData } from '@garita/shared';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';
import { getSyncSnapshot, subscribeSyncState } from '@/lib/cola';
import { createDefaultFieldRepository, type LocalCheckpointRecord } from '@/lib/db/database';
import { beginShift, finishShift } from './actions';
import { NfcReader } from '@/features/escaneo/nfc-reader';
import { readClock } from '@/lib/clock/clock';
import { LockedPanicPermissionNotice } from '@/features/panico/bloqueado/permission-notice';

const shiftsSchema = z.array(
  z.looseObject({
    id: z.string(),
    status: z.string().optional(),
    startsAt: z.string(),
    endsAt: z.string(),
    site: z.looseObject({ name: z.string() }),
    assignments: z.array(z.looseObject({ startsAt: z.string() })),
    rounds: z
      .array(
        z.looseObject({
          round: z.looseObject({ name: z.string(), currentVersionId: z.string().nullable() }),
        }),
      )
      .optional(),
  }),
);
type ScheduledShift = z.infer<typeof shiftsSchema>[number];

const WINDOW_STAMPS = {
  ontime: { tone: 'neutral', label: 'A tiempo', variant: 'solid' },
  late: { tone: 'warning', label: 'Tarde', variant: 'solid' },
  overdue: { tone: 'warning', label: 'Atrasada', variant: 'solid' },
  missed: { tone: 'danger', label: 'No realizada', variant: 'solid' },
  current: { tone: 'neutral', label: 'En curso', variant: 'now' },
  pending: { tone: 'neutral', label: 'Pendiente', variant: 'dashed' },
} as const satisfies Record<
  WindowStatus | 'overdue',
  { tone: 'neutral' | 'warning' | 'danger'; label: string; variant: 'solid' | 'dashed' | 'now' }
>;

export function ShiftScreen({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
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
      const found = shifts.find((shift) => shift.id === shiftId);
      setScheduled(
        found ? { ...found, startsAt: found.assignments[0]?.startsAt ?? found.startsAt } : null,
      );
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
    const updateNow = () => {
      void createDefaultFieldRepository()
        .then((repository) => readClock(repository, new Date().toISOString()))
        .then((clock) => setNow(new Date(clock.trustedAt ?? clock.deviceTime)))
        .catch(() => setNow(new Date()));
    };
    updateNow();
    const timer = setInterval(updateNow, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        updateNow();
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
  const startAllowed = scheduled ? now.getTime() <= Date.parse(scheduled.endsAt) : false;
  const early = shift ? now.getTime() < Date.parse(shift.endsAt) : false;
  const recordedMap = new Map<string, Set<string>>();
  const lateWindows = new Set<string>();
  // Registro por punto y ventana, para mostrar la hora real y si fue tarde.
  const recordOf = new Map<string, { late: boolean; at: string }>();
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
      if (item.late) lateWindows.add(key);
      recordOf.set(`${key}:${record.checkpointId}`, {
        late: item.late,
        at: record.occurredAtUtc,
      });
    }
  }
  const progress = data ? currentRoundProgress(data, now.toISOString(), recordedMap) : [];
  const rejectedRecords = checkpointRecords.filter((r) => r.serverResult === 'rejected');
  const checkpointNames = new Map(
    data?.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint.name]) ?? [],
  );
  const timezone = data?.shift.timezone;
  const windowStatusOf = (
    window: ShiftOfflineData['windows'][number],
    required: number,
  ): WindowStatus | 'overdue' => {
    const at = now.getTime();
    if (at < Date.parse(window.startUtc)) return 'pending';
    if (at < Date.parse(window.endUtc)) return 'current';
    const key = `${window.roundId}:${window.index}`;
    if ((recordedMap.get(key)?.size ?? 0) < required) {
      const grace =
        data?.rounds.find((round) => round.roundId === window.roundId)?.graceMinutes ?? 0;
      return at < Date.parse(window.endUtc) + grace * 60_000 ? 'overdue' : 'missed';
    }
    return lateWindows.has(key) ? 'late' : 'ontime';
  };
  const roundWindows = (roundId: string, required: number) =>
    (data?.windows ?? [])
      .filter((window) => window.roundId === roundId)
      .map((window) => ({ window, status: windowStatusOf(window, required) }));
  const nextPoint = progress
    .map((round) => round.pendingCheckpointIds[0])
    .find((id): id is string => id !== undefined);
  const activeRounds = progress.filter((round) => round.currentWindow !== null);
  const roundComplete =
    activeRounds.length > 0 &&
    activeRounds.every((round) => round.pendingCheckpointIds.length === 0);
  const closureRows = (data?.windows ?? [])
    .map((window) => {
      const definition = data?.rounds.find((item) => item.roundId === window.roundId);
      return {
        window,
        round: definition,
        status: windowStatusOf(window, definition?.checkpointIds.length ?? 0),
      };
    })
    .sort((a, b) => Date.parse(a.window.startUtc) - Date.parse(b.window.startUtc));
  const completedWindows = closureRows.filter(
    (row) => row.status === 'ontime' || row.status === 'late',
  ).length;
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
                tone={pendingClose ? 'warning' : 'neutral'}
                variant={pendingClose ? 'solid' : 'now'}
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
      {!data && scheduled && scheduled.status !== 'in_progress' && (
        <Button
          label="Iniciar turno"
          size="lg"
          disabled={busy || !startAllowed}
          onPress={() => void start()}
        />
      )}
      {!data &&
        scheduled?.rounds?.map(({ round }) =>
          round.currentVersionId ? (
            <Button
              key={round.currentVersionId}
              variant="outline"
              label={`Ver recorrido: ${round.name}`}
              onPress={() =>
                router.push({
                  pathname: '/recorridos',
                  params: { ids: round.currentVersionId ?? '' },
                })
              }
            />
          ) : null,
        )}
      {!data && (scheduled?.rounds?.length ?? 0) > 1 && (
        <Button
          variant="outline"
          label="Ver todos los recorridos"
          onPress={() =>
            router.push({
              pathname: '/recorridos',
              params: {
                ids: (scheduled?.rounds ?? [])
                  .flatMap(({ round }) => round.currentVersionId ?? [])
                  .join(','),
              },
            })
          }
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
              <LockedPanicPermissionNotice shiftId={shiftId} />
              <NfcReader shiftData={data} onSaved={refreshLocal} />
              {progress.map((round) => {
                const definition = data.rounds.find((item) => item.roundId === round.roundId);
                const ids = definition?.checkpointIds ?? [];
                const pending = new Set(round.pendingCheckpointIds);
                const windowKey = round.currentWindow
                  ? `${round.roundId}:${round.currentWindow.index}`
                  : null;
                const windowRange = round.currentWindow
                  ? `${formatTime(round.currentWindow.startUtc, timezone)}–${formatTime(round.currentWindow.endUtc, timezone)}`
                  : null;
                let currentIndex = -1;
                const points: PointItem[] = ids.map((id, index) => {
                  const record = windowKey ? recordOf.get(`${windowKey}:${id}`) : undefined;
                  let status: PointStatus = 'pending';
                  if (round.currentWindow) {
                    if (!pending.has(id)) status = record?.late ? 'late' : 'done';
                    else if (currentIndex === -1) {
                      status = 'current';
                      currentIndex = index;
                    }
                  }
                  return {
                    id,
                    number: index + 1,
                    name: checkpointNames.get(id) ?? id,
                    status,
                    time: record ? formatTime(record.at, timezone) : undefined,
                    window: status === 'current' ? (windowRange ?? undefined) : undefined,
                  };
                });
                const done = round.currentWindow ? ids.length - pending.size : 0;
                return (
                  <View key={round.roundId} style={styles.round}>
                    <View style={styles.roundHead}>
                      <View style={[styles.initial, { borderColor: colors.foreground }]}>
                        <Text variant="title" accessibilityRole="none">
                          {(definition?.name ?? 'R').charAt(0)}
                        </Text>
                      </View>
                      <View style={styles.roundTitle}>
                        <Text variant="heading" accessibilityRole="header">
                          {definition?.name ?? 'Ronda'}
                        </Text>
                        <Text color="mutedForeground">
                          {data.shift.siteName} · {formatTime(data.shift.startsAt, timezone)}–
                          {formatTime(data.shift.endsAt, timezone)}
                        </Text>
                      </View>
                    </View>
                    <Text>
                      {round.currentWindow
                        ? `${done} de ${ids.length} puntos · Ventana ${windowRange}`
                        : 'Sin ventana activa'}
                    </Text>
                    <WindowBar
                      windows={roundWindows(round.roundId, ids.length).map((item) =>
                        item.status === 'overdue' ? 'current' : item.status,
                      )}
                    />
                    {/* TODO(foja): la lista anidada en el scroll de la pantalla puede pelear con el gesto en Android. */}
                    <PointWindowList
                      points={points}
                      currentIndex={currentIndex === -1 ? Math.max(0, done - 1) : currentIndex}
                    />
                    {definition && (
                      <Button
                        variant="outline"
                        label="Ver recorrido en el mapa"
                        onPress={() =>
                          router.push({
                            pathname: '/recorridos',
                            params: {
                              ids: definition.roundVersionId,
                              hechos: points
                                .filter((p) => p.status === 'done' || p.status === 'late')
                                .map((p) => p.id)
                                .join(','),
                              siguiente:
                                currentIndex === -1 ? '' : (points[currentIndex]?.id ?? ''),
                            },
                          })
                        }
                      />
                    )}
                  </View>
                );
              })}
              {roundComplete ? (
                <Banner tone="success" role="text" accessibilityLiveRegion="polite">
                  Ronda completa. Se enviará a supervisión apenas recuperes señal.
                </Banner>
              ) : (
                <Button
                  label={
                    nextPoint
                      ? `Escanear ${checkpointNames.get(nextPoint) ?? nextPoint}`
                      : 'Escanear código QR'
                  }
                  size="lg"
                  onPress={() => router.push('/escaneo')}
                />
              )}
              <Button
                label="Reportar incidente"
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/turno/[id]/incidente', params: { id: shiftId } })
                }
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
              <Text variant="heading" accessibilityRole="header">
                Cierre de turno
              </Text>
              <Text color="mutedForeground">
                {completedWindows} de {closureRows.length} ventanas completas
              </Text>
              {closureRows.map(({ window, round, status }) => {
                const stamp = WINDOW_STAMPS[status];
                const name = `${data.rounds.length > 1 && round ? `${round.name} · ` : ''}Ventana ${window.index + 1}`;
                return (
                  <View
                    key={`${window.roundId}:${window.index}`}
                    accessible
                    accessibilityLabel={`${formatTime(window.startUtc, timezone)}, ${name}, ${stamp.label}`}
                    style={[styles.closureRow, { borderColor: colors.border }]}
                  >
                    <Text variant="numeral">{formatTime(window.startUtc, timezone)}</Text>
                    <Text style={styles.closureName}>{name}</Text>
                    <Badge {...stamp} />
                  </View>
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
      {!data && scheduled?.status === 'in_progress' && (
        <Banner tone="warning" role="text">
          Tu turno está en curso, pero faltan sus datos en este celular. Contactá a tu supervisor
          para continuar.
        </Banner>
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
  round: { gap: space[3] },
  roundHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  roundTitle: { flex: 1 },
  initial: {
    width: space[12],
    height: space[12],
    borderWidth: 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderBottomWidth: 1,
    paddingVertical: space[2],
  },
  closureName: { flex: 1 },
});
