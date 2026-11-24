import type { LngLat, RoundRoute } from '@garita/shared';
import { arrowImage, routeFeatures } from './route-features';

const a: LngLat = [-64.1, -31.4];
const b: LngLat = [-64.2, -31.4];
const c: LngLat = [-64.2, -31.5];
const gate: LngLat = [-64.15, -31.4];
const points = [
  { id: 'a', lng: a[0], lat: a[1], status: 'done' as const },
  { id: 'b', lng: b[0], lat: b[1], status: 'missed' as const },
  { id: 'c', lng: c[0], lat: c[1], status: 'pending' as const },
];
const section = (geometry: LngLat[], mode: 'streets' | 'manual' = 'streets', fallback = false) => ({
  mode,
  via: [],
  geometry,
  fallback,
});

const route: RoundRoute = {
  v: 1,
  closed: true,
  legs: [
    {
      from: a,
      to: b,
      waypoints: [gate],
      sections: [section([a, gate]), section([gate, b], 'manual')],
    },
    { from: b, to: c, waypoints: [], sections: [section([b, c], 'streets', true)] },
    { from: c, to: a, waypoints: [], sections: [section([c, a])] },
  ],
};

describe('routeFeatures', () => {
  it('dibuja la geometría guardada con el tipo de cada sección y el estado del destino', () => {
    const { lines, modeChanges } = routeFeatures(
      [{ checkpointIds: ['a', 'b', 'c'], route }],
      points,
    );
    expect(lines.features.map((f) => [f.properties, f.geometry.coordinates])).toEqual([
      // Tramo a → b: destino faltó, sólido. Calle hasta el portón y a mano adentro.
      [{ kind: 'streets', solid: true, leg: 0, section: 0 }, [a, gate]],
      [{ kind: 'manual', solid: true, leg: 0, section: 1 }, [gate, b]],
      // b → c: sin calcular (fallback) y destino pendiente: atenuado.
      [{ kind: 'fallback', solid: false, leg: 1, section: 0 }, [b, c]],
      // Regreso al inicio: el destino es el primer punto, ya registrado.
      [{ kind: 'streets', solid: true, leg: 2, section: 0 }, [c, a]],
    ]);
    expect(modeChanges).toEqual([{ at: gate, from: 'streets', to: 'manual' }]);
  });

  it('dibuja recta y como fallback una ronda sin recorrido guardado, sin cerrar el circuito', () => {
    const { lines } = routeFeatures([{ checkpointIds: ['a', 'b', 'c'], route: null }], points);
    expect(lines.features.map((f) => [f.properties, f.geometry.coordinates])).toEqual([
      [{ kind: 'fallback', solid: true, leg: 0, section: 0 }, [a, b]],
      [{ kind: 'fallback', solid: false, leg: 1, section: 0 }, [b, c]],
    ]);
  });

  it('dibuja un recorrido por ronda', () => {
    const open: RoundRoute = { v: 1, closed: false, legs: [route.legs[0] ?? never()] };
    const { lines } = routeFeatures(
      [
        { checkpointIds: ['a', 'b'], route: open },
        {
          checkpointIds: ['c', 'a'],
          route: { v: 1, closed: false, legs: [route.legs[2] ?? never()] },
        },
      ],
      points,
    );
    expect(lines.features).toHaveLength(3);
  });
});

describe('arrowImage', () => {
  it('es una imagen alfa del tamaño pedido con trazo y fondo transparente', () => {
    const { width, height, data } = arrowImage(24);
    expect([width, height, data.length]).toEqual([24, 24, 24 * 24 * 4]);
    const alpha = (x: number, y: number) => data[(y * 24 + x) * 4 + 3] ?? 0;
    expect(alpha(15, 12)).toBeGreaterThan(191);
    expect(alpha(0, 0)).toBe(0);
  });
});

function never(): never {
  throw new Error('fixture incompleta');
}
