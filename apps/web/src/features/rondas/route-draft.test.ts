import { defaultRouteInput, type LngLat, type RouteInput } from '@garita/shared';
import {
  failedLegs,
  failureMessages,
  formatMeters,
  legMeters,
  legLabel,
  reconcileRoute,
  routeEdits,
  sectionOptions,
  sectionMidpoint,
  storedRouteInput,
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

describe('routeEdits', () => {
  const base = defaultRouteInput(2, false);

  it('un punto de paso parte el tramo y al quitarlo las secciones se unen con sus quiebres', () => {
    const withGate = routeEdits.addWaypoint(base, 0, gate);
    expect(withGate.legs[0]?.sections).toHaveLength(2);
    const traced = routeEdits.addVia(routeEdits.setMode(withGate, 0, 1, 'manual'), 0, 1, bend);
    const merged = routeEdits.removeWaypoint(traced, 0, 0);
    expect(merged.legs[0]).toEqual({ waypoints: [], sections: [{ mode: 'streets', via: [bend] }] });
  });

  it('deshace el último quiebre y borra el trazado', () => {
    const two = routeEdits.addVia(routeEdits.addVia(base, 0, 0, gate), 0, 0, bend);
    expect(routeEdits.undoVia(two, 0, 0).legs[0]?.sections[0]?.via).toEqual([gate]);
    expect(routeEdits.clearVia(two, 0, 0).legs[0]?.sections[0]?.via).toEqual([]);
  });

  it('agrega con teclado en la mitad del último tramo recto de la sección', () => {
    expect(
      sectionMidpoint(
        base,
        [
          [0, 0],
          [2, 2],
        ],
        0,
        0,
      ),
    ).toEqual([1, 1]);
  });
});

describe('storedRouteInput', () => {
  it('saca la geometría del recorrido guardado y rechaza lo inválido', () => {
    const stored = {
      v: 1,
      closed: false,
      legs: [
        {
          from: [0, 0],
          to: [1, 1],
          waypoints: [],
          sections: [
            {
              mode: 'streets',
              via: [],
              geometry: [
                [0, 0],
                [1, 1],
              ],
              fallback: true,
            },
          ],
        },
      ],
    };
    expect(storedRouteInput(stored)).toEqual({
      closed: false,
      legs: [{ waypoints: [], sections: [{ mode: 'streets', via: [] }] }],
    });
    expect(storedRouteInput(null)).toBeNull();
  });
});

describe('mensajes de falla', () => {
  it('nombra el tramo culpable, junta las fallas generales y no cuenta las salteadas', () => {
    const failures = [
      { leg: 1, section: 0, reason: 'unreachable_point' as const },
      { leg: 2, section: 0, reason: 'skipped' as const },
      { leg: 0, section: 0, reason: 'unavailable' as const },
      { leg: 2, section: 1, reason: 'unavailable' as const },
    ];
    expect(failureMessages(failures, 3, true)).toEqual([
      expect.stringContaining('tramo 2 → 3'),
      'El servicio de rutas no respondió. Reintentá en un momento.',
    ]);
    expect([...failedLegs(failures)].sort()).toEqual([0, 1, 2]);
    expect(legLabel(2, 3, true)).toBe('3 → 1 (regreso)');
  });
});

describe('edición desde el mapa', () => {
  const route: RouteInput = {
    closed: false,
    legs: [
      {
        waypoints: [gate],
        sections: [
          { mode: 'streets', via: [] },
          { mode: 'manual', via: [bend] },
        ],
      },
    ],
  };

  it('inserta el punto de paso en la sección tocada y la parte con su mismo modo', () => {
    const at: LngLat = [-64.17, -31.42];
    const next = routeEdits.insertWaypoint(route, 0, 1, at);
    expect(next.legs[0]?.waypoints).toEqual([gate, at]);
    expect(next.legs[0]?.sections).toEqual([
      { mode: 'streets', via: [] },
      { mode: 'manual', via: [bend] },
      { mode: 'manual', via: [] },
    ]);
    // Al principio de la sección 0 queda antes del punto de paso existente.
    expect(routeEdits.insertWaypoint(route, 0, 0, at).legs[0]?.waypoints).toEqual([at, gate]);
  });

  it('borra un quiebre puntual y lista las secciones con su nombre', () => {
    expect(routeEdits.removeVia(route, 0, 1, 0).legs[0]?.sections[1]?.via).toEqual([]);
    expect(sectionOptions(route).map((option) => option.label)).toEqual([
      'Tramo 1 → 2 (parte 1)',
      'Tramo 1 → 2 (parte 2)',
    ]);
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
