import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { radius, space, touch } from '@garita/tokens';
import { z } from 'zod';
import { Banner, Button, Icon, Loading, Screen, Segmented, Text, useTheme } from '@/ui';
import { apiGet } from '@/lib/api-client';
import { NfcBlocker, useNfcState } from '@/features/etiquetas/nfc-status';
import {
  BackHeader,
  PointNumber,
  ProgressBar,
  TagStatus,
  TAG_TEXT,
} from '@/features/etiquetas/parts';
import { ScanSheet, type SheetPoint } from '@/features/etiquetas/scan-sheet';

const pointsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    position: z.number(),
    tagType: z.enum(['qr', 'nfc_basic', 'nfc_secure']),
  }),
);

type Filter = 'pending' | 'all';

/** Puntos del predio en el orden de la ronda; desde acá se etiquetan uno por uno o en serie. */
export default function SitePointsRoute() {
  const { id, nombre } = useLocalSearchParams<{ id: string; nombre?: string }>();
  const nfc = useNfcState();
  const [points, setPoints] = useState<SheetPoint[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null);
  // La serie guarda los pendientes al empezar: la lista se refresca pero el orden no cambia.
  const [sheet, setSheet] = useState<{ ids: string[]; index: number; series: boolean } | null>(
    null,
  );
  const [auto, setAuto] = useState(false);

  const load = useCallback(() => {
    apiGet(`/predios/${encodeURIComponent(id)}/puntos`, pointsSchema)
      .then((loaded) => {
        setPoints(loaded);
        setError(false);
      })
      .catch(() => setError(true));
  }, [id]);
  useEffect(load, [load]);
  const onNext = useCallback(
    () => setSheet((current) => current && { ...current, index: current.index + 1 }),
    [],
  );
  const onClose = useCallback(() => setSheet(null), []);

  const pending = (points ?? []).filter((point) => point.tagType === 'qr');
  const shown = filter ?? (pending.length ? 'pending' : 'all');
  const list = shown === 'pending' ? pending : (points ?? []);
  const find = (pointId?: string) => points?.find((point) => point.id === pointId) ?? null;
  const total = points?.length ?? 0;
  const ready = nfc === 'ready';

  return (
    <Screen>
      <BackHeader title={nombre ?? 'Predio'} />
      <NfcBlocker state={nfc} />
      {error && (
        <Banner tone="danger">No se pudieron cargar los puntos. Revisá la conexión.</Banner>
      )}
      {!points && !error && <Loading label="Cargando puntos…" />}
      {points && (
        <>
          <View style={styles.progress}>
            <Text variant="subheading">
              {total
                ? `${total - pending.length} de ${total} puntos con etiqueta`
                : 'Este predio no tiene puntos'}
            </Text>
            {!!total && <ProgressBar done={total - pending.length} total={total} />}
          </View>
          {!!total && (
            <Segmented<Filter>
              label="Puntos a mostrar"
              value={shown}
              onChange={setFilter}
              options={[
                { value: 'pending', label: `Pendientes (${pending.length})` },
                { value: 'all', label: `Todos (${total})` },
              ]}
            />
          )}
          <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
            {shown === 'pending' && !pending.length && !!total && (
              <View style={styles.allDone}>
                <Icon name="check" size={28} color="success" />
                <Text variant="heading" color="success" style={styles.flex}>
                  Todos los puntos tienen etiqueta
                </Text>
              </View>
            )}
            {list.map((point) => (
              <PointRow
                key={point.id}
                point={point}
                disabled={!ready && point.tagType === 'qr'}
                onPress={() => setSheet({ ids: [point.id], index: 0, series: false })}
              />
            ))}
          </ScrollView>
          {!!pending.length && (
            <Button
              size="lg"
              label={`Etiquetar pendientes (${pending.length})`}
              accessibilityLabel={`Etiquetar en orden los ${pending.length} puntos pendientes`}
              disabled={!ready}
              onPress={() =>
                setSheet({
                  ids: [...pending].sort((a, b) => a.position - b.position).map((p) => p.id),
                  index: 0,
                  series: true,
                })
              }
            />
          )}
        </>
      )}
      <ScanSheet
        point={find(sheet?.ids[sheet.index])}
        series={sheet?.series ?? false}
        next={find(sheet?.ids[sheet.index + 1])}
        remaining={sheet ? sheet.ids.length - sheet.index : 0}
        auto={auto}
        onAutoChange={setAuto}
        onNext={onNext}
        onClose={onClose}
        onChanged={load}
      />
    </Screen>
  );
}

function PointRow({
  point,
  disabled,
  onPress,
}: {
  point: SheetPoint;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tagged = point.tagType !== 'qr';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Punto ${point.position}, ${point.name}. ${TAG_TEXT[point.tagType]}`}
      accessibilityHint={tagged ? 'Reemplazar o quitar la etiqueta' : 'Asociar una etiqueta'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <PointNumber position={point.position} done={tagged} />
      <View style={styles.texts}>
        <Text variant="subheading">{point.name}</Text>
        <TagStatus type={point.tagType} />
      </View>
      <Icon name="forward" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  progress: { gap: space[2] },
  list: { gap: space[3], paddingBottom: space[2] },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touch.action,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[4],
  },
  texts: { flex: 1, gap: space[1] },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
