import { Inject, Injectable } from '@nestjs/common';
import {
  legEndpoints,
  polyline,
  sectionEndpoints,
  type LngLat,
  type RoundRoute,
  type RouteInput,
  type RouteLeg,
  type RouteLegInput,
  type RouteSectionInput,
  type SpeedProfile,
} from '@garita/shared';
import { ROUTING_PORT, type RoutingPort } from './routing.port';

interface LegDraft {
  from: LngLat;
  to: LngLat;
  leg: RouteLegInput;
}

/**
 * Arma el recorrido guardable. La geometría la calcula siempre la API: nunca se acepta la que
 * manda el navegador. Si el ruteo falla, la sección por calles queda recta con fallback.
 */
@Injectable()
export class RouteBuilder {
  constructor(@Inject(ROUTING_PORT) private readonly routing: RoutingPort) {}

  async build(input: RouteInput, points: LngLat[], profile: SpeedProfile): Promise<RoundRoute> {
    const pairs = legEndpoints(points, input.closed);
    if (pairs.length !== input.legs.length)
      throw new Error('La cantidad de tramos no coincide con los puntos');
    const drafts = pairs.map(([from, to], i) => {
      const leg = input.legs[i];
      if (!leg) throw new Error('Tramo faltante');
      return { from, to, leg };
    });
    return { v: 1, closed: input.closed, legs: await this.resolve(drafts, profile) };
  }

  async buildLeg(
    from: LngLat,
    to: LngLat,
    leg: RouteLegInput,
    profile: SpeedProfile,
  ): Promise<RouteLeg> {
    const [built] = await this.resolve([{ from, to, leg }], profile);
    if (!built) throw new Error('Tramo faltante');
    return built;
  }

  /** Todas las secciones por calles van en una sola llamada, en orden, para que se agrupen. */
  private async resolve(drafts: LegDraft[], profile: SpeedProfile): Promise<RouteLeg[]> {
    const legs = drafts.map(({ from, to, leg }) => {
      const ends = sectionEndpoints(from, to, leg.waypoints);
      const sections = leg.sections.map((section: RouteSectionInput, i) => {
        const pair = ends[i];
        if (!pair) throw new Error('Sección sin extremos');
        return { section, straight: polyline(pair[0], section.via, pair[1]) };
      });
      return { from, to, waypoints: leg.waypoints, sections };
    });
    const streets = legs
      .flatMap((leg) => leg.sections)
      .filter(({ section }) => section.mode === 'streets');
    const lines = await this.routing.route(
      profile,
      streets.map(({ straight }) => straight),
    );
    const routed = new Map(streets.map((draft, i) => [draft, lines[i] ?? null]));
    return legs.map(({ sections, ...leg }) => ({
      ...leg,
      sections: sections.map((draft) => {
        if (draft.section.mode === 'manual')
          return { ...draft.section, geometry: draft.straight, fallback: false };
        const line = routed.get(draft);
        return line
          ? { ...draft.section, geometry: line, fallback: false }
          : { ...draft.section, geometry: draft.straight, fallback: true };
      }),
    }));
  }
}
