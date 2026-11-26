import { ScrollView, StyleSheet } from 'react-native';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES } from '@garita/shared';
import { Banner, Loading, Text } from '@/ui';
import { useRoundVersions } from '@/lib/round-versions';
import { RouteMap } from './route-map';
import type { PointState } from './route-geojson';

const STATE_LABEL: Record<PointState, string> = {
  done: 'marcado',
  next: 'siguiente',
  pending: 'pendiente',
};

/**
 * Recorrido de una versión de ronda: mapa y puntos en orden. Durante el turno llegan los puntos
 * ya marcados y el siguiente; fuera de turno todos se ven pendientes.
 */
export function RoundScreen({
  versionId,
  done = [],
  next,
}: {
  versionId: string;
  done?: string[];
  next?: string;
}) {
  const { versions, loading, error } = useRoundVersions([versionId]);
  const version = versions.get(versionId);
  const doneSet = new Set(done);
  const stateOf = (id: string): PointState =>
    doneSet.has(id) ? 'done' : id === next ? 'next' : 'pending';

  if (!version)
    return loading ? (
      <Loading label="Cargando recorrido…" />
    ) : (
      <Banner tone="danger">
        {error === 'suspended'
          ? SUSPENSION_MESSAGES.guard
          : 'No se pudo cargar el recorrido. Revisá la conexión y volvé a intentar.'}
      </Banner>
    );

  const points = version.checkpoints;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text variant="title">{version.name}</Text>
      <Text color="mutedForeground">
        {`Cada ${version.frequencyMinutes} min · ${version.windowStartLocal}–${version.windowEndLocal} · ${points.length} puntos`}
      </Text>
      <RouteMap
        version={version}
        stateOf={stateOf}
        label={`Mapa del recorrido ${version.name} con ${points.length} puntos numerados en orden`}
      />
      {points.map((point, i) => {
        const state = stateOf(point.id);
        return (
          <Text
            key={point.id}
            variant={state === 'next' ? 'label' : 'body'}
            color={state === 'pending' ? 'foreground' : state === 'done' ? 'success' : 'primary'}
          >
            {`${i + 1}. ${point.name}${point.isIndoor ? ' (interior)' : ''}${state === 'pending' ? '' : ` · ${STATE_LABEL[state]}`}`}
          </Text>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { gap: space[3] } });
