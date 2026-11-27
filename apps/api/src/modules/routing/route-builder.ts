import { Inject, Injectable } from '@nestjs/common';
import {
  legEndpoints,
  polyline,
  sectionEndpoints,
  type LngLat,
  type RoundRoute,
  type RouteInput,
  type RouteFailure,
  type RouteLegInput,
  type RouteSectionInput,
  type SpeedProfile,
} from '@garita/shared';
import { ROUTING_PORT, type RoutingPort } from './routing.port';

/**
 * Arma el recorrido guardable. La geometría la calcula siempre la API: nunca se acepta la que
 * manda el navegador. Si el ruteo falla, la sección por calles queda recta con fallback y se
 * informa en `failures` (tramo, sección y motivo).
 */
@Injectable()
export class RouteBuilder {
  constructor(@Inject(ROUTING_PORT) private readonly routing: RoutingPort) {}

  async build(
    input: RouteInput,
    points: LngLat[],
    profile: SpeedProfile,
  ): Promise<{ route: RoundRoute; failures: RouteFailure[] }> {
    const pairs = legEndpoints(points, input.closed);
    if (pairs.length !== input.legs.length)
      throw new Error('La cantidad de tramos no coincide con los puntos');
    const legs = pairs.map(([from, to], l) => {
      const leg = input.legs[l];
      if (!leg) throw new Error('Tramo faltante');
      return this.draft(from, to, leg);
    });
    // Todas las secciones por calles van en una sola llamada, en orden, para que se agrupen.
    const streets = legs
      .flatMap((leg) => leg.sections)
      .filter(({ section }) => section.mode === 'streets');
    const results = await this.routing.route(
      profile,
      streets.map(({ straight }) => straight),
    );
    const routed = new Map(streets.map((draft, i) => [draft, results[i]]));
    const failures: RouteFailure[] = [];
    const route: RoundRoute = {
      v: 1,
      closed: input.closed,
      legs: legs.map(({ sections, ...leg }, l) => ({
        ...leg,
        sections: sections.map((draft, s) => {
          if (draft.section.mode === 'manual')
            return { ...draft.section, geometry: draft.straight, fallback: false };
          const result = routed.get(draft) ?? { failure: 'unavailable' as const };
          if ('line' in result) return { ...draft.section, geometry: result.line, fallback: false };
          failures.push({ leg: l, section: s, reason: result.failure });
          return { ...draft.section, geometry: draft.straight, fallback: true };
        }),
      })),
    };
    return { route, failures };
  }

  private draft(from: LngLat, to: LngLat, leg: RouteLegInput) {
    const ends = sectionEndpoints(from, to, leg.waypoints);
    const sections = leg.sections.map((section: RouteSectionInput, i) => {
      const pair = ends[i];
      if (!pair) throw new Error('Sección sin extremos');
      return { section, straight: polyline(pair[0], section.via, pair[1]) };
    });
    return { from, to, waypoints: leg.waypoints, sections };
  }
}
