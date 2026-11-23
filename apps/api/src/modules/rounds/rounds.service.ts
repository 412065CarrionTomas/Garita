import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  defaultRouteInput,
  distanceMeters,
  previewWindows,
  ROUTE_LIMITS,
  validateRouteInput,
  type LngLat,
  type RoundRoute,
  type RouteInput,
  type RoutePreviewInput,
  type RoutePreviewResponse,
} from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { RouteBuilder } from '../routing/route-builder';

interface RoundInput {
  name: string;
  checkpointIds: string[];
  frequencyMinutes: number;
  windowStartLocal: string;
  windowEndLocal: string;
  graceMinutes: number;
  route?: RouteInput;
}

@Injectable()
export class RoundsService {
  private readonly logger = new Logger(RoundsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    private readonly routes: RouteBuilder,
  ) {}

  async list(siteId: string) {
    await this.resources.findOwnedOrThrow('Site', siteId);
    return this.prisma.tenantPrisma.round.findMany({
      where: { siteId },
      include: {
        currentVersion: {
          include: { checkpoints: { orderBy: { position: 'asc' }, include: { checkpoint: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(siteId: string, input: RoundInput, user: AuthenticatedUser) {
    const site = await this.resources.findOwnedOrThrow('Site', siteId);
    if (site.status !== 'active') throw new NotFoundException('Recurso no encontrado');
    const points = await this.assertCheckpoints(siteId, input.checkpointIds);
    // Network call to the routing provider: never inside the transaction.
    const route = await this.buildRoute(siteId, input, points);
    try {
      // One transaction: a round left without currentVersion would block every shift using it.
      const { round, updated } = await this.prisma.tenantPrisma.$transaction(async (tx) => {
        const round = await tx.round.create({
          data: {
            companyId: user.companyId,
            siteId,
            name: input.name,
            versions: {
              create: {
                versionNumber: 1,
                frequencyMinutes: input.frequencyMinutes,
                windowStartLocal: input.windowStartLocal,
                windowEndLocal: input.windowEndLocal,
                graceMinutes: input.graceMinutes,
                route,
                createdById: user.userId,
                checkpoints: {
                  create: input.checkpointIds.map((checkpointId, position) => ({
                    companyId: user.companyId,
                    checkpointId,
                    position,
                  })),
                },
              },
            },
          },
        });
        const version = await tx.roundVersion.findFirstOrThrow({
          where: { roundId: round.id, versionNumber: 1 },
        });
        const updated = await tx.round.update({
          where: { id: round.id },
          data: { currentVersionId: version.id },
        });
        return { round, updated };
      });
      this.logger.log({
        action: 'round.created',
        roundId: round.id,
        userId: user.userId,
        fallbackSections: fallbackSections(route),
      });
      return updated;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async update(id: string, input: RoundInput, user: AuthenticatedUser) {
    const round = await this.resources.findOwnedOrThrow('Round', id);
    const siteId = String(round.siteId);
    const points = await this.assertCheckpoints(siteId, input.checkpointIds);
    const route = await this.buildRoute(siteId, input, points);
    try {
      return await this.prisma.tenantPrisma.$transaction(async (tx) => {
        const latest = await tx.roundVersion.findFirstOrThrow({
          where: { roundId: id },
          orderBy: { versionNumber: 'desc' },
        });
        const version = await tx.roundVersion.create({
          data: {
            roundId: id,
            versionNumber: latest.versionNumber + 1,
            frequencyMinutes: input.frequencyMinutes,
            windowStartLocal: input.windowStartLocal,
            windowEndLocal: input.windowEndLocal,
            graceMinutes: input.graceMinutes,
            route,
            createdById: user.userId,
            checkpoints: {
              create: input.checkpointIds.map((checkpointId, position) => ({
                companyId: user.companyId,
                checkpointId,
                position,
              })),
            },
          },
        });
        const updated = await tx.round.update({
          where: { id },
          data: { name: input.name, currentVersionId: version.id },
        });
        this.logger.log({
          action: 'round.updated',
          roundId: id,
          versionId: version.id,
          userId: user.userId,
          fallbackSections: fallbackSections(route),
        });
        return updated;
      });
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async deactivate(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Round', id);
    const result = await this.prisma.tenantPrisma.round.update({
      where: { id },
      data: { status: 'inactive' },
    });
    this.logger.log({ action: 'round.deactivated', roundId: id, userId: user.userId });
    return result;
  }

  preview(input: Omit<RoundInput, 'name' | 'checkpointIds'>) {
    return { windows: previewWindows(input) };
  }

  /** Checks the points and returns their location in the round's order. */
  /** Un tramo del editor con su geometría calculada. No guarda nada. */
  async previewRoute(input: RoutePreviewInput): Promise<RoutePreviewResponse> {
    await this.resources.findOwnedOrThrow('Site', input.siteId);
    const site = await this.siteRouting(input.siteId);
    const coordinates = [
      input.from,
      input.to,
      ...input.waypoints,
      ...input.sections.flatMap((section) => section.via),
    ];
    // Sin este control, la vista previa serviría para rutear cualquier lugar con nuestra clave.
    if (coordinates.some((c) => distanceMeters(c, site.location) > ROUTE_LIMITS.maxMetersFromSite))
      throw new BadRequestException('El recorrido no puede alejarse más de 25 km del predio.');
    const leg = await this.routes.buildLeg(input.from, input.to, input, site.profile);
    return { sections: leg.sections };
  }

  private async assertCheckpoints(siteId: string, ids: string[]): Promise<LngLat[]> {
    const checkpoints = await this.prisma.tenantPrisma.checkpoint.findMany({
      where: { id: { in: ids }, siteId, status: 'active' },
      select: { id: true, latitude: true, longitude: true },
    });
    const byId = new Map(
      checkpoints.map((c) => [c.id, [Number(c.longitude), Number(c.latitude)] as LngLat]),
    );
    const points: LngLat[] = [];
    for (const id of ids) {
      const point = byId.get(id);
      if (!point) throw new NotFoundException('Uno o más puntos no están activos en este predio');
      points.push(point);
    }
    return points;
  }

  private async siteRouting(siteId: string) {
    const site = await this.prisma.tenantPrisma.site.findFirstOrThrow({
      where: { id: siteId },
      select: { latitude: true, longitude: true, maxSpeedProfile: true },
    });
    const location: LngLat = [Number(site.longitude), Number(site.latitude)];
    return { location, profile: site.maxSpeedProfile };
  }

  private async buildRoute(siteId: string, input: RoundInput, points: LngLat[]) {
    const site = await this.siteRouting(siteId);
    const route = input.route ?? defaultRouteInput(points.length);
    const issues = validateRouteInput(route, points, site.location);
    if (issues.length > 0)
      throw new BadRequestException(
        issues.map((issue) => ({ ...issue, path: ['route', ...issue.path] })),
      );
    return this.routes.build(route, points, site.profile);
  }

  private handleUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException('Ya existe una ronda con ese nombre en el predio');
    throw error;
  }
}

function fallbackSections(route: RoundRoute): number {
  return route.legs.flatMap((leg) => leg.sections).filter((section) => section.fallback).length;
}
