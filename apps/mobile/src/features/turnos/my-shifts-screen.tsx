import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { space } from '@garita/tokens';
import { Badge, Banner, Button, Card, ListItem, Loading, Text, useTheme } from '@/ui';
import { z } from 'zod';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet, ApiError } from '@/lib/api-client';
import { accountSuspendedResponseSchema, SUSPENSION_MESSAGES } from '@garita/shared';

const shiftsSchema = z.array(
  z.looseObject({
    id: z.string(),
    status: z.string().optional(),
    startsAt: z.string(),
    endsAt: z.string(),
    serviceDate: z.string(),
    site: z.looseObject({ name: z.string(), company: z.looseObject({ timezone: z.string() }) }),
    rounds: z.array(z.looseObject({ round: z.looseObject({ name: z.string() }) })),
    assignments: z.array(z.looseObject({ startsAt: z.string() })),
  }),
);

type ShiftList = z.infer<typeof shiftsSchema>;

export function MyShiftsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [shifts, setShifts] = useState<ShiftList>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setShifts(await apiGet('/mis-turnos', shiftsSchema));
      setError(false);
      setSuspended(false);
    } catch (error) {
      setSuspended(
        error instanceof ApiError &&
          error.status === 402 &&
          accountSuspendedResponseSchema.safeParse(error.payload).success,
      );
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void apiGet('/mis-turnos', shiftsSchema)
        .then((data) => {
          if (mounted) {
            setShifts(data);
            setError(false);
            setSuspended(false);
            setRefreshing(false);
          }
        })
        .catch((error: unknown) => {
          if (mounted) {
            setError(true);
            setSuspended(
              error instanceof ApiError &&
                error.status === 402 &&
                accountSuspendedResponseSchema.safeParse(error.payload).success,
            );
            setRefreshing(false);
          }
        });
      return () => {
        mounted = false;
      };
    }, []),
  );

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      testID="shift-list"
      refreshControl={
        <RefreshControl
          testID="shift-refresh"
          tintColor={colors.primary}
          colors={[colors.primary]}
          refreshing={refreshing}
          onRefresh={() => void load()}
        />
      }
      accessibilityLabel="Próximos turnos"
    >
      <Text variant="title">Mis turnos</Text>
      <Text color="mutedForeground">Próximos 14 días · Deslizá hacia abajo para actualizar.</Text>
      <Button
        variant="outline"
        label="Actualizar turnos"
        accessibilityRole="button"
        accessibilityLabel="Actualizar turnos"
        onPress={() => void load()}
      />
      {refreshing && shifts.length === 0 && <Loading label="Cargando turnos…" />}
      {error && (
        <Banner tone="danger">
          {suspended
            ? SUSPENSION_MESSAGES.guard
            : 'No se pudieron cargar los turnos. Deslizá para reintentar.'}
        </Banner>
      )}
      {!refreshing && !error && shifts.length === 0 && (
        <Card style={styles.empty}>
          <Text>No tenés turnos próximos.</Text>
        </Card>
      )}
      {shifts.map((shift) => (
        <ListItem
          key={shift.id}
          title={`Día del turno: ${formatDay(shift.serviceDate)}`}
          subtitle={`${formatTime(shift.assignments[0]?.startsAt ?? shift.startsAt, shift.site.company.timezone)}–${formatTime(shift.endsAt, shift.site.company.timezone)}`}
          detail={`${shift.site.name}\nRondas: ${shift.rounds.map(({ round }) => round.name).join(', ')}`}
          trailing={
            <Badge
              tone="neutral"
              variant={shift.status === 'in_progress' ? 'now' : 'dashed'}
              label={
                shift.status === 'cancelled_by_suspension'
                  ? 'Cancelado por suspensión'
                  : shift.status === 'in_progress'
                    ? 'En curso'
                    : 'Programado'
              }
            />
          }
          accessibilityRole="button"
          accessibilityLabel={`Ver turno en ${shift.site.name}`}
          onPress={() => router.push(`/turno/${shift.id}`)}
        />
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
  fill: { flex: 1 },
  content: { flexGrow: 1, gap: space[4] },
  empty: { alignItems: 'center' },
});
