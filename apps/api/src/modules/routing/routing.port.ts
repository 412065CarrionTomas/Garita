import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ROUTE_LIMITS, type LngLat, type SpeedProfile } from '@garita/shared';
import { z } from 'zod';
import type { Env } from '../../config/env';
import type { RouteCache } from './route-cache';

export const ROUTING_PORT = Symbol('ROUTING_PORT');

export interface RoutingPort {
  /** Línea por calles que pasa por las coordenadas en orden, o null si no se pudo calcular. */
  route(profile: SpeedProfile, coordinates: LngLat[]): Promise<LngLat[] | null>;
}

/** Sin clave de openrouteservice: todo queda recto (fallback). Tests y CI nunca llaman al real. */
export class NullRouting implements RoutingPort {
  route(): Promise<LngLat[] | null> {
    return Promise.resolve(null);
  }
}

const ORS_PROFILES: Record<SpeedProfile, string> = {
  walking: 'foot-walking',
  bicycle: 'cycling-regular',
  vehicle: 'driving-car',
  custom: 'driving-car',
};

export const ORS_TIMEOUT_MS = 5000;

// shortcut: una línea de más de 5000 coordenadas se rechaza y queda recta; si pasa seguido, simplificarla.
const orsResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal('LineString'),
          coordinates: z
            .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
            .min(2)
            .max(ROUTE_LIMITS.geometryPerSection),
        }),
      }),
    )
    .min(1),
});

/** openrouteservice: POST /v2/directions/{perfil}/geojson. Límite: 2000 pedidos/día, 40/minuto. */
export class OpenRouteServiceRouting implements RoutingPort {
  private readonly logger = new Logger(OpenRouteServiceRouting.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly cache: Pick<RouteCache, 'get' | 'set'>,
  ) {}

  async route(profile: SpeedProfile, coordinates: LngLat[]): Promise<LngLat[] | null> {
    const cached = await this.cache.get(profile, coordinates);
    if (cached) return cached;
    const line = await this.request(ORS_PROFILES[profile], coordinates);
    if (line) await this.cache.set(profile, coordinates, line);
    return line;
  }

  private async request(profile: string, coordinates: LngLat[]): Promise<LngLat[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, ORS_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/v2/directions/${profile}/geojson`, {
        method: 'POST',
        headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates }),
        signal: controller.signal,
      });
      if (!response.ok) {
        // Sin coordenadas en el log: la ubicación de los puntos es sensible (AGENTS.md §9).
        this.logger.warn({ event: 'routing.ors_http_error', status: response.status, profile });
        return null;
      }
      const parsed = orsResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        this.logger.warn({ event: 'routing.ors_invalid_response', profile });
        return null;
      }
      const [feature] = parsed.data.features;
      return feature ? feature.geometry.coordinates : null;
    } catch (error) {
      const event = controller.signal.aborted ? 'routing.ors_timeout' : 'routing.ors_failed';
      this.logger.warn({ event, profile, error: error instanceof Error ? error.name : 'unknown' });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function routingProvider(config: ConfigService<Env, true>, cache: RouteCache): RoutingPort {
  const apiKey = config.get('ORS_API_KEY', { infer: true });
  if (!apiKey) return new NullRouting();
  return new OpenRouteServiceRouting(apiKey, config.get('ORS_URL', { infer: true }), cache);
}
