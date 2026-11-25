import {
  defaultRouteInput,
  distanceMeters,
  type LngLat,
  type RoundRoute,
  type RouteInput,
} from '@garita/shared';
import {
  GUIDE_STEP_METERS,
  canJoinAt,
  failureMessages,
  formatMeters,
  legMeters,
  legLabel,
  partLabel,
  pointAfterLast,
  rebaseRoute,
  reconcileRoute,
  rememberFailures,
  rememberRoute,
  requestEstimate,
  resolveRoute,
  routeEdits,
  storedRouteInput,
  viaInsertIndex,
  type SectionMemo,
} from './route-draft';

const gate: LngLat = [-64.15, -31.4];
const bend: LngLat = [-64.16, -31.41];

describe('reconcileRoute', () => {
  const custom: RouteInput = {
    closed: true,
    legs: [
      {
        waypoints: [gate],
        sections: [
          { mode: 'streets', via: [] },
          { mode: 'manual', via: [bend] },
        ],
      },
      { waypoints: [], sections: [{ mode: 'streets', via: [] }] },
      { waypoints: [], sections: [{ mode: 'manual', via: [] }] },
    ],
  };

  it('conserva los tramos cuyo par de puntos no cambió y arma por calles los nuevos', () => {
    const next = reconcileRoute({ ids: ['a', 'b', 'c'], route: custom }, ['a', 'b', 'd', 'c']);
    expect(next.legs).toHaveLength(4);
    expect(next.legs[0]).toEqual(custom.legs[0]);
    expect(next.legs[1]).toEqual(defaultRouteInput(2).legs[0]);
    // c → a (regreso) se mantiene.
    expect(next.legs[3]).toEqual(custom.legs[2]);
  });

  it('cambia la cantidad de tramos con "Volver al inicio"', () => {
    const open = reconcileRoute({ ids: ['a', 'b', 'c'], route: custom }, ['a', 'b', 'c'], false);
    expect(open).toMatchObject({ closed: false });
    expect(open.legs).toHaveLength(2);
    expect(open.legs[0]).toEqual(custom.legs[0]);
  });

  it('con menos de dos puntos no hay tramos', () => {
    expect(reconcileRoute({ ids: [], route: defaultRouteInput(0) }, ['a']).legs).toEqual([]);
  });
});

const A: LngLat = [0, 0];
const B: LngLat = [0.01, 0];
const C: LngLat = [0.02, 0];
const p1: LngLat = [0.002, 0.001];
const p2: LngLat = [0.005, 0.001];
const p3: LngLat = [0.008, 0.001];

const oneLeg = (leg: RouteInput['legs'][number]): RouteInput => ({ closed: false, legs: [leg] });

