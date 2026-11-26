import {
  defaultRouteInput,
  legCount,
  legEndpoints,
  type LngLat,
  polyline,
  type RoundRoute,
  routeInputSchema,
  roundRoutePreviewInputSchema,
  sectionEndpoints,
  staleLegs,
  validateRouteInput,
} from './route';
import { roundInputSchema } from './schemas';

const a: LngLat = [-64.1, -31.45];
const b: LngLat = [-64.101, -31.451];
const c: LngLat = [-64.102, -31.452];

describe('tramos del recorrido', () => {
  it('cuenta un tramo por par de puntos y suma el regreso cuando es circuito', () => {
    expect(legCount(1, true)).toBe(0);
    expect(legCount(3, false)).toBe(2);
    expect(legCount(3, true)).toBe(3);
    expect(legCount(2, true)).toBe(2);
  });

  it('respeta el orden de la ronda y cierra en el primer punto', () => {
    expect(legEndpoints([a, b, c], true)).toEqual([
      [a, b],
      [b, c],
      [c, a],
    ]);
    expect(legEndpoints([a, b, c], false)).toEqual([
      [a, b],
      [b, c],
    ]);
  });

  it('arma por defecto cada tramo por calles y sin puntos de paso', () => {
    const route = defaultRouteInput(3);
    expect(route.closed).toBe(true);
    expect(route.legs).toHaveLength(3);
    expect(route.legs[0]).toEqual({ waypoints: [], sections: [{ mode: 'streets', via: [] }] });
  });

  it('corta el tramo en secciones en cada punto de paso', () => {
    expect(sectionEndpoints(a, c, [b])).toEqual([
      [a, b],
      [b, c],
    ]);
    expect(polyline(a, [b], c)).toEqual([a, b, c]);
  });
});

describe('validación del recorrido', () => {
  it('exige una sección más que puntos de paso', () => {
    const parsed = routeInputSchema.safeParse({
      closed: false,
      legs: [{ waypoints: [b], sections: [{ mode: 'manual', via: [] }] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rechaza coordenadas fuera de rango', () => {
    const parsed = routeInputSchema.safeParse({
      closed: false,
      legs: [{ waypoints: [[-200, 0]], sections: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('pide tantos tramos como corresponden a los puntos de la ronda', () => {
    const base = {
      name: 'Nocturna',
      checkpointIds: ['p1', 'p2', 'p3'],
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
    };
    expect(roundInputSchema.safeParse({ ...base, route: defaultRouteInput(3) }).success).toBe(true);
    expect(roundInputSchema.safeParse({ ...base, route: defaultRouteInput(2) }).success).toBe(
      false,
    );
    expect(roundInputSchema.safeParse(base).success).toBe(true);
    // Velocidad propia: opcional; la personalizada exige km/h.
    expect(roundInputSchema.safeParse({ ...base, speedProfile: 'vehicle' }).success).toBe(true);
    expect(roundInputSchema.safeParse({ ...base, speedProfile: null }).success).toBe(true);
    // Tal como lo devuelve el listado: null en los dos campos.
    expect(
      roundInputSchema.safeParse({ ...base, speedProfile: null, maxSpeedKmh: null }).data
        ?.maxSpeedKmh,
    ).toBeNull();
    expect(roundInputSchema.safeParse({ ...base, speedProfile: 'custom' }).success).toBe(false);
    expect(
      roundInputSchema.safeParse({ ...base, speedProfile: 'custom', maxSpeedKmh: 40 }).success,
    ).toBe(true);
  });

  it('no deja que el recorrido se aleje más de 25 km del predio', () => {
    const route = defaultRouteInput(2, false);
    expect(validateRouteInput(route, [a, b], a)).toEqual([]);
    route.legs[0]?.sections[0]?.via.push([-63.5, -31.45]);
    expect(validateRouteInput(route, [a, b], a)).toEqual([
      { path: ['legs', 0], message: 'El recorrido no puede alejarse más de 25 km del predio.' },
    ]);
  });
});

describe('tramos desactualizados', () => {
  const route: RoundRoute = {
    v: 1,
    closed: false,
    legs: [
      {
        from: a,
        to: b,
        waypoints: [],
        sections: [{ mode: 'manual', via: [], geometry: [a, b], fallback: false }],
      },
      {
        from: b,
        to: c,
        waypoints: [],
        sections: [{ mode: 'manual', via: [], geometry: [b, c], fallback: false }],
      },
    ],
  };

  it('marca solo los tramos que tocan un punto movido más de 5 m', () => {
    expect(staleLegs(route, [a, b, c])).toEqual([]);
    const moved: LngLat = [b[0] + 0.001, b[1]]; // unos 95 m
    expect(staleLegs(route, [a, moved, c])).toEqual([0, 1]);
    expect(staleLegs(route, [a, b, [c[0] + 0.001, c[1]]])).toEqual([1]);
  });

  it('marca todo si cambió la cantidad de puntos', () => {
    expect(staleLegs(route, [a, b])).toEqual([0, 1]);
  });
});

describe('vista previa de la ronda', () => {
  it('pide al menos dos puntos y un recorrido válido', () => {
    const route = defaultRouteInput(2);
    expect(
      roundRoutePreviewInputSchema.safeParse({ siteId: 'p', checkpointIds: ['a'], route }).success,
    ).toBe(false);
    expect(
      roundRoutePreviewInputSchema.safeParse({ siteId: 'p', checkpointIds: ['a', 'b'], route })
        .success,
    ).toBe(true);
  });

  it('rechaza puntos repetidos y más puntos que el tope', () => {
    const parse = (checkpointIds: string[]) =>
      roundRoutePreviewInputSchema.safeParse({
        siteId: 'p',
        checkpointIds,
        route: defaultRouteInput(checkpointIds.length),
      }).success;
    expect(parse(['a', 'b', 'a'])).toBe(false);
    expect(parse(Array.from({ length: 501 }, (_, i) => `p${String(i)}`))).toBe(false);
  });
});
