import type { LngLat } from '@garita/shared';
import { routeCacheKey } from './route-cache';
import { NullRouting, OpenRouteServiceRouting, ORS_TIMEOUT_MS } from './routing.port';

const coordinates: LngLat[] = [
  [-58.38, -34.6],
  [-58.37, -34.61],
];
const line: LngLat[] = [
  [-58.38, -34.6],
  [-58.375, -34.605],
  [-58.37, -34.61],
];

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

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('OpenRouteServiceRouting', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('pide la ruta con el perfil del predio y guarda la línea en caché', async () => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockReturnValue(
      ok({
        type: 'FeatureCollection',
        features: [{ geometry: { type: 'LineString', coordinates: line } }],
      }),
    );
    await expect(routing.route('walking', coordinates)).resolves.toEqual(line);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ors.test/v2/directions/foot-walking/geojson');
    expect(init.headers).toMatchObject({ Authorization: 'clave' });
    expect(JSON.parse(init.body as string)).toEqual({ coordinates });
    expect(cache.set).toHaveBeenCalledWith('walking', coordinates, line);
  });

  it('usa la caché sin llamar al servicio', async () => {
    const { cache, fetchMock, routing } = setup();
    cache.get.mockResolvedValue(line);
    await expect(routing.route('vehicle', coordinates)).resolves.toEqual(line);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('devuelve null ante una respuesta mal formada y no la guarda', async () => {
    const { cache, fetchMock, routing } = setup();
    fetchMock.mockReturnValue(
      ok({ features: [{ geometry: { type: 'Point', coordinates: [1, 2] } }] }),
    );
    await expect(routing.route('bicycle', coordinates)).resolves.toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('devuelve null ante un error HTTP', async () => {
    const { fetchMock, routing } = setup();
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(routing.route('walking', coordinates)).resolves.toBeNull();
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
    const result = routing.route('walking', coordinates);
    await jest.advanceTimersByTimeAsync(ORS_TIMEOUT_MS);
    await expect(result).resolves.toBeNull();
  });
});

describe('NullRouting', () => {
  it('nunca calcula: todo queda recto', async () => {
    await expect(new NullRouting().route()).resolves.toBeNull();
  });
});

describe('routeCacheKey', () => {
  it('es igual con diferencias menores a 6 decimales y distinta por perfil', () => {
    const key = routeCacheKey('walking', coordinates);
    expect(routeCacheKey('walking', [[-58.3800001, -34.6], coordinates[1] ?? [0, 0]])).toBe(key);
    expect(routeCacheKey('vehicle', coordinates)).not.toBe(key);
    expect(key).toMatch(/^routing:v1:[0-9a-f]{64}$/);
  });
});
