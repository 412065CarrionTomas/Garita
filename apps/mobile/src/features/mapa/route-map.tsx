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
import { colors as palettes, space, type ColorToken } from '@garita/tokens';
import { env } from '@/config/env';
import { ensureOfflineArea } from './offline-area';
import { routeGeoJson, type PointState } from './route-geojson';

// Fuente del estilo de OpenFreeMap; sin ella los números no se dibujan.
const FONT = ['Noto Sans Bold'];
const PADDING = { top: space[10], right: space[10], bottom: space[10], left: space[10] };

interface RoundStyle {
  color: ColorToken;
  dash?: number[];
  /** El mismo trazo en la leyenda, fuera del mapa. */
  border: 'solid' | 'dashed' | 'dotted';
  name: string;
}
const SOLID: RoundStyle = { color: 'foreground', border: 'solid', name: 'línea llena' };
/**
 * Cómo se distingue cada ronda: tinta y tipo de línea (llena, rayada, punteada), para no depender
 * solo del color. Con más de tres rondas se repiten; la inicial en los puntos las sigue separando.
 */
const ROUND_STYLES: RoundStyle[] = [
  SOLID,
  { color: 'info', dash: [2, 1.5], border: 'dashed', name: 'línea rayada' },
  { color: 'mutedForeground', dash: [0.5, 1.5], border: 'dotted', name: 'línea punteada' },
];
export const roundStyle = (index: number) => ROUND_STYLES[index % ROUND_STYLES.length] ?? SOLID;

/**
 * Mapa de una o varias rondas: recorridos, puntos numerados en orden (hecho, siguiente o
 * pendiente) y la ubicación del vigilador. Pesado para la GPU: va solo en pantallas de detalle,
 * nunca en listas.
 */
export function RouteMap({
  versions,
  stateOf,
  label,
  live = false,
}: {
  versions: GuardRoundVersion[];
  stateOf?: (checkpointId: string) => PointState;
  label: string;
  /** Muestra la ubicación del vigilador: solo durante el turno (finalidad Ley 25.326). */
  live?: boolean;
}) {
  // El mapa base (Positron) es claro en los dos temas: se dibuja con la tinta del tema claro.
  const colors = palettes.light;
  const { line, points, bounds } = routeGeoJson(versions, stateOf);
  // Una descarga por ronda: las versiones de la misma ronda cubren casi la misma zona.
  useEffect(() => {
    for (const version of versions) {
      const area = routeGeoJson([version]).bounds;
      if (area) void ensureOfflineArea(`round:${version.roundId}`, area);
    }
  }, [versions]);
  if (!versions.length) return null;
  const strokeByRound =
    versions.length === 1
      ? colors[roundStyle(0).color]
      : // El tipo de `match` no admite pares armados con un spread; el valor es válido.
        ([
          'match',
          ['get', 'round'],
          ...versions.flatMap((_, n) => [n, colors[roundStyle(n).color]]),
          colors.foreground,
        ] as never);
  return (
    // Sin `accessible` en el contenedor: la atribución de OpenStreetMap y la brújula siguen al alcance.
    <View style={styles.frame}>
      <Map
        style={styles.fill}
        mapStyle={env.EXPO_PUBLIC_MAP_STYLE_URL}
        logo={false}
        compass
        accessibilityLabel={label}
      >
        {bounds && <Camera initialViewState={{ bounds, padding: PADDING }} />}
        <GeoJSONSource id="route" data={line}>
          {versions.map((version, i) => {
            const style = roundStyle(i);
            return (
              <Layer
                key={version.id}
                id={`route-line-${i}`}
                type="line"
                filter={['==', ['get', 'round'], i]}
                layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                paint={{
                  'line-color': colors[style.color],
                  'line-width': 4,
                  'line-opacity': 0.85,
                  ...(style.dash && { 'line-dasharray': style.dash }),
                }}
              />
            );
          })}
        </GeoJSONSource>
        <GeoJSONSource id="points" data={points}>
          <Layer
            id="points-circle"
            type="circle"
            paint={{
              'circle-radius': versions.length > 1 ? 15 : 13,
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
              'circle-stroke-color': strokeByRound,
            }}
          />
          <Layer
            id="points-label"
            type="symbol"
            layout={{
              'text-field': ['get', 'label'],
              'text-font': FONT,
              'text-size': 12,
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
        {live && <NativeUserLocation androidPreferredFramesPerSecond={10} />}
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 1, overflow: 'hidden' },
  fill: { flex: 1 },
});
