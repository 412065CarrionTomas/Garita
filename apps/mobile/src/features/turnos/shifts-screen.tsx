import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES } from '@garita/shared';
import { Banner, Loading, Segmented, Text, useTheme } from '@/ui';
import { cachedNotice } from '@/lib/cached-get';
import { RangePicker } from './range-picker';
import {
  endDay,
  isoDay,
  monthRange,
  splitByToday,
  totals,
  touches,
  type DayRange,
} from './shift-range';
import { ShiftRow } from './shift-row';
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
  const [site, setSite] = useState(ALL);
  const { shifts, loading, error, savedAt, reload } = useGuardShifts(range);

  // Mientras llega el rango nuevo se ve solo lo que cae dentro de él.
  const inRange = shifts.filter((s) => touches(s, range));
  const sites = [...new Map(inRange.map((s) => [s.site.id, s.site.name])).entries()];
  const visible = site === ALL ? inRange : inRange.filter((s) => s.site.id === site);
  const sum = totals(visible);
  const { upcoming, past } = splitByToday(visible, new Date());
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
      <RangePicker
        range={range}
        marked={new Set(inRange.flatMap((s) => [s.serviceDate, endDay(s)]))}
        onChange={(next) => choose(next, null)}
      />
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

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  header: { gap: space[4], paddingBottom: space[4] },
  section: { paddingVertical: space[2] },
  gap: { height: space[3] },
});
