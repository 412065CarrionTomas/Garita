import {
  defaultRouteInput,
  legCount,
  polyline,
  roundRouteSchema,
  sectionEndpoints,
  type LngLat,
  type RouteFailure,
  type RouteInput,
  type RouteLegInput,
  type RouteMode,
} from '@garita/shared';

/** El recorrido que se edita y los puntos (en orden) para los que se armó. */
export interface RouteDraft {
  ids: string[];
  route: RouteInput;
}

const defaultLeg = (): RouteLegInput => ({
  waypoints: [],
  sections: [{ mode: 'streets', via: [] }],
});

function pairKeys(ids: string[], closed: boolean): string[] {
  const first = ids[0];
  const ring = closed && first !== undefined ? [...ids, first] : ids;
  return ring.slice(1).map((to, i) => `${ring[i] ?? ''}>${to}`);
}

/**
 * Ajusta el recorrido a una nueva lista u orden de puntos: conserva los tramos cuyo par de puntos
 * no cambió y arma por calles los nuevos.
 */
export function reconcileRoute(
  draft: RouteDraft,
  ids: string[],
  closed = draft.route.closed,
): RouteInput {
  if (legCount(ids.length, closed) === 0) return defaultRouteInput(ids.length, closed);
  const previous = new Map(
    pairKeys(draft.ids, draft.route.closed).flatMap((key, i) => {
      const leg = draft.route.legs[i];
      return leg ? [[key, leg] as const] : [];
    }),
  );
  return { closed, legs: pairKeys(ids, closed).map((key) => previous.get(key) ?? defaultLeg()) };
}

/** Lo editable de un recorrido guardado (la geometría la vuelve a calcular la API). */
export function storedRouteInput(value: unknown): RouteInput | null {
  const parsed = roundRouteSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    closed: parsed.data.closed,
    legs: parsed.data.legs.map(({ waypoints, sections }) => ({
      waypoints,
      sections: sections.map(({ mode, via }) => ({ mode, via })),
    })),
  };
}

function updateLeg(route: RouteInput, l: number, change: (leg: RouteLegInput) => RouteLegInput) {
  return { ...route, legs: route.legs.map((leg, i) => (i === l ? change(leg) : leg)) };
}

function updateVia(route: RouteInput, l: number, s: number, change: (via: LngLat[]) => LngLat[]) {
  return updateLeg(route, l, (leg) => ({
    ...leg,
    sections: leg.sections.map((section, i) =>
      i === s ? { ...section, via: change(section.via) } : section,
    ),
  }));
}

const replaceAt = <T>(items: T[], index: number, value: T) =>
  items.map((item, i) => (i === index ? value : item));

export const routeEdits = {
  setMode: (route: RouteInput, l: number, s: number, mode: RouteMode) =>
    updateLeg(route, l, (leg) => ({
      ...leg,
      sections: leg.sections.map((section, i) => (i === s ? { ...section, mode } : section)),
    })),
  /** El punto de paso nuevo va antes del destino: la última sección se parte en dos. */
  addWaypoint: (route: RouteInput, l: number, at: LngLat) =>
    updateLeg(route, l, (leg) => ({
      waypoints: [...leg.waypoints, at],
      sections: [...leg.sections, { mode: 'streets', via: [] }],
    })),
  /** Al quitar un punto de paso, sus dos secciones se unen y conservan los quiebres. */
  removeWaypoint: (route: RouteInput, l: number, k: number) =>
    updateLeg(route, l, (leg) => {
      const before = leg.sections[k];
      const after = leg.sections[k + 1];
      if (!before || !after) return leg;
      return {
        waypoints: leg.waypoints.filter((_, i) => i !== k),
        sections: [
          ...leg.sections.slice(0, k),
          { mode: before.mode, via: [...before.via, ...after.via] },
          ...leg.sections.slice(k + 2),
        ],
      };
    }),
  moveWaypoint: (route: RouteInput, l: number, k: number, at: LngLat) =>
    updateLeg(route, l, (leg) => ({ ...leg, waypoints: replaceAt(leg.waypoints, k, at) })),
  addVia: (route: RouteInput, l: number, s: number, at: LngLat) =>
    updateVia(route, l, s, (via) => [...via, at]),
  moveVia: (route: RouteInput, l: number, s: number, i: number, at: LngLat) =>
    updateVia(route, l, s, (via) => replaceAt(via, i, at)),
  undoVia: (route: RouteInput, l: number, s: number) =>
    updateVia(route, l, s, (via) => via.slice(0, -1)),
  clearVia: (route: RouteInput, l: number, s: number) => updateVia(route, l, s, () => []),
};

/** Punto medio del último tramo recto de la sección: donde cae lo que se agrega con teclado. */
export function sectionMidpoint(
  route: RouteInput,
  points: LngLat[],
  l: number,
  s: number,
): LngLat | null {
  const first = points[0];
  const ring = route.closed && first ? [...points, first] : points;
  const from = ring[l];
  const to = ring[l + 1];
  const leg = route.legs[l];
  const section = leg?.sections[s];
  if (!from || !to || !leg || !section) return null;
  const ends = sectionEndpoints(from, to, leg.waypoints)[s];
  if (!ends) return null;
  const line = polyline(ends[0], section.via, ends[1]);
  const end = line.at(-1);
  const start = line.at(-2);
  if (!start || !end) return null;
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

/** "2 → 3", y el regreso al inicio como "4 → 1 (regreso)". */
export function legLabel(l: number, total: number, closed: boolean): string {
  const back = closed && l === total - 1;
  return `${String(l + 1)} → ${String(back ? 1 : l + 2)}${back ? ' (regreso)' : ''}`;
}

/** Un mensaje por falla de un tramo, y uno solo por cada falla general del servicio. */
export function failureMessages(failures: RouteFailure[], legs: number, closed: boolean): string[] {
  const where = (failure: RouteFailure) => `el tramo ${legLabel(failure.leg, legs, closed)}`;
  const messages = new Set<string>();
  for (const failure of failures) {
    if (failure.reason === 'unreachable_point')
      messages.add(
        `No se encontró una calle cerca de un punto de ${where(failure)}. Mové el punto de paso o el quiebre, o pasá esa sección a mano.`,
      );
    if (failure.reason === 'no_route')
      messages.add(
        `No hay camino por calles en ${where(failure)}. Agregá un punto de paso o pasá esa sección a mano.`,
      );
    if (failure.reason === 'rate_limited')
      messages.add(
        'Se alcanzó el límite de pedidos del servicio de rutas. Esperá un minuto y reintentá.',
      );
    if (failure.reason === 'unavailable')
      messages.add('El servicio de rutas no respondió. Reintentá en un momento.');
    if (failure.reason === 'not_configured')
      messages.add('El cálculo por calles no está configurado en el servidor.');
  }
  return [...messages];
}

/** Tramos con una falla propia (no los que solo quedaron sin calcular por otra). */
export function failedLegs(failures: RouteFailure[]): Set<number> {
  return new Set(failures.filter((f) => f.reason !== 'skipped').map((f) => f.leg));
}
