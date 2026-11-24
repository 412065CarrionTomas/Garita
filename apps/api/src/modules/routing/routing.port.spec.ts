import { chainSections, type LngLat } from '@garita/shared';
import { routeCacheKey } from './route-cache';
import {
  NullRouting,
  OpenRouteServiceRouting,
  ORS_MAX_COORDINATES,
  ORS_TIMEOUT_MS,
} from './routing.port';

const a: LngLat = [-58.38, -34.6];
const b: LngLat = [-58.37, -34.61];
const c: LngLat = [-58.36, -34.62];
const mid1: LngLat = [-58.375, -34.605];
const mid2: LngLat = [-58.365, -34.615];

function setup() {
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const fetchMock = jest.fn();
  jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  const routing = new OpenRouteServiceRouting('clave', 'https://ors.test', cache);
  return { cache, fetchMock, routing };
}

const feature = (coordinates: LngLat[], wayPoints: number[]) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            geometry: { type: 'LineString', coordinates },
            properties: { way_points: wayPoints },
          },
        ],
      }),
      { status: 200 },
    ),
  );
const sentCoordinates = (fetchMock: jest.Mock, call = 0) => {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return (JSON.parse(init.body as string) as { coordinates: LngLat[] }).coordinates;
};

describe('OpenRouteServiceRouting', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('pide la ruta con el perfil del predio y guarda la línea en caché', async () => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockReturnValue(feature([a, mid1, b], [0, 2]));
    await expect(routing.route('walking', [[a, b]])).resolves.toEqual([{ line: [a, mid1, b] }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ors.test/v2/directions/foot-walking/geojson');
    expect(init.headers).toMatchObject({ Authorization: 'clave' });
    expect(cache.set).toHaveBeenCalledWith('walking', [a, b], [a, mid1, b]);
  });

  it('agrupa secciones encadenadas en un solo pedido y corta la línea por sección', async () => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockReturnValue(feature([a, mid1, b, mid2, c, a], [0, 2, 4, 5]));
    const sections = [
      [a, b],
      [b, c],
      [c, a],
    ];
    await expect(routing.route('vehicle', sections)).resolves.toEqual([
      { line: [a, mid1, b] },
      { line: [b, mid2, c] },
      { line: [c, a] },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentCoordinates(fetchMock)).toEqual([a, b, c, a]);
    expect(cache.set).toHaveBeenCalledTimes(3);
  });

  it('solo pide las secciones que no están en caché', async () => {
    const { cache, fetchMock, routing } = setup();
    cache.get.mockImplementation((_profile: string, section: LngLat[]) =>
      Promise.resolve(section[0] === b ? [b, mid2, c] : null),
    );
    fetchMock.mockReturnValueOnce(feature([a, mid1, b], [0, 2]));
    fetchMock.mockReturnValueOnce(feature([c, a], [0, 1]));
    const lines = await routing.route('walking', [
      [a, b],
      [b, c],
      [c, a],
    ]);
    expect(lines).toEqual([{ line: [a, mid1, b] }, { line: [b, mid2, c] }, { line: [c, a] }]);
    // La sección del medio salió de caché: las otras dos ya no se tocan y van por separado.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('usa la recta si dos puntos caen en el mismo lugar de la calle', async () => {
    const { fetchMock, routing } = setup();
    // b y c se ubican en la misma posición de la línea (índice 2).
    fetchMock.mockReturnValue(feature([a, mid1, b, mid2, a], [0, 2, 2, 4]));
    await expect(
      routing.route('walking', [
        [a, b],
        [b, c],
        [c, a],
      ]),
    ).resolves.toEqual([{ line: [a, mid1, b] }, { line: [b, c] }, { line: [b, mid2, a] }]);
  });

  it.each([
    ['al revés', [0, 3, 2]],
    ['fuera de la línea', [0, 2, 9]],
  ])('no guarda como recta una sección con way_points %s', async (_case, wayPoints) => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockReturnValue(feature([a, mid1, b, c], wayPoints));
    const lines = await routing.route('walking', [
      [a, b],
      [b, c],
    ]);
    expect(lines[1]).toEqual({ failure: 'unavailable' });
    expect(cache.set).not.toHaveBeenCalledWith('walking', [b, c], expect.anything());
  });

  it('deja todo el grupo sin calcular si los way_points no coinciden con lo enviado', async () => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockReturnValue(feature([a, b, c], [0, 2]));
    await expect(
      routing.route('walking', [
        [a, b],
        [b, c],
      ]),
    ).resolves.toEqual([{ failure: 'unavailable' }, { failure: 'unavailable' }]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('informa servicio no disponible ante una respuesta mal formada', async () => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ features: [{ geometry: { type: 'Point' } }] })),
    );
    await expect(routing.route('bicycle', [[a, b]])).resolves.toEqual([{ failure: 'unavailable' }]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('informa el límite de pedidos ante 429 o 403', async () => {
    const { fetchMock, routing } = setup();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    for (let i = 0; i < 2; i++)
      await expect(routing.route('walking', [[a, b]])).resolves.toEqual([
        { failure: 'rate_limited' },
      ]);
  });

  it('marca la sección del punto que no está cerca de una calle y saltea las demás', async () => {
    const { cache, fetchMock, routing } = setup();
    const message =
      'Could not find routable point within a radius of 350.0 meters of specified coordinate 2: -58.375 -34.605.';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 2010, message } }), { status: 404 }),
    );
    // Pedido: [a, b, mid1, c, a] → la coordenada 2 (mid1) es un quiebre de la sección 1.
    await expect(
      routing.route('walking', [
        [a, b],
        [b, mid1, c],
        [c, a],
      ]),
    ).resolves.toEqual([
      { failure: 'skipped' },
      { failure: 'unreachable_point' },
      { failure: 'skipped' },
    ]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('marca la sección sin camino entre sus puntos', async () => {
    const { fetchMock, routing } = setup();
    const message =
      'Route could not be found - Unable to find a route between points 0 (…) and 1 (…).';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 2009, message } }), { status: 404 }),
    );
    await expect(
      routing.route('walking', [
        [a, b],
        [b, c],
      ]),
    ).resolves.toEqual([{ failure: 'no_route' }, { failure: 'skipped' }]);
  });

  it('sin saber el punto, marca todo el pedido con el motivo', async () => {
    const { fetchMock, routing } = setup();
    fetchMock.mockResolvedValue(new Response('no es json', { status: 500 }));
    await expect(
      routing.route('walking', [
        [a, b],
        [b, c],
      ]),
    ).resolves.toEqual([{ failure: 'unavailable' }, { failure: 'unavailable' }]);
  });

  it('corta el pedido a los 5 segundos y devuelve null', async () => {
    jest.useFakeTimers();
    const { fetchMock, routing } = setup();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const result = routing.route('walking', [[a, b]]);
    await jest.advanceTimersByTimeAsync(ORS_TIMEOUT_MS);
    await expect(result).resolves.toEqual([{ failure: 'unavailable' }]);
  });
});

