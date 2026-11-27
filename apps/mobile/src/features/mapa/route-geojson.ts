import type { GuardRoundVersion, LngLat } from '@garita/shared';

export type PointState = 'done' | 'next' | 'pending';

/** Inicial con la que se rotulan los puntos de una ronda cuando hay varias en el mapa. */
export const roundInitial = (version: GuardRoundVersion) =>
  version.name.trim().charAt(0).toUpperCase() || 'R';

/**
 * GeoJSON de una o varias rondas: la línea de cada recorrido guardado (o recta entre sus puntos si
 * no tiene) y los puntos numerados en orden, con su estado. `round` es el índice de la ronda; con
 * varias, el rótulo lleva su inicial (P1, I1) para no depender solo del color.
 */
export function routeGeoJson(
  versions: GuardRoundVersion[],
  stateOf: (checkpointId: string) => PointState = () => 'pending',
) {
  const many = versions.length > 1;
  const lines = versions.flatMap((version, round) => {
    const points: LngLat[] = version.checkpoints.map((c) => [c.longitude, c.latitude]);
    const paths = version.route
      ? version.route.legs.flatMap((leg) => leg.sections.map((section) => section.geometry))
      : points.length > 1
        ? [points]
        : [];
    return paths.map((coordinates) => ({
      type: 'Feature' as const,
      properties: { round },
      geometry: { type: 'LineString' as const, coordinates },
    }));
  });
  const points = versions.flatMap((version, round) =>
    version.checkpoints.map((c, i) => ({
      type: 'Feature' as const,
      properties: {
        round,
        label: `${many ? roundInitial(version) : ''}${i + 1}`,
        state: stateOf(c.id),
      },
      geometry: { type: 'Point' as const, coordinates: [c.longitude, c.latitude] as LngLat },
    })),
  );
  return {
    line: { type: 'FeatureCollection' as const, features: lines },
    points: { type: 'FeatureCollection' as const, features: points },
    bounds: boundsOf([
      ...points.map((p) => p.geometry.coordinates),
      ...lines.flatMap((l) => l.geometry.coordinates),
    ]),
  };
}

/** Lado mínimo del encuadre (~200 m): con un solo punto, la cámara no hace un zoom extremo. */
const MIN_SPAN = 0.002;

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
  const widen = (low: number, high: number) =>
    high - low >= MIN_SPAN
      ? [low, high]
      : [(low + high - MIN_SPAN) / 2, (low + high + MIN_SPAN) / 2];
  [west, east] = widen(west, east) as [number, number];
  [south, north] = widen(south, north) as [number, number];
  return [west, south, east, north];
}
