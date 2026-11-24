import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROUTE_LIMITS, type LngLat, type SpeedProfile } from '@garita/shared';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../../config/env';

const TTL_SECONDS = 30 * 24 * 60 * 60;
const lineSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(2)
  .max(ROUTE_LIMITS.geometryPerSection);

/** Caché de rutas calculadas. Si Redis falla se sigue sin caché: nunca rompe el guardado. */
@Injectable()
export class RouteCache implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RouteCache.name);
  private connecting?: Promise<void>;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Con Redis caído se sigue sin caché enseguida, sin esperar reconexiones.
      enableOfflineQueue: false,
      connectTimeout: 1000,
    });
    this.client.on('error', () => {
      this.logger.warn({ event: 'routing.cache_redis_failed' });
    });
  }

  /** Conecta una sola vez (los pedidos simultáneos esperan la misma conexión) y dice si se puede usar. */
  private async ready(): Promise<boolean> {
    if (this.client.status === 'wait')
      this.connecting ??= this.client.connect().catch(() => undefined);
    await this.connecting;
    return this.client.status === 'ready';
  }

  async get(profile: SpeedProfile, coordinates: LngLat[]): Promise<LngLat[] | null> {
    try {
      if (!(await this.ready())) return null;
      const raw = await this.client.get(routeCacheKey(profile, coordinates));
      if (!raw) return null;
      const parsed = lineSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async set(profile: SpeedProfile, coordinates: LngLat[], line: LngLat[]): Promise<void> {
    try {
      if (!(await this.ready())) return;
      await this.client.set(
        routeCacheKey(profile, coordinates),
        JSON.stringify(line),
        'EX',
        TTL_SECONDS,
      );
    } catch {
      // Sin caché se vuelve a pedir la próxima vez; no es un error para quien guarda.
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}

/** Hash del perfil y las coordenadas a 6 decimales: no guarda ubicaciones legibles como clave. */
export function routeCacheKey(profile: SpeedProfile, coordinates: LngLat[]): string {
  const rounded = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  return `routing:v1:${createHash('sha256').update(`${profile}|${rounded}`).digest('hex')}`;
}
