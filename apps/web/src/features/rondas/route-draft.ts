import {
  ROUTE_LIMITS,
  chainSections,
  defaultRouteInput,
  distanceMeters,
  legCount,
  legEndpoints,
  polyline,
  roundRouteSchema,
  sectionEndpoints,
  type LngLat,
  type RoundRoute,
  type RouteFailure,
  type RouteFailureReason,
  type RouteInput,
  type RouteLegInput,
  type RouteMode,
} from '@garita/shared';

/**
 * Vocabulario de la pantalla: un tramo (leg) va de un punto de control al siguiente y se divide en
 * partes (sections); un cambio de modo (waypoint) corta una parte de la siguiente y los puntos de
 * guía (via) dan forma a la línea de su parte.
 */

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

/**
 * Recorrido guardado listo para editar: un cambio de modo con el mismo modo a los dos lados (de
 * cuando existía el "punto de paso") pasa a ser un punto de guía y sus dos partes se unen.
 */
export function normalizeRoute(route: RoundRoute): RoundRoute {
  return {
    ...route,
    legs: route.legs.map((leg) => {
      const [first, ...rest] = leg.sections;
      if (!first) return leg;
      const waypoints: LngLat[] = [];
      const sections = [first];
      leg.waypoints.forEach((waypoint, k) => {
        const next = rest[k];
        const last = sections.at(-1);
        if (!next || !last) return;
        // Distinto modo, o juntas pasarían el tope de puntos de guía: el corte se queda.
        if (next.mode !== last.mode || !viaFit(last, next, true)) {
          waypoints.push(waypoint);
          sections.push(next);
          return;
        }
        sections[sections.length - 1] = {
          mode: last.mode,
          via: [...last.via, waypoint, ...next.via],
          geometry: [...last.geometry, ...next.geometry.slice(1)],
          fallback: last.fallback || next.fallback,
        };
      });
      return { ...leg, waypoints, sections };
    }),
  };
}

/** El recorrido guardado (normalizado) o null si no hay uno válido. */
export function storedRoute(value: unknown): RoundRoute | null {
  const parsed = roundRouteSchema.safeParse(value);
  return parsed.success ? normalizeRoute(parsed.data) : null;
}

