import { z } from 'zod';
import { haversineMeters } from '../marcas/haversine';

/**
 * Recorrido ideal de una ronda: la ruta que el vigilador DEBERÍA seguir, en el orden que armó
 * el supervisor (nunca se reordena). Un tramo va de un punto de control al siguiente; los puntos
 * de paso (no se escanean) lo dividen en secciones, cada una por calles o trazada a mano.
 * Coordenadas en orden GeoJSON: [longitud, latitud].
 */

export const ROUTE_LIMITS = {
  /** Puntos de paso por tramo. */
  waypointsPerLeg: 10,
  /**
   * Quiebres de una sección a mano o puntos intermedios de una por calles. Con inicio y fin suman
   * 50, el máximo de puntos por pedido de openrouteservice.
   */
  viaPerSection: 48,
  /** Coordenadas de la línea calculada de una sección. */
  geometryPerSection: 5000,
  /** Distancia máxima de cualquier coordenada al predio. */
  maxMetersFromSite: 25_000,
  /** A partir de esta distancia un punto de control se considera movido desde que se trazó. */
  staleMeters: 5,
  /** Puntos por pedido que acepta el plan hospedado de openrouteservice. */
  requestCoordinates: 50,
} as const;

export type LngLat = [number, number];

const lngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const routeModes = ['streets', 'manual'] as const;
export type RouteMode = (typeof routeModes)[number];

/** Lo que manda el navegador: modos, puntos de paso y quiebres. La línea la calcula la API. */
const sectionInputSchema = z.object({
  mode: z.enum(routeModes),
  via: z.array(lngLatSchema).max(ROUTE_LIMITS.viaPerSection),
});

const legShape = {
  waypoints: z.array(lngLatSchema).max(ROUTE_LIMITS.waypointsPerLeg),
  sections: z.array(sectionInputSchema).min(1),
};
const sectionsMatchWaypoints = (leg: { waypoints: unknown[]; sections: unknown[] }) =>
  leg.sections.length === leg.waypoints.length + 1;
const sectionsMatchWaypointsIssue = {
  message: 'Cada punto de paso divide el tramo: debe haber una sección más que puntos de paso.',
  path: ['sections'],
};

const legInputSchema = z
  .object(legShape)
  .refine(sectionsMatchWaypoints, sectionsMatchWaypointsIssue);

export const routeInputSchema = z.object({
  closed: z.boolean(),
  legs: z.array(legInputSchema),
});
export type RouteInput = z.infer<typeof routeInputSchema>;
export type RouteLegInput = RouteInput['legs'][number];
export type RouteSectionInput = RouteLegInput['sections'][number];

/** Lo que se guarda en la versión de la ronda y recibe el mapa. */
const sectionSchema = sectionInputSchema.extend({
  geometry: z.array(lngLatSchema).min(2).max(ROUTE_LIMITS.geometryPerSection),
  /** Por calles pero sin ruta calculada (proveedor caído o sin clave): se dibuja recta. */
  fallback: z.boolean(),
});

export const roundRouteSchema = z.object({
  v: z.literal(1),
  closed: z.boolean(),
  legs: z.array(
    z.object({
      /** Ubicación de los puntos de control al trazar: si cambian, el tramo quedó desactualizado. */
      from: lngLatSchema,
      to: lngLatSchema,
      waypoints: z.array(lngLatSchema).max(ROUTE_LIMITS.waypointsPerLeg),
      sections: z.array(sectionSchema).min(1),
    }),
  ),
});
export type RoundRoute = z.infer<typeof roundRouteSchema>;

/** Por qué una sección por calles quedó recta. */
export const routeFailureReasons = [
  /** Un punto de la sección no está cerca de ninguna calle. */
  'unreachable_point',
  /** No hay camino por calles entre los puntos de la sección. */
  'no_route',
  /** Iba en el mismo pedido que una sección que falló: corrigiendo esa, se calcula. */
  'skipped',
  /** Se alcanzó el límite de pedidos del servicio (por minuto o por día). */
  'rate_limited',
  /** El servicio no respondió, tardó más de 5 s o devolvió algo inválido. */
  'unavailable',
  /** La API no tiene clave del servicio de rutas. */
  'not_configured',
] as const;
export type RouteFailureReason = (typeof routeFailureReasons)[number];

export const routeFailureSchema = z.object({
  /** Índice del tramo y de la sección dentro del tramo. */
  leg: z.number().int().min(0),
  section: z.number().int().min(0),
  reason: z.enum(routeFailureReasons),
});
export type RouteFailure = z.infer<typeof routeFailureSchema>;

/** Cuerpo del 422 al guardar: no se guardó nada; reenviar con allowStraight para dejarlas rectas. */
export const routeFailuresErrorSchema = z.object({
  message: z.string(),
  failures: z.array(routeFailureSchema).min(1),
});

/** Botón "Calcular recorrido": toda la ronda en el menor número de pedidos. No guarda nada. */
export const roundRoutePreviewInputSchema = z.object({
  siteId: z.string().min(1),
  checkpointIds: z.array(z.string().min(1)).min(2),
  route: routeInputSchema,
});
export type RoundRoutePreviewInput = z.infer<typeof roundRoutePreviewInputSchema>;

