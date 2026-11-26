import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES } from '@garita/shared';
import { Badge, Banner, Button, Card, Loading, Text, useTheme } from '@/ui';
import { cachedNotice, useCachedGet } from '@/lib/cached-get';
import { directionsUrl } from '@/lib/maps';
import { isoDay } from '@/features/turnos/shift-range';

const upcomingSchema = z.array(
  z.looseObject({
    id: z.string(),
    status: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    site: z.looseObject({
      name: z.string(),
      address: z.string(),
      latitude: z.coerce.number(),
      longitude: z.coerce.number(),
      accessInstructions: z.string().nullable(),
      company: z.looseObject({ timezone: z.string() }),
    }),
    rounds: z.array(z.looseObject({ round: z.looseObject({ name: z.string() }) })),
    assignments: z.array(z.looseObject({ startsAt: z.string() })),
  }),
);
type Upcoming = z.infer<typeof upcomingSchema>[number];

const dayFormat = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const timeFormat = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function greeting(hour: number) {
  if (hour >= 6 && hour < 12) return 'Buenos días';
  return hour >= 12 && hour < 20 ? 'Buenas tardes' : 'Buenas noches';
}

/** Inicio del vigilador fuera de turno: lo de hoy o, si no hay, el próximo turno. */
export function TodayScreen() {
  const { colors } = useTheme();
  const { data, savedAt, loading, error, reload } = useCachedGet('/mis-turnos', upcomingSchema);
  const now = new Date();
  const today = isoDay(now);
  const shifts = data ?? [];
  const startOf = (shift: Upcoming) => new Date(shift.assignments[0]?.startsAt ?? shift.startsAt);
  const todays = shifts.filter((s) => s.status === 'in_progress' || isoDay(startOf(s)) === today);
  const next = todays.length ? null : shifts.find((s) => startOf(s) > now);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading && !!data}
          onRefresh={reload}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <Text variant="display" accessibilityRole="header">
        {greeting(now.getHours())}
      </Text>
      {error && savedAt ? (
        <Banner tone="warning">{cachedNotice(savedAt)}</Banner>
      ) : (
        error && (
          <Banner tone="danger">
            {error === 'suspended'
              ? SUSPENSION_MESSAGES.guard
              : 'No se pudieron cargar tus turnos. Deslizá hacia abajo para reintentar.'}
          </Banner>
        )
      )}
      {loading && !data && <Loading label="Cargando tus turnos…" />}
      {todays.length > 0 && <Text variant="title">Hoy</Text>}
      {todays.map((shift) => (
        <ShiftCard key={shift.id} shift={shift} startsAt={startOf(shift)} />
      ))}
      {next && (
        <>
          <Text variant="title">Próximo turno</Text>
          <ShiftCard shift={next} startsAt={startOf(next)} />
        </>
      )}
      {data && !todays.length && !next && (
        <Text color="mutedForeground">No tenés turnos en los próximos 14 días.</Text>
      )}
      <Text variant="caption" color="mutedForeground">
        El botón de pánico y los incidentes se habilitan al iniciar el turno.
      </Text>
    </ScrollView>
  );
}

function ShiftCard({ shift, startsAt }: { shift: Upcoming; startsAt: Date }) {
  const router = useRouter();
  const running = shift.status === 'in_progress';
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text variant="heading" style={styles.fill}>
          {`${timeFormat.format(startsAt)}–${timeFormat.format(new Date(shift.endsAt))}`}
        </Text>
        <Badge
          tone={running ? 'info' : 'neutral'}
          variant={running ? 'now' : 'dashed'}
          label={running ? 'En curso' : 'Programado'}
        />
      </View>
      <Text color="mutedForeground">{dayFormat.format(startsAt)}</Text>
      <Text variant="subheading">{shift.site.name}</Text>
      <Text>{shift.site.address}</Text>
      {shift.site.accessInstructions && (
        <Text color="mutedForeground">{`Acceso: ${shift.site.accessInstructions}`}</Text>
      )}
      <Text color="mutedForeground">
        {`Rondas: ${shift.rounds.map(({ round }) => round.name).join(', ') || 'sin rondas'}`}
      </Text>
      <Button
        label={running ? 'Ir a la ronda' : 'Ver turno'}
        onPress={() => router.push(`/turno/${shift.id}`)}
      />
      <Button
        variant="outline"
        label="Cómo llegar"
        accessibilityHint="Abre la app de mapas"
        onPress={() => void Linking.openURL(directionsUrl(shift.site))}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: space[4] },
  card: { gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  fill: { flex: 1 },
});