/** Lo editable de un recorrido guardado (la geometría la vuelve a calcular la API). */
export function storedRouteInput(value: unknown): RouteInput | null {
  const route = storedRoute(value);
  if (!route) return null;
  return {
    closed: route.closed,
    legs: route.legs.map(({ waypoints, sections }) => ({
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

/** Si dos partes unidas entran en el tope de puntos de guía (con el punto que las corta o sin él). */
function viaFit(before: { via: LngLat[] }, after: { via: LngLat[] }, keepPoint: boolean) {
  return before.via.length + after.via.length + (keepPoint ? 1 : 0) <= ROUTE_LIMITS.viaPerSection;
}

/** Si quitar el cambio de modo `k` (conservando su punto o no) deja una parte dentro del tope. */
export function canJoinAt(route: RouteInput, l: number, k: number, keepPoint: boolean): boolean {
  const leg = route.legs[l];
  const before = leg?.sections[k];
  const after = leg?.sections[k + 1];
  return Boolean(before && after && viaFit(before, after, keepPoint));
}

/** Un cambio de modo con el mismo modo a los dos lados sobra: pasa a punto de guía si entra. */
function joinSameMode(leg: RouteLegInput): RouteLegInput {
  const [first, ...rest] = leg.sections;
  if (!first) return leg;
  const waypoints: LngLat[] = [];
  const sections = [first];
  leg.waypoints.forEach((waypoint, k) => {
    const next = rest[k];
    const last = sections.at(-1);
    if (!next || !last) return;
    if (next.mode !== last.mode || !viaFit(last, next, true)) {
      waypoints.push(waypoint);
      sections.push(next);
      return;
    }
    sections[sections.length - 1] = { mode: last.mode, via: [...last.via, waypoint, ...next.via] };
  });
  return { waypoints, sections };
}

const replaceAt = <T>(items: T[], index: number, value: T) =>
  items.map((item, i) => (i === index ? value : item));

/** Clave de una parte: la usan la lista desplegada y los números del mapa. */
export const partKey = (l: number, s: number) => `${String(l)}-${String(s)}`;

export const otherMode = (mode: RouteMode): RouteMode =>
  mode === 'streets' ? 'manual' : 'streets';

export const routeEdits = {
  /** Cambia el modo de la parte; si queda igual a una vecina, se une con ella. */
  setMode: (route: RouteInput, l: number, s: number, mode: RouteMode) =>
    updateLeg(route, l, (leg) =>
      joinSameMode({
        ...leg,
        sections: leg.sections.map((section, i) => (i === s ? { ...section, mode } : section)),
      }),
    ),
  /** Punto de guía en la posición `index` de la parte. */
  insertVia: (route: RouteInput, l: number, s: number, index: number, at: LngLat) =>
    updateVia(route, l, s, (via) => [...via.slice(0, index), at, ...via.slice(index)]),
  moveVia: (route: RouteInput, l: number, s: number, i: number, at: LngLat) =>
    updateVia(route, l, s, (via) => replaceAt(via, i, at)),
  removeVia: (route: RouteInput, l: number, s: number, i: number) =>
    updateVia(route, l, s, (via) => via.filter((_, k) => k !== i)),
  /**
   * El punto de guía `i` pasa a ser un cambio de modo: lo anterior queda en la parte con su modo y
   * lo posterior en una parte nueva con el modo opuesto.
   */
  splitAtVia: (route: RouteInput, l: number, s: number, i: number) =>
    updateLeg(route, l, (leg) => {
      const section = leg.sections[s];
      const at = section?.via[i];
      if (!section || !at) return leg;
      return {
        waypoints: [...leg.waypoints.slice(0, s), at, ...leg.waypoints.slice(s)],
        sections: [
          ...leg.sections.slice(0, s),
          { mode: section.mode, via: section.via.slice(0, i) },
          { mode: otherMode(section.mode), via: section.via.slice(i + 1) },
          ...leg.sections.slice(s + 1),
        ],
      };
    }),
  /** El cambio de modo `k` vuelve a ser punto de guía: sus dos partes se unen con el modo de la primera. */
  mergeAtWaypoint: (route: RouteInput, l: number, k: number) =>
    updateLeg(route, l, (leg) => {
      const before = leg.sections[k];
      const after = leg.sections[k + 1];
      const at = leg.waypoints[k];
      if (!before || !after || !at || !viaFit(before, after, true)) return leg;
      return {
        waypoints: leg.waypoints.filter((_, i) => i !== k),
        sections: [
          ...leg.sections.slice(0, k),
          { mode: before.mode, via: [...before.via, at, ...after.via] },
          ...leg.sections.slice(k + 2),
        ],
      };
    }),
  /** Eliminar un cambio de modo: sus dos partes se unen sin ese punto y conservan los de guía. */
  removeWaypoint: (route: RouteInput, l: number, k: number) =>
    updateLeg(route, l, (leg) => {
      const before = leg.sections[k];
      const after = leg.sections[k + 1];
      if (!before || !after || !viaFit(before, after, false)) return leg;
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
  /** Cambio de modo en `at`, después del último punto de guía: desde ahí al fin de la parte, el otro modo. */
  appendModeChange: (route: RouteInput, l: number, s: number, at: LngLat): RouteInput => {
    const i = route.legs[l]?.sections[s]?.via.length ?? 0;
    return routeEdits.splitAtVia(routeEdits.insertVia(route, l, s, i, at), l, s, i);
  },
};

/** Posición de `at` a lo largo de la línea: índice del segmento más cercano más la fracción recorrida. */
function along(line: LngLat[], at: LngLat): number {
  // Plano local: un grado de longitud mide cos(latitud) de uno de latitud.
  const k = Math.cos((at[1] * Math.PI) / 180);
  let best = Infinity;
  let position = 0;
  for (let j = 1; j < line.length; j++) {
    const a = line[j - 1];
    const b = line[j];
    if (!a || !b) continue;
    const dx = (b[0] - a[0]) * k;
    const dy = b[1] - a[1];
    const px = (at[0] - a[0]) * k;
    const py = at[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
    const d = Math.hypot(px - t * dx, py - t * dy);
    if (d < best) {
      best = d;
      position = j - 1 + t;
    }
  }
  return position;
}

/**
 * Dónde va un punto de guía tocado sobre la línea dibujada de su parte: después de los que quedan
 * antes a lo largo de esa línea (sirve igual para la recta y para la calculada por calles).
 */
export function viaInsertIndex(via: LngLat[], line: LngLat[], at: LngLat): number {
  const position = along(line, at);
  return via.filter((point) => along(line, point) < position).length;
}

/** Separación de los puntos de guía sumados desde la lista: chica, para sumar varios y moldearlos. */
export const GUIDE_STEP_METERS = 15;

/**
 * Punto sobre el último tramo recto de la parte (del último punto de guía, o del inicio, al fin):
 * a `meters` del anterior, o en la mitad si no entra o no se pide distancia.
 */
export function pointAfterLast(control: LngLat[], meters?: number): LngLat | null {
  const end = control.at(-1);
  const base = control.at(-2);
  if (!end || !base) return null;
  const length = distanceMeters(base, end);
  const t = meters === undefined || length === 0 ? 0.5 : Math.min(0.5, meters / length);
  return [base[0] + (end[0] - base[0]) * t, base[1] + (end[1] - base[1]) * t];
}

/** Línea de control de cada parte, [tramo][parte]: inicio, puntos de guía y fin. */
function controlLines(
  legs: { from: LngLat; to: LngLat; waypoints: LngLat[]; sections: { via: LngLat[] }[] }[],
): LngLat[][][] {
  return legs.map((leg) => {
    const ends = sectionEndpoints(leg.from, leg.to, leg.waypoints);
    return leg.sections.map((section, s) => {
      const [start, end] = ends[s] ?? [leg.from, leg.to];
      return polyline(start, section.via, end);
    });
  });
}

/** Tramos del recorrido con sus extremos actuales (los que tienen los dos puntos ubicados). */
function inputLegs(route: RouteInput, coords: LngLat[]) {
  const pairs = legEndpoints(coords, route.closed);
  return route.legs.flatMap((leg, l) => {
    const pair = pairs[l];
    return pair ? [{ ...leg, from: pair[0], to: pair[1] }] : [];
  });
}

/**
 * Lo que el panel sabe de cada parte por calles, por sus datos (inicio, puntos de guía y fin):
 * su línea calculada, el motivo por el que no se pudo calcular o que se guardó recta. Cualquier
 * cambio en esos datos da otra clave y la parte vuelve a "sin calcular".
 */
export type SectionMemo = ReadonlyMap<
  string,
  { geometry: LngLat[] } | { failure: RouteFailureReason } | { straight: true }
>;

const memoKey = (line: LngLat[]) => JSON.stringify(line);

/** Fallas que conviene reintentar: no dependen de los puntos de la parte. */
const RETRYABLE = new Set<RouteFailureReason>(['skipped', 'rate_limited', 'unavailable']);

/**
 * Suma al memo lo que trajo un recorrido calculado (o guardado). Sin fallas informadas, una parte
 * por calles recta es una guardada como recta.
 */
export function rememberRoute(
  memo: SectionMemo,
  route: RoundRoute,
  failures: RouteFailure[] = [],
): SectionMemo {
  const next = new Map(memo);
  const lines = controlLines(route.legs);
  route.legs.forEach((leg, l) => {
    leg.sections.forEach((section, s) => {
      const line = lines[l]?.[s];
      if (section.mode !== 'streets' || !line) return;
      const key = memoKey(line);
      const failure = failures.find((f) => f.leg === l && f.section === s);
      if (!section.fallback) next.set(key, { geometry: section.geometry });
      else if (!failure) next.set(key, { straight: true });
      else if (RETRYABLE.has(failure.reason)) next.delete(key);
      else next.set(key, { failure: failure.reason });
    });
  });
  return next;
}

/** Suma las fallas del guardado (422), que no traen recorrido. */
export function rememberFailures(
  memo: SectionMemo,
  route: RouteInput,
  coords: LngLat[],
  failures: RouteFailure[],
): SectionMemo {
  const next = new Map(memo);
  const lines = controlLines(inputLegs(route, coords));
  for (const { leg, section, reason } of failures) {
    const line = lines[leg]?.[section];
    if (!line) continue;
    if (RETRYABLE.has(reason)) next.delete(memoKey(line));
    else next.set(memoKey(line), { failure: reason });
  }
  return next;
}

/**
 * Lo guardado con los puntos de control de hoy: un tramo cuyos puntos se movieron hasta 5 m sigue
 * valiendo (se toma como trazado desde su ubicación actual); uno que se movió más queda sin calcular.
 */
export function rebaseRoute(route: RoundRoute, coords: LngLat[]): RoundRoute {
  const pairs = legEndpoints(coords, route.closed);
  return {
    ...route,
    legs: route.legs.map((leg, l) => {
      const pair = pairs[l];
      if (!pair) return leg;
      const near =
        distanceMeters(leg.from, pair[0]) <= ROUTE_LIMITS.staleMeters &&
        distanceMeters(leg.to, pair[1]) <= ROUTE_LIMITS.staleMeters;
      return near ? { ...leg, from: pair[0], to: pair[1] } : leg;
    }),
  };
}

/**
 * Estado de una parte. Trazo libre no se calcula; por calles puede estar calculada, sin calcular,
 * con una falla o guardada recta.
 */
export type SectionState = 'manual' | 'calculated' | 'pending' | 'failed' | 'straight';

/** Estado de una parte, como se lee en la lista y en la barra. */
export const STATE_LABEL: Record<SectionState, string> = {
  manual: 'No necesita cálculo',
  calculated: 'Calculada',
  pending: 'Sin calcular',
  failed: 'Falló',
  straight: 'Guardada recta',
};

export interface PartInfo {
  l: number;
  s: number;
  mode: RouteMode;
  state: SectionState;
  failure?: RouteFailureReason;
  /** Línea de control: inicio, puntos de guía y fin. */
  control: LngLat[];
}

/** Estado de cada parte y lo que se dibuja: la línea conocida o, si no hay, la recta. */
export function resolveRoute(
  route: RouteInput,
  coords: LngLat[],
  memo: SectionMemo,
): { display: RoundRoute; parts: PartInfo[] } {
  const legs = inputLegs(route, coords);
  const lines = controlLines(legs);
  const parts: PartInfo[] = [];
  const display: RoundRoute = {
    v: 1,
    closed: route.closed,
    legs: legs.map((leg, l) => ({
      from: leg.from,
      to: leg.to,
      waypoints: leg.waypoints,
      sections: leg.sections.map((section, s) => {
        const control = lines[l]?.[s] ?? [leg.from, leg.to];
        const known = section.mode === 'streets' ? memo.get(memoKey(control)) : undefined;
        const state: SectionState =
          section.mode === 'manual'
            ? 'manual'
            : !known
              ? 'pending'
              : 'geometry' in known
                ? 'calculated'
                : 'failure' in known
                  ? 'failed'
                  : 'straight';
        parts.push({
          l,
          s,
          mode: section.mode,
          state,
          control,
          ...(known && 'failure' in known ? { failure: known.failure } : {}),
        });
        const geometry = known && 'geometry' in known ? known.geometry : control;
        return {
          ...section,
          geometry,
          fallback: section.mode === 'streets' && state !== 'calculated',
        };
      }),
    })),
  };
  return { display, parts };
}

/**
 * Pedidos que costaría calcular las partes sin calcular, con la misma regla que la API (las partes
 * por calles seguidas van en un pedido). Es un máximo: la API no vuelve a pedir lo que tiene en caché.
 * También cuenta las que fallaron o se guardaron rectas, porque la API vuelve a intentarlas.
 */
export function requestEstimate(parts: PartInfo[]): { pending: number; requests: number } {
  const streets = parts.filter((part) => part.mode === 'streets');
  // Las guardadas rectas también se pueden volver a pedir (por ejemplo, si el servicio volvió).
  const pending = streets.filter(
    (part) => part.state === 'pending' || part.state === 'straight',
  ).length;
  if (pending === 0) return { pending, requests: 0 };
  const chains = chainSections(
    streets.map((part) => part.control),
    streets.map((part) => part.state === 'calculated'),
  );
  return { pending, requests: chains.length };
}

/** "2 → 3", y la vuelta al inicio como "4 → 1 (vuelta)". */
export function legLabel(l: number, total: number, closed: boolean): string {
  const back = closed && l === total - 1;
  return `${String(l + 1)} → ${String(back ? 1 : l + 2)}${back ? ' (vuelta)' : ''}`;
}

/** "Tramo 2 → 3", y si tiene varias partes "Tramo 2 → 3, parte 2". */
export function partLabel(route: RouteInput, l: number, s: number): string {
  const leg = `Tramo ${legLabel(l, route.legs.length, route.closed)}`;
  return (route.legs[l]?.sections.length ?? 1) > 1 ? `${leg}, parte ${String(s + 1)}` : leg;
}

/** Metros de cada parte según la línea dibujada, [tramo][parte]. */
export function sectionMeters(route: RoundRoute): number[][] {
  return route.legs.map((leg) =>
    leg.sections.map(({ geometry }) =>
      geometry.reduce(
        (sum, point, i) => (i === 0 ? sum : sum + distanceMeters(geometry[i - 1] ?? point, point)),
        0,
      ),
    ),
  );
}

/** Metros de cada tramo según la línea dibujada (calculada o recta). */
export function legMeters(route: RoundRoute): number[] {
  return sectionMeters(route).map((parts) => parts.reduce((total, m) => total + m, 0));
}

export const formatMeters = (meters: number) =>
  meters < 1000
    ? `${String(Math.round(meters))} m`
    : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;

/** Por qué una parte no se pudo calcular, en lenguaje llano. */
export const FAILURE_TEXT: Record<RouteFailureReason, string> = {
  unreachable_point:
    'Un punto no está cerca de ninguna calle. Elegí Trazo libre o movelo a una calle.',
  no_route:
    'No hay camino por calles entre esos puntos. Sumá un punto de guía o elegí Trazo libre.',
  skipped: 'No se calculó porque iba en el mismo pedido que una parte con falla.',
  rate_limited: 'El servicio de rutas llegó a su límite de pedidos. Esperá un minuto y reintentá.',
  unavailable: 'El servicio de rutas no respondió. Reintentá en un momento.',
  not_configured: 'El cálculo por calles no está configurado en el servidor.',
};

/** Un mensaje por parte con falla propia, y uno solo por cada falla general del servicio. */
export function failureMessages(failures: RouteFailure[], route: RouteInput): string[] {
  const messages = new Set<string>();
  for (const failure of failures) {
    if (failure.reason === 'skipped') continue;
    const own = failure.reason === 'unreachable_point' || failure.reason === 'no_route';
    messages.add(
      own
        ? `${partLabel(route, failure.leg, failure.section)}: ${FAILURE_TEXT[failure.reason]}`
        : FAILURE_TEXT[failure.reason],
    );
  }
  return [...messages];
}
