import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES, type GuardShift } from '@garita/shared';
import { Badge, Banner, Button, ListItem, Loading, Segmented, Text, useTheme } from '@/ui';
import { cachedNotice } from '@/lib/cached-get';
import { RangeCalendar } from './range-calendar';
import { isoDay, monthRange, shiftStamp, splitByToday, totals, type DayRange } from './shift-range';
import { useGuardShifts } from './use-guard-shifts';

type Preset = 'month' | 'next' | 'last';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'month', label: 'Este mes' },
  { value: 'next', label: 'Próximos 30 días' },
  { value: 'last', label: 'Últimos 30 días' },
];
const ALL = 'all';

function presetRange(preset: Preset, now = new Date()): DayRange {
  const shifted = (days: number) =>
    isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  if (preset === 'next') return { desde: isoDay(now), hasta: shifted(30) };
  if (preset === 'last') return { desde: shifted(-30), hasta: isoDay(now) };
  return monthRange(now);
}

/** Agenda e historial en una sola lista: lo que viene arriba, lo hecho abajo, con rango libre. */
export function ShiftsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [range, setRange] = useState(() => presetRange('month'));
  const [preset, setPreset] = useState<Preset | null>('month');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [site, setSite] = useState(ALL);
  const { shifts, loading, error, savedAt, reload } = useGuardShifts(range);

  // Mientras llega el rango nuevo se ve solo lo que cae dentro de él.
  const inRange = shifts.filter(
    (s) => s.serviceDate >= range.desde && s.serviceDate <= range.hasta,
  );
  const sites = [...new Map(inRange.map((s) => [s.site.id, s.site.name])).entries()];
  const visible = site === ALL ? inRange : inRange.filter((s) => s.site.id === site);
  const sum = totals(visible);
  const { upcoming, past } = splitByToday(visible, isoDay(new Date()));
  const sections = [
    { title: 'Próximos', data: upcoming },
    { title: 'Anteriores', data: past },
  ].filter((section) => section.data.length > 0);

  const choose = (next: DayRange, nextPreset: Preset | null) => {
    setRange(next);
    setPreset(nextPreset);
    setSite(ALL);
  };

  const header = (
    <View style={styles.header}>
      <Text variant="title">Turnos</Text>
      <Segmented
        label="Período"
        options={PRESETS}
        value={preset}
        onChange={(value) => choose(presetRange(value), value)}
      />
      <Button
        variant="outline"
        label={`${formatDate(range.desde)} – ${formatDate(range.hasta)}`}
        accessibilityLabel={`Rango del ${formatDate(range.desde)} al ${formatDate(range.hasta)}. ${calendarOpen ? 'Cerrar' : 'Abrir'} calendario`}
        onPress={() => setCalendarOpen((open) => !open)}
      />
      {calendarOpen && (
        <RangeCalendar
          range={range}
          marked={new Set(inRange.map((s) => s.serviceDate))}
          onChange={(next) => choose(next, null)}
        />
      )}
      {sites.length > 1 && (
        <Segmented
          label="Predio"
          options={[
            { value: ALL, label: 'Todos' },
            ...sites.map(([value, label]) => ({ value, label })),
          ]}
          value={site}
          onChange={setSite}
        />
      )}
      <Text color="mutedForeground">
        {`${sum.count} ${sum.count === 1 ? 'turno' : 'turnos'} · ${sum.worked} h trabajadas · ${sum.planned} h por trabajar`}
      </Text>
      {savedAt ? (
        <Banner tone="warning">{cachedNotice(savedAt)}</Banner>
      ) : (
        error && (
          <Banner tone="danger">
            {error === 'suspended'
              ? SUSPENSION_MESSAGES.guard
              : 'No se pudieron cargar los turnos. Deslizá hacia abajo para reintentar.'}
          </Banner>
        )
      )}
      {loading && visible.length === 0 && <Loading label="Cargando turnos…" />}
    </View>
  );

  return (
    <SectionList
      sections={sections}
      keyExtractor={(shift) => shift.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading || error ? null : <Text color="mutedForeground">No hay turnos en este rango.</Text>
      }
      renderSectionHeader={({ section }) => (
        <Text
          variant="label"
          color="mutedForeground"
          style={[styles.section, { backgroundColor: colors.background }]}
        >
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <ShiftRow shift={item} onOpen={(id) => router.push(`/turno/${id}`)} />
      )}
      ItemSeparatorComponent={Gap}
      refreshControl={
        <RefreshControl
          refreshing={loading && visible.length > 0}
          onRefresh={reload}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      stickySectionHeadersEnabled
    />
  );
}

function ShiftRow({ shift, onOpen }: { shift: GuardShift; onOpen: (id: string) => void }) {
  const stamp = shiftStamp(shift);
  const s = shift.summary;
  const opens = shift.status === 'scheduled' || shift.status === 'in_progress';
  return (
    <ListItem
      title={`${formatDay(shift.serviceDate)} · ${formatTime(shift.startsAt, shift.site.timezone)}–${formatTime(shift.endsAt, shift.site.timezone)}`}
      subtitle={shift.site.name}
      detail={
        s
          ? `Ventanas ${s.windowsDone}/${s.windows} · Puntos ${s.recorded}/${s.expected}${s.incidents ? ` · ${s.incidents} ${s.incidents === 1 ? 'incidente' : 'incidentes'}` : ''}`
          : `Rondas: ${shift.rounds.join(', ') || 'sin rondas'}`
      }
      trailing={
        <Badge tone={stamp.tone} variant={opens ? 'dashed' : 'solid'} label={stamp.label} />
      }
      disabled={!opens}
      accessibilityRole={opens ? 'button' : 'text'}
      accessibilityHint={opens ? 'Abre el turno' : undefined}
      onPress={opens ? () => onOpen(shift.id) : undefined}
    />
  );
}

const Gap = () => <View style={styles.gap} />;

const dayFormat = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);
const formatDay = (day: string) => dayFormat.format(atNoon(day));
const formatDate = (day: string) => dateFormat.format(atNoon(day));

// Un formateador por zona horaria: crearlos es caro en Hermes.
const timeFormats = new Map<string, Intl.DateTimeFormat>();
function formatTime(value: string, timeZone: string) {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    });
    timeFormats.set(timeZone, format);
  }
  return format.format(new Date(value));
}

const styles = StyleSheet.create({
  header: { gap: space[4], paddingBottom: space[4] },
  section: { paddingVertical: space[2] },
  gap: { height: space[3] },
});
