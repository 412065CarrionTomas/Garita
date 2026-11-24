import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  chainSections,
  ROUTE_LIMITS,
  type LngLat,
  type RouteFailureReason,
  type SpeedProfile,
} from '@garita/shared';
import { z } from 'zod';
import type { Env } from '../../config/env';
import type { RouteCache } from './route-cache';

export const ROUTING_PORT = Symbol('ROUTING_PORT');

/** Resultado de una sección: la línea por calles o el motivo por el que no se pudo calcular. */
export type SectionRouting = { line: LngLat[] } | { failure: RouteFailureReason };

export interface RoutingPort {
  /** Un resultado por sección (`[inicio, ...via, fin]`), en el mismo orden. */
  route(profile: SpeedProfile, sections: LngLat[][]): Promise<SectionRouting[]>;
}

/** Sin clave de openrouteservice: nada se calcula. Tests y CI nunca llaman al servicio real. */
export class NullRouting implements RoutingPort {
  route(_profile: SpeedProfile, sections: LngLat[][]): Promise<SectionRouting[]> {
    return Promise.resolve(sections.map(() => ({ failure: 'not_configured' as const })));
  }
}

const ORS_PROFILES: Record<SpeedProfile, string> = {
  walking: 'foot-walking',
  bicycle: 'cycling-regular',
  vehicle: 'driving-car',
  custom: 'driving-car',
};

export const ORS_TIMEOUT_MS = 5000;
/** Puntos por pedido que acepta el plan hospedado de openrouteservice. */
export const ORS_MAX_COORDINATES = ROUTE_LIMITS.requestCoordinates;

const orsResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal('LineString'),
          coordinates: z
            .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
            .min(2),
        }),
        // Posición en la línea de cada punto enviado: con esto se corta por sección.
        properties: z.object({ way_points: z.array(z.number().int().min(0)) }),
      }),
    )
    .min(1),
});

const orsErrorSchema = z.object({
  error: z.object({ code: z.number().int(), message: z.string().optional() }),
});

/** Errores de openrouteservice que señalan un punto del pedido (índice desde 0). */
const ORS_POINT_ERRORS: Record<number, { reason: RouteFailureReason; pattern: RegExp }> = {
  // "Could not find routable point within a radius of … of specified coordinate 3: …"
  2010: { reason: 'unreachable_point', pattern: /coordinate (\d+)/ },
  // "Route could not be found - Unable to find a route between points 2 (…) and 3 (…)."
  2009: { reason: 'no_route', pattern: /points (\d+)/ },
};

type RequestResult =
  { line: LngLat[]; wayPoints: number[] } | { failure: RouteFailureReason; coordinate?: number };

/** openrouteservice: POST /v2/directions/{perfil}/geojson. Límite: 2000 pedidos/día, 40/minuto. */
export class OpenRouteServiceRouting implements RoutingPort {
  private readonly logger = new Logger(OpenRouteServiceRouting.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly cache: Pick<RouteCache, 'get' | 'set'>,
  ) {}

  async route(profile: SpeedProfile, sections: LngLat[][]): Promise<SectionRouting[]> {
    const cached = await Promise.all(sections.map((section) => this.cache.get(profile, section)));
    const results: SectionRouting[] = cached.map((line) =>
      line ? { line } : { failure: 'unavailable' },
    );
    const chains = chainSections(
      sections,
      cached.map((line) => line !== null),
    );
    // De a un pedido: en paralelo, una ronda con muchas cadenas choca con el límite por minuto.
    for (const chain of chains) {
      const group = chain.map((i) => sections[i] ?? []);
      const computed = await this.requestChain(ORS_PROFILES[profile], group);
      await Promise.all(
        chain.map(async (sectionIndex, k) => {
          const result = computed[k] ?? { failure: 'unavailable' };
          const section = sections[sectionIndex];
          results[sectionIndex] = result;
          if ('line' in result && section) await this.cache.set(profile, section, result.line);
        }),
      );
    }
    return results;
  }

