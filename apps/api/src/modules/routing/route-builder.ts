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
  type SpeedProfile,
} from '@garita/shared';
import { ROUTING_PORT, type RoutingPort } from './routing.port';

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
    const legs = await Promise.all(
      pairs.map(([from, to], i) => {
        const leg = input.legs[i];
        if (!leg) throw new Error('Tramo faltante');
        return this.buildLeg(from, to, leg, profile);
      }),
    );
    return { v: 1, closed: input.closed, legs };
  }

  async buildLeg(
    from: LngLat,
    to: LngLat,
    leg: RouteLegInput,
    profile: SpeedProfile,
  ): Promise<RouteLeg> {
    const ends = sectionEndpoints(from, to, leg.waypoints);
    const sections = await Promise.all(
      leg.sections.map(async (section, i) => {
        const pair = ends[i];
        if (!pair) throw new Error('Sección sin extremos');
        const straight = polyline(pair[0], section.via, pair[1]);
        if (section.mode === 'manual') return { ...section, geometry: straight, fallback: false };
        const line = await this.routing.route(profile, straight);
        return line
          ? { ...section, geometry: line, fallback: false }
          : { ...section, geometry: straight, fallback: true };
      }),
    );
    return { from, to, waypoints: leg.waypoints, sections };
  }
}
