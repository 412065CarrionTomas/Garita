import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';

const shiftsSchema = z.array(
  z.looseObject({
    id: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    serviceDate: z.string(),
    site: z.looseObject({ name: z.string(), company: z.looseObject({ timezone: z.string() }) }),
    rounds: z.array(z.looseObject({ round: z.looseObject({ name: z.string() }) })),
  }),
);

type ShiftList = z.infer<typeof shiftsSchema>;

export function MyShiftsScreen() {
  const [shifts, setShifts] = useState<ShiftList>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setShifts(await apiGet('/mis-turnos', shiftsSchema));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    void apiGet('/mis-turnos', shiftsSchema)
      .then((data) => {
        if (mounted) {
          setShifts(data);
          setError(false);
          setRefreshing(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(true);
          setRefreshing(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="shift-list"
      refreshControl={
        <RefreshControl
          testID="shift-refresh"
          refreshing={refreshing}
          onRefresh={() => void load()}
        />
      }
      accessibilityLabel="Próximos turnos"
    >
      <Text style={styles.title}>Mis turnos</Text>
      <Text style={styles.help}>Próximos 14 días · Deslizá hacia abajo para actualizar.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void load()}
        style={styles.refreshButton}
      >
        <Text style={styles.refreshText}>Actualizar turnos</Text>
      </Pressable>
      {refreshing && shifts.length === 0 && (
        <Text accessibilityRole="progressbar">Cargando turnos…</Text>
      )}
      {error && (
        <Text accessibilityRole="alert">
          No se pudieron cargar los turnos. Deslizá para reintentar.
        </Text>
      )}
      {!refreshing && !error && shifts.length === 0 && <Text>No tenés turnos próximos.</Text>}
      {shifts.map((shift) => (
        <View key={shift.id} style={styles.card}>
          <Text style={styles.site}>{shift.site.name}</Text>
          <Text>Día del turno: {formatDay(shift.serviceDate)}</Text>
          <Text>
            {formatTime(shift.startsAt, shift.site.company.timezone)}–
            {formatTime(shift.endsAt, shift.site.company.timezone)}
          </Text>
          <Text>Rondas: {shift.rounds.map(({ round }) => round.name).join(', ')}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 14, padding: 24 },
  title: { fontSize: 30, fontWeight: '700' },
  help: { fontSize: 16 },
  card: { gap: 8, borderWidth: 1, borderColor: '#a3a3a3', borderRadius: 8, padding: 18 },
  site: { fontSize: 20, fontWeight: '600' },
  refreshButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: '#174ea6',
    padding: 14,
  },
  refreshText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
