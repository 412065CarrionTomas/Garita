import type { GuardRoundVersion, LngLat } from '@garita/shared';

export type PointState = 'done' | 'next' | 'pending';

/**
 * GeoJSON de una ronda para el mapa: la línea del recorrido guardado (o recta entre los puntos si
 * la ronda no tiene recorrido) y los puntos numerados en orden, con su estado.
 */
export function routeGeoJson(
  version: GuardRoundVersion,
  stateOf: (checkpointId: string) => PointState = () => 'pending',
) {
  const points: LngLat[] = version.checkpoints.map((c) => [c.longitude, c.latitude]);
  const lines: LngLat[][] = version.route
    ? version.route.legs.flatMap((leg) => leg.sections.map((section) => section.geometry))
    : points.length > 1
      ? [points]
      : [];
  return {
    line: {
      type: 'FeatureCollection' as const,
      features: lines.map((coordinates) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates },
      })),
    },
    points: {
      type: 'FeatureCollection' as const,
      features: version.checkpoints.map((c, i) => ({
        type: 'Feature' as const,
        properties: { label: String(i + 1), state: stateOf(c.id) },
        geometry: { type: 'Point' as const, coordinates: [c.longitude, c.latitude] },
      })),
    },
    bounds: boundsOf([...points, ...lines.flat()]),
  };
}

/** [oeste, sur, este, norte] que encierra todas las coordenadas, o null si no hay ninguna. */
export function boundsOf(coords: LngLat[]): [number, number, number, number] | null {
  const [first] = coords;
  if (!first) return null;
  let [west, south] = first;
  let [east, north] = first;
  for (const [lng, lat] of coords) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
