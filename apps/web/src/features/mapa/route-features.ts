import { legEndpoints, type LngLat, type RoundRoute } from '@garita/shared';
import type { PointStatus } from '@/components/point-path';

/** Recorrido de una ronda para el mapa: sus puntos en orden y el recorrido guardado (o null). */
export interface LiveMapRoute {
  checkpointIds: string[];
  route: RoundRoute | null;
}

/** streets = por calles; manual = a mano; fallback = recto porque no se calculó (o ronda previa). */
export type SectionKind = 'streets' | 'manual' | 'fallback';

export interface RouteLineProperties {
  kind: SectionKind;
  /** Sólido si el destino del tramo ya se registró o faltó; si no, atenuado. */
  solid: boolean;
  /** Tramo y sección: el editor los usa para saber qué línea se tocó. */
  leg: number;
  section: number;
}

interface LinePoint {
  id: string;
  lat: number;
  lng: number;
  status: PointStatus;
}

interface LineFeature {
  type: 'Feature';
  properties: RouteLineProperties;
  geometry: { type: 'LineString'; coordinates: LngLat[] };
}

export interface RouteFeatures {
  lines: { type: 'FeatureCollection'; features: LineFeature[] };
  /** Puntos de paso: no se registran, solo dan forma al camino. */
  waypoints: LngLat[];
  hasFallback: boolean;
}

const isSolid = (status: PointStatus | undefined) => status === 'done' || status === 'missed';

/**
 * GeoJSON del recorrido ideal. Cada tramo toma el estado de su destino. Una ronda sin recorrido
 * guardado se dibuja recta y marcada como fallback.
 */
export function routeFeatures(routes: LiveMapRoute[], points: LinePoint[]): RouteFeatures {
  const byId = new Map(points.map((point) => [point.id, point]));
  const features: LineFeature[] = [];
  const waypoints: LngLat[] = [];
  for (const { checkpointIds, route } of routes) {
    const ids =
      route?.closed && checkpointIds[0] ? [...checkpointIds, checkpointIds[0]] : checkpointIds;
    const destinations = ids.slice(1).map((id) => byId.get(id));
    if (route) {
      route.legs.forEach((leg, l) => {
        const solid = isSolid(destinations[l]?.status);
        waypoints.push(...leg.waypoints);
        leg.sections.forEach((section, s) => {
          features.push(
            line(section.fallback ? 'fallback' : section.mode, solid, section.geometry, l, s),
          );
        });
      });
      continue;
    }
    const located = checkpointIds.flatMap((id) => {
      const point = byId.get(id);
      return point ? [point] : [];
    });
    legEndpoints(
      located.map((point): LngLat => [point.lng, point.lat]),
      false,
    ).forEach(([from, to], l) => {
      features.push(line('fallback', isSolid(located[l + 1]?.status), [from, to], l, 0));
    });
  }
  return {
    lines: { type: 'FeatureCollection', features },
    waypoints,
    hasFallback: features.some((feature) => feature.properties.kind === 'fallback'),
  };
}

function line(
  kind: SectionKind,
  solid: boolean,
  coordinates: LngLat[],
  leg: number,
  section: number,
): LineFeature {
  return {
    type: 'Feature',
    properties: { kind, solid, leg, section },
    geometry: { type: 'LineString', coordinates },
  };
}

/**
 * Flecha de sentido como campo de distancia (SDF): MapLibre la tiñe con `icon-color`, así sigue
 * los tokens del tema sin volver a registrarla.
 */
export function arrowImage(size = 24): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  const s = size / 24;
  // Chevron ">" apuntando en el sentido de la línea.
  const segments: [number, number, number, number][] = [
    [8 * s, 6 * s, 15 * s, 12 * s],
    [15 * s, 12 * s, 8 * s, 18 * s],
  ];
  const radius = 1.6 * s;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.min(...segments.map((seg) => distanceToSegment(x + 0.5, y + 0.5, seg)));
      // 0.75 es el borde en el SDF de MapLibre; baja a 0 unos 6 px afuera.
      const alpha = Math.max(0, Math.min(1, 0.75 + (radius - d) / 8));
      data[(y * size + x) * 4 + 3] = Math.round(alpha * 255);
    }
  return { width: size, height: size, data };
}

function distanceToSegment(
  px: number,
  py: number,
  [x1, y1, x2, y2]: [number, number, number, number],
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