describe('routeEdits', () => {
  const guided = oneLeg({ waypoints: [], sections: [{ mode: 'streets', via: [p1, p2, p3] }] });

  it('un punto de guía pasa a cambio de modo y vuelve: las partes se parten y se unen', () => {
    const split = routeEdits.splitAtVia(guided, 0, 0, 1);
    expect(split.legs[0]).toEqual({
      waypoints: [p2],
      sections: [
        { mode: 'streets', via: [p1] },
        { mode: 'manual', via: [p3] },
      ],
    });
    expect(routeEdits.mergeAtWaypoint(split, 0, 0)).toEqual(guided);
    // Eliminar el cambio de modo une las partes sin ese punto.
    expect(routeEdits.removeWaypoint(split, 0, 0).legs[0]?.sections).toEqual([
      { mode: 'streets', via: [p1, p3] },
    ]);
  });

  it('suma el otro modo desde el último punto de guía hasta el fin de la parte', () => {
    const at = pointAfterLast([A, p1, B]);
    expect(at).toEqual([(p1[0] + B[0]) / 2, (p1[1] + B[1]) / 2]);
    const single = oneLeg({ waypoints: [], sections: [{ mode: 'manual', via: [p1] }] });
    expect(routeEdits.appendModeChange(single, 0, 0, p2).legs[0]).toEqual({
      waypoints: [p2],
      sections: [
        { mode: 'manual', via: [p1] },
        { mode: 'streets', via: [] },
      ],
    });
  });

  it('el «+» deja el punto de guía nuevo a pocos metros del anterior', () => {
    const next = pointAfterLast([A, B], GUIDE_STEP_METERS) ?? A;
    expect(distanceMeters(A, next)).toBeCloseTo(GUIDE_STEP_METERS, 0);
    // Si no entra, va a la mitad para no pisar el destino.
    const near: LngLat = [0.0001, 0];
    expect(pointAfterLast([A, near], GUIDE_STEP_METERS)).toEqual([0.00005, 0]);
  });

  it('no une dos partes si juntas pasan el tope de puntos de guía', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i): LngLat => [i / 1e4, 0.001]);
    const full = oneLeg({
      waypoints: [p2],
      sections: [
        { mode: 'streets', via: many(30) },
        { mode: 'manual', via: many(18) },
      ],
    });
    // 30 + 18 = 48 entra sin el punto; con el punto como guía serían 49.
    expect(canJoinAt(full, 0, 0, false)).toBe(true);
    expect(canJoinAt(full, 0, 0, true)).toBe(false);
    expect(routeEdits.mergeAtWaypoint(full, 0, 0)).toEqual(full);
    expect(routeEdits.removeWaypoint(full, 0, 0).legs[0]?.sections).toHaveLength(1);
  });

  it('al igualar el modo con la parte vecina, las dos se unen', () => {
    const split = routeEdits.splitAtVia(guided, 0, 0, 1);
    expect(routeEdits.setMode(split, 0, 1, 'streets')).toEqual(guided);
  });

  it('al quitar un cambio de modo de un tramo de tres partes no deja otro corte con el mismo modo', () => {
    // Por calles [p1] · p2 · trazo libre [] · p3 · por calles []
    const three = routeEdits.splitAtVia(routeEdits.splitAtVia(guided, 0, 0, 1), 0, 1, 0);
    expect(three.legs[0]?.waypoints).toEqual([p2, p3]);
    expect(routeEdits.mergeAtWaypoint(three, 0, 0)).toEqual(guided);
    expect(routeEdits.removeWaypoint(three, 0, 0).legs[0]).toEqual({
      waypoints: [],
      sections: [{ mode: 'streets', via: [p1, p3] }],
    });
  });

  it('inserta el punto de guía según dónde se tocó a lo largo de la línea', () => {
    const line = [A, p1, p2, p3, B];
    expect(viaInsertIndex([p1, p2, p3], line, [0.0065, 0.0011])).toBe(2);
    expect(viaInsertIndex([p1, p2, p3], line, [0.0005, 0])).toBe(0);
    expect(viaInsertIndex([p1, p2, p3], line, [0.0095, 0])).toBe(3);
    const next = routeEdits.insertVia(guided, 0, 0, 2, [0.0065, 0.001]);
    expect(next.legs[0]?.sections[0]?.via).toEqual([p1, p2, [0.0065, 0.001], p3]);
  });
});

describe('storedRouteInput', () => {
  type Mode = 'streets' | 'manual';
  const stored = (first: Mode, second: Mode) => ({
    v: 1,
    closed: false,
    legs: [
      {
        from: A,
        to: B,
        waypoints: [p2],
        sections: [
          { mode: first, via: [p1], geometry: [A, p1, p2], fallback: false },
          { mode: second, via: [], geometry: [p2, B], fallback: false },
        ],
      },
    ],
  });

  it('une las partes con el mismo modo a los dos lados de un cambio de modo viejo', () => {
    expect(storedRouteInput(stored('streets', 'streets'))).toEqual(
      oneLeg({ waypoints: [], sections: [{ mode: 'streets', via: [p1, p2] }] }),
    );
    expect(storedRouteInput(stored('streets', 'manual'))?.legs[0]?.waypoints).toEqual([p2]);
    expect(storedRouteInput(null)).toBeNull();
  });
});