describe('chainSections', () => {
  it('corta la cadena donde una sección no empieza en el fin de la anterior', () => {
    expect(
      chainSections(
        [
          [a, b],
          [b, c],
          [a, c],
        ],
        [false, false, false],
      ),
    ).toEqual([[0, 1], [2]]);
  });

  it('parte la cadena al llegar al tope de puntos por pedido', () => {
    const sections = Array.from({ length: ORS_MAX_COORDINATES + 5 }, (_, i): LngLat[] => [
      [i / 1000, 0],
      [(i + 1) / 1000, 0],
    ]);
    const chains = chainSections(
      sections,
      sections.map(() => false),
    );
    expect(chains.map((chain) => chain.length)).toEqual([ORS_MAX_COORDINATES - 1, 6]);
  });
});

describe('NullRouting', () => {
  it('nunca calcula: informa que falta la clave', async () => {
    await expect(new NullRouting().route('walking', [[a, b]])).resolves.toEqual([
      { failure: 'not_configured' },
    ]);
  });
});

describe('routeCacheKey', () => {
  it('es igual con diferencias menores a 6 decimales y distinta por perfil', () => {
    const key = routeCacheKey('walking', [a, b]);
    expect(routeCacheKey('walking', [[-58.3800001, -34.6], b])).toBe(key);
    expect(routeCacheKey('vehicle', [a, b])).not.toBe(key);
    expect(key).toMatch(/^routing:v1:[0-9a-f]{64}$/);
  });
});
