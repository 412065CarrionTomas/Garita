import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
} from '@maplibre/maplibre-react-native';
import type { GuardRoundVersion } from '@garita/shared';
import { space } from '@garita/tokens';
import { useTheme } from '@/ui';
import { env } from '@/config/env';
import { ensureOfflineArea } from './offline-area';
import { routeGeoJson, type PointState } from './route-geojson';

// Fuente del estilo de OpenFreeMap; sin ella los números no se dibujan.
const FONT = ['Noto Sans Bold'];
const PADDING = { top: space[10], right: space[10], bottom: space[10], left: space[10] };

/**
 * Mapa de una ronda: recorrido, puntos numerados en orden (hecho, siguiente o pendiente) y la
 * ubicación del vigilador. Pesado para la GPU: va solo en pantallas de detalle, nunca en listas.
 */
export function RouteMap({
  version,
  stateOf,
  label,
}: {
  version: GuardRoundVersion;
  stateOf?: (checkpointId: string) => PointState;
  label: string;
}) {
  const { colors } = useTheme();
  const { line, points, bounds } = routeGeoJson(version, stateOf);
  // Una descarga por ronda: las versiones de la misma ronda cubren casi la misma zona.
  useEffect(() => {
    const area = routeGeoJson(version).bounds;
    if (area) void ensureOfflineArea(`round:${version.roundId}`, area);
  }, [version]);
  return (
    <View style={styles.frame} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Map style={styles.fill} mapStyle={env.EXPO_PUBLIC_MAP_STYLE_URL} logo={false} compass>
        {bounds && <Camera initialViewState={{ bounds, padding: PADDING }} />}
        <GeoJSONSource id="route" data={line}>
          <Layer
            id="route-line"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': colors.foreground, 'line-width': 4, 'line-opacity': 0.8 }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="points" data={points}>
          <Layer
            id="points-circle"
            type="circle"
            paint={{
              'circle-radius': 13,
              'circle-color': [
                'match',
                ['get', 'state'],
                'done',
                colors.success,
                'next',
                colors.primary,
                colors.card,
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': colors.foreground,
            }}
          />
          <Layer
            id="points-label"
            type="symbol"
            layout={{
              'text-field': ['get', 'label'],
              'text-font': FONT,
              'text-size': 13,
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': [
                'match',
                ['get', 'state'],
                'pending',
                colors.foreground,
                colors.primaryForeground,
              ],
            }}
          />
        </GeoJSONSource>
        <NativeUserLocation androidPreferredFramesPerSecond={10} />
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 1, overflow: 'hidden' },
  fill: { flex: 1 },
});
