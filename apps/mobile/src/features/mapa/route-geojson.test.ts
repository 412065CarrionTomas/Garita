import type { GuardRoundVersion } from '@garita/shared';
import { boundsOf, routeGeoJson } from './route-geojson';

const version: GuardRoundVersion = {
  id: 'v1',
  roundId: 'r1',
  name: 'Perimetral',
  frequencyMinutes: 60,
  windowStartLocal: '22:00',
  windowEndLocal: '06:00',
  checkpoints: [
    { id: 'a', name: 'Portón', latitude: -31.4, longitude: -64.2, isIndoor: false },
    { id: 'b', name: 'Galpón', latitude: -31.5, longitude: -64.1, isIndoor: true },
  ],
  route: null,
};

it('sin recorrido guardado une los puntos en orden y los numera con su estado', () => {
  const { line, points, bounds } = routeGeoJson([version], (id) => (id === 'a' ? 'done' : 'next'));
  expect(line.features).toHaveLength(1);
  expect(line.features[0]?.geometry.coordinates).toEqual([
    [-64.2, -31.4],
    [-64.1, -31.5],
  ]);
  expect(points.features.map((f) => f.properties)).toEqual([
    { round: 0, label: '1', state: 'done' },
    { round: 0, label: '2', state: 'next' },
  ]);
  expect(bounds).toEqual([-64.2, -31.5, -64.1, -31.4]);
});

it('con recorrido dibuja cada sección por calles y encuadra también sus desvíos', () => {
  const geometry: [number, number][] = [
    [-64.2, -31.4],
    [-64.3, -31.45],
    [-64.1, -31.5],
  ];
  const { line, bounds } = routeGeoJson([
    {
      ...version,
      route: {
        v: 1,
        closed: false,
        legs: [
          {
            from: [-64.2, -31.4],
            to: [-64.1, -31.5],
            waypoints: [],
            sections: [{ mode: 'streets', via: [], geometry, fallback: false }],
          },
        ],
      },
    },
  ]);
  expect(line.features[0]?.geometry.coordinates).toEqual(geometry);
  expect(bounds).toEqual([-64.3, -31.5, -64.1, -31.4]);
});

it('sin coordenadas no hay encuadre, y con un solo punto el encuadre no queda en cero', () => {
  expect(boundsOf([])).toBeNull();
  const [west, south, east, north] = boundsOf([[-64.1, -31.4]]) ?? [];
  expect((east ?? 0) - (west ?? 0)).toBeCloseTo(0.002);
  expect((north ?? 0) - (south ?? 0)).toBeCloseTo(0.002);
  expect(((west ?? 0) + (east ?? 0)) / 2).toBeCloseTo(-64.1);
});
