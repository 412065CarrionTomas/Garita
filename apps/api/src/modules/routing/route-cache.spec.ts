import type { ConfigService } from '@nestjs/config';
import type { LngLat } from '@garita/shared';
import type { Env } from '../../config/env';
import { RouteCache, routeCacheKey } from './route-cache';

const redis = {
  status: 'wait',
  connect: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('ioredis', () => ({ Redis: jest.fn(() => redis) }));

const a: LngLat = [-58.38, -34.6];
const b: LngLat = [-58.37, -34.61];
const config = { get: () => 'redis://test' } as unknown as ConfigService<Env, true>;

function setup(status = 'ready') {
  redis.status = status;
  redis.connect.mockImplementation(() => {
    redis.status = 'ready';
    return Promise.resolve();
  });
  return new RouteCache(config);
}

describe('RouteCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('conecta una sola vez aunque lleguen varios pedidos juntos', async () => {
    const cache = setup('wait');
    redis.get.mockResolvedValue(null);
    await Promise.all([cache.get('walking', [a, b]), cache.get('walking', [b, a])]);
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it('devuelve la línea guardada y descarta lo que no es una línea válida', async () => {
    const cache = setup();
    redis.get.mockResolvedValueOnce(JSON.stringify([a, b]));
    await expect(cache.get('walking', [a, b])).resolves.toEqual([a, b]);
    redis.get.mockResolvedValueOnce(JSON.stringify([[500, 0], b]));
    await expect(cache.get('walking', [a, b])).resolves.toBeNull();
    redis.get.mockResolvedValueOnce('no es json');
    await expect(cache.get('walking', [a, b])).resolves.toBeNull();
  });

  it('sin Redis sigue sin caché: no espera ni falla', async () => {
    const cache = setup('reconnecting');
    await expect(cache.get('walking', [a, b])).resolves.toBeNull();
    await expect(cache.set('walking', [a, b], [a, b])).resolves.toBeUndefined();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('guarda con vencimiento y traga los errores de Redis', async () => {
    const cache = setup();
    redis.set.mockRejectedValueOnce(new Error('caído'));
    await expect(cache.set('walking', [a, b], [a, b])).resolves.toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith(
      routeCacheKey('walking', [a, b]),
      JSON.stringify([a, b]),
      'EX',
      expect.any(Number),
    );
  });
});
