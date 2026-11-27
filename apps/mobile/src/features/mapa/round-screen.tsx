import { useState } from 'react';
import { ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES, type GuardRoundVersion } from '@garita/shared';
import { Banner, Loading, Text, useTheme } from '@/ui';
import { useRoundVersions } from '@/lib/round-versions';
import { RouteMap, roundStyle } from './route-map';
import { roundInitial, type PointState } from './route-geojson';

const STATE_LABEL: Record<PointState, string> = {
  done: 'marcado',
  next: 'siguiente',
  pending: 'pendiente',
};

/**
 * Recorrido de una o varias rondas: mapa y puntos en orden. Con varias, cada una lleva su tipo de
 * línea y su inicial (leyenda arriba). Durante el turno llegan los puntos marcados y el siguiente.
 */
export function RoundScreen({
  versionIds,
  done = [],
  next,
  live = false,
}: {
  versionIds: string[];
  done?: string[];
  next?: string;
  /** Abierto desde la Ronda en curso: muestra la ubicación del vigilador. */
  live?: boolean;
}) {
  // Sin repetidos: un id dos veces en el enlace no duplica capas ni claves.
  const ids = [...new Set(versionIds)];
  const { versions: found, partial, loading, error } = useRoundVersions(ids);
  // Con un dedo sobre el mapa la pantalla no se desplaza: si no, el ScrollView le roba el gesto.
  const [onMap, setOnMap] = useState(false);
  const releaseMap = (event: GestureResponderEvent) => {
    if (!event.nativeEvent.touches.length) setOnMap(false);
  };
  const versions = ids.flatMap((id) => found.get(id) ?? []);
  const doneSet = new Set(done);
  const stateOf = (id: string): PointState =>
    doneSet.has(id) ? 'done' : id === next ? 'next' : 'pending';

  if (!versions.length)
    return loading ? (
      <Loading label="Cargando recorrido…" />
    ) : (
      <Banner tone="danger">
        {error === 'suspended'
          ? SUSPENSION_MESSAGES.guard
          : 'No se pudo cargar el recorrido. Revisá la conexión y volvé a intentar.'}
      </Banner>
    );

  const many = versions.length > 1;
  const names = versions.map((v) => v.name).join(' y ');
  return (
    <ScrollView testID="round-scroll" contentContainerStyle={styles.content} scrollEnabled={!onMap}>
      <Text variant="title">{many ? 'Recorridos del turno' : (versions[0]?.name ?? '')}</Text>
      {many ? (
        versions.map((version, i) => <Legend key={version.id} version={version} index={i} />)
      ) : (
        <Text color="mutedForeground">{summary(versions[0])}</Text>
      )}
      {partial && (
        <Banner tone="warning">
          Algún recorrido no se pudo cargar sin señal. Se muestran los que están en el celular.
        </Banner>
      )}
      <View
        testID="route-map-frame"
        onTouchStart={() => setOnMap(true)}
        onTouchEnd={releaseMap}
        onTouchCancel={() => setOnMap(false)}
      >
        <RouteMap
          live={live}
          versions={versions}
          stateOf={stateOf}
          label={`Mapa con ${many ? 'los recorridos' : 'el recorrido'} ${names}, puntos numerados en orden`}
        />
      </View>
      {versions.map((version) => (
        <View key={version.id} style={styles.group}>
          {many && <Text variant="subheading">{version.name}</Text>}
          {version.checkpoints.map((point, i) => {
            const state = stateOf(point.id);
            return (
              <Text
                key={point.id}
                variant={state === 'next' ? 'label' : 'body'}
                color={
                  state === 'pending' ? 'foreground' : state === 'done' ? 'success' : 'primary'
                }
              >
                {`${many ? roundInitial(version) : ''}${i + 1}. ${point.name}${point.isIndoor ? ' (interior)' : ''}${state === 'pending' ? '' : ` · ${STATE_LABEL[state]}`}`}
              </Text>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const summary = (version?: GuardRoundVersion) =>
  version
    ? `Cada ${version.frequencyMinutes} min · ${version.windowStartLocal}–${version.windowEndLocal} · ${version.checkpoints.length} puntos`
    : '';

/** Muestra de la línea de la ronda, su inicial y su frecuencia: la leyenda no depende del color. */
function Legend({ version, index }: { version: GuardRoundVersion; index: number }) {
  const { colors } = useTheme();
  const style = roundStyle(index);
  return (
    <View style={styles.legend}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.swatch, { borderColor: colors[style.color], borderStyle: style.border }]}
      />
      <Text style={styles.fill}>
        {`${roundInitial(version)} · ${version.name} (${style.name}) · ${summary(version)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space[3] },
  group: { gap: space[1] },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  swatch: { width: space[8], borderTopWidth: 3 },
  fill: { flex: 1 },
});