export const roundRoutePreviewResponseSchema = z.object({
  route: roundRouteSchema,
  failures: z.array(routeFailureSchema),
});
export type RoundRoutePreviewResponse = z.infer<typeof roundRoutePreviewResponseSchema>;
export type RouteLeg = RoundRoute['legs'][number];
export type RouteSection = RouteLeg['sections'][number];

/** Cantidad de tramos: uno entre cada par de puntos, más el regreso al inicio si es circuito. */
export function legCount(points: number, closed: boolean): number {
  if (points < 2) return 0;
  return closed ? points : points - 1;
}

/** Pares consecutivos: [a, b, c] → [[a, b], [b, c]]. */
function pairwise<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  let previous: T | undefined;
  for (const item of items) {
    if (previous !== undefined) pairs.push([previous, item]);
    previous = item;
  }
  return pairs;
}

/** Pares [desde, hasta] de cada tramo, en el orden de la ronda. */
export function legEndpoints(points: LngLat[], closed: boolean): [LngLat, LngLat][] {
  const [first] = points;
  if (!first || points.length < 2) return [];
  return pairwise(closed ? [...points, first] : points);
}

/** Recorrido por defecto: cada tramo entero por calles, sin puntos de paso. */
export function defaultRouteInput(points: number, closed = true): RouteInput {
  return {
    closed,
    legs: Array.from({ length: legCount(points, closed) }, () => ({
      waypoints: [],
      sections: [{ mode: 'streets' as const, via: [] }],
    })),
  };
}

/** Inicio y fin de cada sección: los puntos de paso cortan el tramo. */
export function sectionEndpoints(
  from: LngLat,
  to: LngLat,
  waypoints: LngLat[],
): [LngLat, LngLat][] {
  return pairwise([from, ...waypoints, to]);
}

/** Línea de una sección a mano (o recta de reemplazo): inicio, quiebres y fin. */
export function polyline(start: LngLat, via: LngLat[], end: LngLat): LngLat[] {
  return [start, ...via, end];
}

export function distanceMeters(a: LngLat, b: LngLat): number {
  return haversineMeters(a[1], a[0], b[1], b[0]);
}

/** Problemas de forma que el esquema solo no puede ver (dependen de los puntos y del predio). */
export function validateRouteInput(
  route: RouteInput,
  points: LngLat[],
  site: LngLat,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const expected = legCount(points.length, route.closed);
  if (route.legs.length !== expected)
    issues.push({
      path: ['legs'],
      message: `El recorrido debe tener ${String(expected)} tramos para estos puntos.`,
    });
  route.legs.forEach((leg, l) => {
    const coordinates = [...leg.waypoints, ...leg.sections.flatMap((section) => section.via)];
    if (coordinates.some((c) => distanceMeters(c, site) > ROUTE_LIMITS.maxMetersFromSite))
      issues.push({
        path: ['legs', l],
        message: 'El recorrido no puede alejarse más de 25 km del predio.',
      });
  });
  return issues;
}

const samePoint = (a: LngLat | undefined, b: LngLat | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Puntos que ocupa un grupo de secciones encadenadas: cada una comparte su inicio con el fin anterior. */
const chainLength = (sections: LngLat[][]) =>
  sections.reduce((total, section, i) => total + section.length - (i === 0 ? 0 : 1), 0);

/**
 * Agrupa en cadenas las secciones sin caché que siguen una a la otra (el fin de una es el inicio
 * de la siguiente), hasta el tope de puntos por pedido: un pedido al servicio de rutas por cadena.
 * La API lo usa para pedir y el panel para estimar cuántos pedidos costará calcular.
 */
export function chainSections(sections: LngLat[][], resolved: boolean[]): number[][] {
  const chains: number[][] = [];
  let current: number[] = [];
  sections.forEach((section, i) => {
    if (resolved[i]) {
      if (current.length) chains.push(current);
      current = [];
      return;
    }
    const previous = current.at(-1);
    const fits =
      previous !== undefined &&
      samePoint(sections[previous]?.at(-1), section[0]) &&
      chainLength([...current.map((j) => sections[j] ?? []), section]) <=
        ROUTE_LIMITS.requestCoordinates;
    if (!fits && current.length) {
      chains.push(current);
      current = [];
    }
    current.push(i);
  });
  if (current.length) chains.push(current);
  return chains;
}

/** Índices de los tramos cuyos puntos de control se movieron desde que se trazó el recorrido. */
export function staleLegs(route: RoundRoute, points: LngLat[]): number[] {
  const pairs = legEndpoints(points, route.closed);
  if (pairs.length !== route.legs.length) return route.legs.map((_, i) => i);
  return route.legs.flatMap((leg, i) => {
    const pair = pairs[i];
    if (!pair) return [i];
    const [from, to] = pair;
    const moved =
      distanceMeters(leg.from, from) > ROUTE_LIMITS.staleMeters ||
      distanceMeters(leg.to, to) > ROUTE_LIMITS.staleMeters;
    return moved ? [i] : [];
  });
}
