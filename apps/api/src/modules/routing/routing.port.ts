import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ROUTE_LIMITS, type LngLat, type SpeedProfile } from '@garita/shared';
import { z } from 'zod';
import type { Env } from '../../config/env';
import type { RouteCache } from './route-cache';

export const ROUTING_PORT = Symbol('ROUTING_PORT');

export interface RoutingPort {
  /**
   * Una línea por calles por cada sección (`[inicio, ...via, fin]`), en el mismo orden, o null en
   * las que no se pudo calcular.
   */
  route(profile: SpeedProfile, sections: LngLat[][]): Promise<(LngLat[] | null)[]>;
}

/** Sin clave de openrouteservice: todo queda recto (fallback). Tests y CI nunca llaman al real. */
export class NullRouting implements RoutingPort {
  route(_profile: SpeedProfile, sections: LngLat[][]): Promise<(LngLat[] | null)[]> {
    return Promise.resolve(sections.map(() => null));
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
export const ORS_MAX_COORDINATES = 50;

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

const samePoint = (a: LngLat | undefined, b: LngLat | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Puntos que ocupa un grupo de secciones encadenadas: cada una comparte su inicio con el fin anterior. */
const chainLength = (sections: LngLat[][]) =>
  sections.reduce((total, section, i) => total + section.length - (i === 0 ? 0 : 1), 0);

/**
 * Agrupa en cadenas las secciones sin caché que siguen una a la otra (el fin de una es el inicio
 * de la siguiente), hasta el tope de puntos por pedido. Devuelve índices de sección.
 */
export function chainSections(sections: LngLat[][], resolved: boolean[]): number[][] {
  const chains: number[][] = [];
  let current: number[] = [];
  sections.forEach((section, i) => {
    if (resolved[i]) {
      if (current.length) chains.push(current);
      current = [];
      return;
    }
    const previous = current.at(-1);
    const fits =
      previous !== undefined &&
      samePoint(sections[previous]?.at(-1), section[0]) &&
      chainLength([...current.map((j) => sections[j] ?? []), section]) <= ORS_MAX_COORDINATES;
    if (!fits && current.length) {
      chains.push(current);
      current = [];
    }
    current.push(i);
  });
  if (current.length) chains.push(current);
  return chains;
}

/** openrouteservice: POST /v2/directions/{perfil}/geojson. Límite: 2000 pedidos/día, 40/minuto. */
export class OpenRouteServiceRouting implements RoutingPort {
  private readonly logger = new Logger(OpenRouteServiceRouting.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly cache: Pick<RouteCache, 'get' | 'set'>,
  ) {}

  async route(profile: SpeedProfile, sections: LngLat[][]): Promise<(LngLat[] | null)[]> {
    const lines = await Promise.all(sections.map((section) => this.cache.get(profile, section)));
    const chains = chainSections(
      sections,
      lines.map((line) => line !== null),
    );
    await Promise.all(
      chains.map(async (chain) => {
        const group = chain.map((i) => sections[i] ?? []);
        const computed = await this.requestChain(ORS_PROFILES[profile], group);
        await Promise.all(
          chain.map(async (sectionIndex, k) => {
            const line = computed[k] ?? null;
            const section = sections[sectionIndex];
            lines[sectionIndex] = line;
            if (line && section) await this.cache.set(profile, section, line);
          }),
        );
      }),
    );
    return lines;
  }

  /** Un solo pedido para varias secciones encadenadas; la línea se corta con `way_points`. */
  private async requestChain(profile: string, sections: LngLat[][]): Promise<(LngLat[] | null)[]> {
    const none = sections.map(() => null);
    // Una sección sola con demasiados quiebres excede el tope del servicio: queda recta sin pedir.
    if (chainLength(sections) > ORS_MAX_COORDINATES) return none;
    const coordinates = sections.flatMap((section, i) => (i === 0 ? section : section.slice(1)));
    const routed = await this.request(profile, coordinates);
    if (!routed) return none;
    const { line, wayPoints } = routed;
    if (wayPoints.length !== coordinates.length) {
      this.logger.warn({ event: 'routing.ors_way_points_mismatch', profile });
      return none;
    }
    let start = 0;
    return sections.map((section) => {
      const end = start + section.length - 1;
      const from = wayPoints[start];
      const to = wayPoints[end];
      start = end;
      if (from === undefined || to === undefined) return null;
      const slice = line.slice(from, to + 1);
      // shortcut: una sección de más de 5000 coordenadas queda recta; si pasa seguido, simplificarla.
      if (slice.length < 2 || slice.length > ROUTE_LIMITS.geometryPerSection) return null;
      return slice;
    });
  }

  private async request(
    profile: string,
    coordinates: LngLat[],
  ): Promise<{ line: LngLat[]; wayPoints: number[] } | null> {
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
      return feature
        ? { line: feature.geometry.coordinates, wayPoints: feature.properties.way_points }
        : null;
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