  /** Un solo pedido para varias secciones encadenadas; la línea se corta con `way_points`. */
  private async requestChain(profile: string, sections: LngLat[][]): Promise<SectionRouting[]> {
    const coordinates = sections.flatMap((section, i) => (i === 0 ? section : section.slice(1)));
    // Índice del primer punto de cada sección dentro del pedido.
    const starts: number[] = [];
    sections.reduce((start, section) => {
      starts.push(start);
      return start + section.length - 1;
    }, 0);
    const routed = await this.request(profile, coordinates);
    if ('failure' in routed) {
      const { failure, coordinate } = routed;
      if (coordinate === undefined) return sections.map(() => ({ failure }));
      // La sección del punto señalado carga el motivo; las demás del pedido quedaron sin calcular.
      const culprit = Math.max(
        0,
        starts.findLastIndex((start) => start <= coordinate),
      );
      return sections.map((_, k) => ({ failure: k === culprit ? failure : 'skipped' }));
    }
    const { line, wayPoints } = routed;
    if (wayPoints.length !== coordinates.length) {
      this.logger.warn({ event: 'routing.ors_way_points_mismatch', profile });
      return sections.map(() => ({ failure: 'unavailable' }));
    }
    return sections.map((section, k) => {
      const start = starts[k] ?? 0;
      const from = wayPoints[start];
      const to = wayPoints[start + section.length - 1];
      // Índices fuera de la línea o al revés: respuesta inválida, no se guarda como recta buena.
      if (from === undefined || to === undefined || from > to || to >= line.length)
        return { failure: 'unavailable' };
      // Dos puntos fuera de la calle que caen en el mismo lugar de ella: el camino es la recta.
      if (from === to) return { line: section };
      const slice = line.slice(from, to + 1);
      // shortcut: una sección de más de 5000 coordenadas queda sin calcular; si pasa, simplificarla.
      if (slice.length > ROUTE_LIMITS.geometryPerSection) return { failure: 'unavailable' };
      return { line: slice };
    });
  }

  private async request(profile: string, coordinates: LngLat[]): Promise<RequestResult> {
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
      if (!response.ok) return await this.failure(response, profile);
      const parsed = orsResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        this.logger.warn({ event: 'routing.ors_invalid_response', profile });
        return { failure: 'unavailable' };
      }
      const [feature] = parsed.data.features;
      return feature
        ? { line: feature.geometry.coordinates, wayPoints: feature.properties.way_points }
        : { failure: 'unavailable' };
    } catch (error) {
      const event = controller.signal.aborted ? 'routing.ors_timeout' : 'routing.ors_failed';
      this.logger.warn({ event, profile, error: error instanceof Error ? error.name : 'unknown' });
      return { failure: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  private async failure(response: Response, profile: string): Promise<RequestResult> {
    const body = orsErrorSchema.safeParse(await response.json().catch(() => null));
    const code = body.success ? body.data.error.code : undefined;
    // Sin el mensaje ni coordenadas en el log: la ubicación de los puntos es sensible (AGENTS.md §9).
    this.logger.warn({ event: 'routing.ors_http_error', status: response.status, code, profile });
    // 429: límite por minuto. 403: límite diario (o clave inválida).
    if (response.status === 429 || response.status === 403) return { failure: 'rate_limited' };
    const known = code === undefined ? undefined : ORS_POINT_ERRORS[code];
    if (!known || !body.success) return { failure: 'unavailable' };
    const match = known.pattern.exec(body.data.error.message ?? '');
    return { failure: known.reason, coordinate: match ? Number(match[1]) : undefined };
  }
}

export function routingProvider(config: ConfigService<Env, true>, cache: RouteCache): RoutingPort {
  const apiKey = config.get('ORS_API_KEY', { infer: true });
  if (!apiKey) return new NullRouting();
  return new OpenRouteServiceRouting(apiKey, config.get('ORS_URL', { infer: true }), cache);
}