describe('estado de cada parte', () => {
  const mixed = oneLeg({
    waypoints: [p2],
    sections: [
      { mode: 'streets', via: [p1] },
      { mode: 'manual', via: [] },
    ],
  });
  const calculated: RoundRoute = {
    v: 1,
    closed: false,
    legs: [
      {
        from: A,
        to: B,
        waypoints: [p2],
        sections: [
          { mode: 'streets', via: [p1], geometry: [A, [0.001, 0], p1, p2], fallback: false },
          { mode: 'manual', via: [], geometry: [p2, B], fallback: false },
        ],
      },
    ],
  };
  const states = (route: RouteInput, memo: SectionMemo, coords = [A, B]) =>
    resolveRoute(route, coords, memo).parts.map((part) => part.state);

  it('sin calcular hasta tener su línea, y vuelve a sin calcular al tocarla', () => {
    expect(states(mixed, new Map())).toEqual(['pending', 'manual']);
    const memo = rememberRoute(new Map(), calculated);
    const { display, parts } = resolveRoute(mixed, [A, B], memo);
    expect(parts.map((part) => part.state)).toEqual(['calculated', 'manual']);
    expect(display.legs[0]?.sections[0]).toMatchObject({ fallback: false });
    expect(display.legs[0]?.sections[0]?.geometry).toHaveLength(4);
    const moved = routeEdits.moveVia(mixed, 0, 0, 0, [0.003, 0.001]);
    expect(states(moved, memo)).toEqual(['pending', 'manual']);
    // Mover un punto de control también cambia la parte.
    expect(states(mixed, memo, [[0.0001, 0], B])).toEqual(['pending', 'manual']);
  });

  it('falló hasta que se edita; las fallas pasajeras quedan para reintentar', () => {
    const failed = rememberFailures(
      new Map(),
      mixed,
      [A, B],
      [{ leg: 0, section: 0, reason: 'unreachable_point' }],
    );
    expect(resolveRoute(mixed, [A, B], failed).parts[0]).toMatchObject({
      state: 'failed',
      failure: 'unreachable_point',
    });
    const retry = rememberFailures(
      failed,
      mixed,
      [A, B],
      [{ leg: 0, section: 0, reason: 'rate_limited' }],
    );
    expect(states(mixed, retry)).toEqual(['pending', 'manual']);
  });

  it('una parte guardada recta se reconoce', () => {
    const straight = rememberRoute(new Map(), {
      ...calculated,
      legs: calculated.legs.map((leg) => ({
        ...leg,
        sections: leg.sections.map((section) => ({ ...section, fallback: true })),
      })),
    });
    expect(states(mixed, straight)).toEqual(['straight', 'manual']);
    // Se puede volver a pedir: cuenta para «Calcular por calles».
    expect(requestEstimate(resolveRoute(mixed, [A, B], straight).parts)).toEqual({
      pending: 1,
      requests: 1,
    });
  });

  it('estima un pedido por cada corrida de partes por calles seguidas sin calcular', () => {
    const streets = defaultRouteInput(3, false);
    const coords = [A, B, C];
    expect(requestEstimate(resolveRoute(streets, coords, new Map()).parts)).toEqual({
      pending: 2,
      requests: 1,
    });
    const cut = routeEdits.setMode(defaultRouteInput(4, false), 1, 0, 'manual');
    expect(requestEstimate(resolveRoute(cut, [A, B, C, [0.03, 0]], new Map()).parts)).toEqual({
      pending: 2,
      requests: 2,
    });
    const first: RoundRoute = {
      v: 1,
      closed: false,
      legs: [
        {
          from: A,
          to: B,
          waypoints: [],
          sections: [{ mode: 'streets', via: [], geometry: [A, B], fallback: false }],
        },
      ],
    };
    const done = rememberRoute(new Map(), first);
    expect(requestEstimate(resolveRoute(streets, coords, done).parts)).toEqual({
      pending: 1,
      requests: 1,
    });
    const all = rememberRoute(new Map(), calculated);
    expect(requestEstimate(resolveRoute(mixed, [A, B], all).parts)).toEqual({
      pending: 0,
      requests: 0,
    });
  });

  it('lo guardado sigue valiendo si los puntos se movieron hasta 5 m', () => {
    const memo = (coords: LngLat[]) => rememberRoute(new Map(), rebaseRoute(calculated, coords));
    const near: LngLat = [0.00002, 0]; // unos 2 m
    const far: LngLat = [0.001, 0]; // unos 110 m
    expect(states(mixed, memo([near, B]), [near, B])).toEqual(['calculated', 'manual']);
    expect(states(mixed, memo([far, B]), [far, B])).toEqual(['pending', 'manual']);
  });
});

describe('textos', () => {
  it('nombra la parte culpable, junta las fallas generales y no cuenta las salteadas', () => {
    const route = defaultRouteInput(3, true);
    const failures = [
      { leg: 1, section: 0, reason: 'unreachable_point' as const },
      { leg: 2, section: 0, reason: 'skipped' as const },
      { leg: 0, section: 0, reason: 'unavailable' as const },
      { leg: 2, section: 0, reason: 'unavailable' as const },
    ];
    expect(failureMessages(failures, route)).toEqual([
      expect.stringContaining('Tramo 2 → 3: Un punto'),
      'El servicio de rutas no respondió. Reintentá en un momento.',
    ]);
    expect(legLabel(2, 3, true)).toBe('3 → 1 (vuelta)');
    const split = routeEdits.splitAtVia(
      oneLeg({ waypoints: [], sections: [{ mode: 'streets', via: [p1] }] }),
      0,
      0,
      0,
    );
    expect(partLabel(split, 0, 1)).toBe('Tramo 1 → 2, parte 2');
  });

  it('mide cada tramo sobre la línea y formatea en m o km', () => {
    const meters = legMeters({
      v: 1,
      closed: false,
      legs: [
        {
          from: gate,
          to: bend,
          waypoints: [],
          sections: [{ mode: 'manual', via: [], geometry: [gate, bend], fallback: false }],
        },
      ],
    });
    expect(meters[0]).toBeGreaterThan(1000);
    expect(formatMeters(1440)).toBe('1,4 km');
    expect(formatMeters(87.4)).toBe('87 m');
  });
});
