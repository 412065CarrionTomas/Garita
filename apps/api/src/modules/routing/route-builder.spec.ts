import { roundRouteSchema, type LngLat } from '@garita/shared';
import { RouteBuilder } from './route-builder';
import type { RoutingPort } from './routing.port';

const a: LngLat = [-58.38, -34.6];
const b: LngLat = [-58.37, -34.6];
const c: LngLat = [-58.37, -34.61];
const gate: LngLat = [-58.375, -34.6];
const bend: LngLat = [-58.372, -34.602];

function builder(route: RoutingPort['route']) {
  const port = { route: jest.fn(route) };
  return { port, routes: new RouteBuilder(port) };
}

/** Puerto falso que "rutea" agregando el primer punto al final, para distinguirlo de la recta. */
const echo: RoutingPort['route'] = (_profile, sections) =>
  Promise.resolve(sections.map((section) => ({ line: [...section, section[0] ?? a] })));
const failing: RoutingPort['route'] = (_profile, sections) =>
  Promise.resolve(sections.map(() => ({ failure: 'unavailable' as const })));

describe('RouteBuilder', () => {
  it('pide por calles las secciones de calle y traza a mano las otras', async () => {
    const { port, routes } = builder(echo);
    const { route, failures } = await routes.build(
      {
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
      },
      [a, b],
      'vehicle',
    );
    expect(port.route).toHaveBeenCalledWith('vehicle', [[a, gate]]);
    const [leg] = route.legs;
    expect(leg).toMatchObject({ from: a, to: b, waypoints: [gate] });
    expect(leg?.sections).toEqual([
      { mode: 'streets', via: [], geometry: [a, gate, a], fallback: false },
      { mode: 'manual', via: [bend], geometry: [gate, bend, b], fallback: false },
    ]);
    expect(roundRouteSchema.safeParse(route).success).toBe(true);
    expect(failures).toEqual([]);
  });

  it('deja recta y con fallback la sección por calles si el ruteo falla', async () => {
    const { routes } = builder(failing);
    const { route, failures } = await routes.build(
      { closed: false, legs: [{ waypoints: [], sections: [{ mode: 'streets', via: [gate] }] }] },
      [a, b],
      'walking',
    );
    expect(route.legs[0]?.sections[0]).toEqual({
      mode: 'streets',
      via: [gate],
      geometry: [a, gate, b],
      fallback: true,
    });
    expect(failures).toEqual([{ leg: 0, section: 0, reason: 'unavailable' }]);
  });

  it('informa tramo y sección de cada falla, sin contar las secciones a mano', async () => {
    const { routes } = builder((_profile, sections) =>
      Promise.resolve(
        sections.map((_, i) =>
          i === 1 ? { failure: 'unreachable_point' as const } : { line: [a, b] },
        ),
      ),
    );
    const leg = { waypoints: [], sections: [{ mode: 'streets' as const, via: [] }] };
    const mixed = {
      waypoints: [gate],
      sections: [
        { mode: 'manual' as const, via: [] },
        { mode: 'streets' as const, via: [] },
      ],
    };
    const { failures } = await routes.build(
      { closed: false, legs: [leg, mixed] },
      [a, b, c],
      'walking',
    );
    expect(failures).toEqual([{ leg: 1, section: 1, reason: 'unreachable_point' }]);
  });

  it('manda todas las secciones de la ronda en una sola llamada, con el regreso al inicio', async () => {
    const { port, routes } = builder(failing);
    const leg = { waypoints: [], sections: [{ mode: 'streets' as const, via: [] }] };
    const { route } = await routes.build(
      { closed: true, legs: [leg, leg, leg] },
      [a, b, c],
      'bicycle',
    );
    expect(route.closed).toBe(true);
    expect(port.route).toHaveBeenCalledTimes(1);
    expect(port.route).toHaveBeenCalledWith('bicycle', [
      [a, b],
      [b, c],
      [c, a],
    ]);
    expect(route.legs.map(({ from, to }) => [from, to])).toEqual([
      [a, b],
      [b, c],
      [c, a],
    ]);
  });

  it('rechaza una cantidad de tramos que no coincide con los puntos', async () => {
    const { routes } = builder(failing);
    await expect(routes.build({ closed: true, legs: [] }, [a, b], 'walking')).rejects.toThrow();
  });
});
