import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, space } from '@garita/tokens';
import type { PendingFieldEvent } from '@garita/shared';
import { Badge, Banner, Button, Screen, Text, useTheme } from '@/ui';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { getSyncSnapshot, processSyncQueue, subscribeSyncState } from '@/lib/cola';
import type { SyncStateSnapshot } from '@/lib/cola';

const TYPE_LABELS: Record<string, string> = {
  checkpoint_record: 'Escaneo de punto',
  incident: 'Incidente',
  shift_start: 'Inicio de turno',
  shift_close: 'Cierre de turno',
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Envío: la cola local de registros que todavía no llegaron al servidor. Todo se guarda en el
 * celular y se envía solo al recuperar señal; "Enviar ahora" fuerza un intento.
 */
export function SendScreen() {
  const { colors } = useTheme();
  const [events, setEvents] = useState<PendingFieldEvent[]>([]);
  const [snapshot, setSnapshot] = useState<SyncStateSnapshot | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<'sent' | 'offline' | null>(null);

  const load = useCallback(async () => {
    try {
      const repository = await createDefaultFieldRepository();
      return { events: await repository.listPendingEvents(), snapshot: await getSyncSnapshot() };
    } catch {
      return { events: [], snapshot: null };
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void load().then((next) => {
        if (!active) return;
        setEvents(next.events);
        setSnapshot(next.snapshot);
      });
    };
    refresh();
    const unsubscribe = subscribeSyncState(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const sendNow = async () => {
    setSending(true);
    setResult(null);
    try {
      const outcome = await processSyncQueue();
      setResult(outcome.success ? 'sent' : 'offline');
    } finally {
      setSending(false);
      const next = await load();
      setEvents(next.events);
      setSnapshot(next.snapshot);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="title">Para enviar</Text>
        <Text color="mutedForeground">Se guardan en el celular hasta tener señal.</Text>
      </View>
      {snapshot?.isOffline ? (
        <Banner tone="info" role="text">
          Sin señal: los registros esperan en el celular y se reintentan solos.
        </Banner>
      ) : null}
      {result === 'sent' ? (
        <Banner tone="success" accessibilityLiveRegion="polite">
          Registros enviados.
        </Banner>
      ) : null}
      {result === 'offline' ? (
        <Banner tone="warning" accessibilityLiveRegion="polite">
          Sin señal: no se pudo enviar. Se reintenta solo.
        </Banner>
      ) : null}
      {events.length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text variant="heading">Todo enviado</Text>
          <Text color="mutedForeground">No hay registros pendientes en este celular.</Text>
        </View>
      ) : (
        <View accessibilityRole="list">
          {events.map((event) => (
            <View key={event.id} accessible style={[styles.row, { borderColor: colors.border }]}>
              <View style={styles.texts}>
                <Text variant="subheading">{TYPE_LABELS[event.type] ?? 'Registro'}</Text>
                <Text variant="caption" color="mutedForeground">
                  Registrado {hhmm(event.occurredAtDevice)}
                </Text>
              </View>
              <Badge variant="dashed" label="En el celular" />
            </View>
          ))}
        </View>
      )}
      <Button
        size="lg"
        label={sending ? 'Enviando…' : 'Enviar ahora'}
        loading={sending}
        disabled={events.length === 0}
        onPress={() => void sendNow()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 64,
    borderBottomWidth: 1,
    paddingVertical: space[2],
  },
  texts: { flex: 1, gap: space[0.5] },
  empty: {
    gap: space[1],
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: space[4],
  },
});
