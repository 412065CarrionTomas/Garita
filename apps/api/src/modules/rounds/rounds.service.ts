import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  defaultRouteInput,
  roundRouteSchema,
  type GuardRoundVersion,
  previewWindows,
  validateRouteInput,
  type LngLat,
  type RoundRoute,
  type RouteInput,
  type RoundRoutePreviewInput,
  type RoundRoutePreviewResponse,
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
  allowStraight?: boolean;
}

@Injectable()
export class RoundsService {
  private readonly logger = new Logger(RoundsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    private readonly routes: RouteBuilder,
  ) {}

  /**
   * Versiones de ronda para el vigilador: las de sus turnos (la fijada al iniciar o la vigente de
   * una ronda programada) y la vigente de las rondas activas de los predios donde tiene turnos,
   * que son las que ve en Predios. Pedir otra devuelve menos elementos, nunca un error.
   * Con la cuenta suspendida, solo las fijadas en los turnos que siguen visibles.
   */
  async versionsForGuard(ids: string[], user: AuthenticatedUser): Promise<GuardRoundVersion[]> {
    const own = { some: { guardId: user.userId, isCurrent: true } };
    const where: Prisma.RoundVersionWhereInput = user.suspension
      ? { id: { in: ids }, shifts: { some: { shiftId: { in: user.suspension.shiftIds } } } }
      : {
          id: { in: ids },
          OR: [
            { shifts: { some: { shift: { assignments: own } } } },
            { currentFor: { shifts: { some: { shift: { assignments: own } } } } },
            {
              currentFor: {
                status: 'active',
                site: { status: 'active', shifts: { some: { assignments: own } } },
              },
            },
          ],
        };
    const versions = await this.prisma.tenantPrisma.roundVersion.findMany({
      where,
      select: {
        id: true,
        frequencyMinutes: true,
        windowStartLocal: true,
        windowEndLocal: true,
        route: true,
        round: { select: { id: true, name: true } },
        checkpoints: {
          orderBy: { position: 'asc' },
          select: {
            checkpoint: {
              select: { id: true, name: true, latitude: true, longitude: true, isIndoor: true },
            },
          },
        },
      },
    });
    return versions.map(({ round, checkpoints, route, ...version }) => ({
      ...version,
      roundId: round.id,
      name: round.name,
      checkpoints: checkpoints.map(({ checkpoint: c }) => ({
        ...c,
        latitude: c.latitude.toNumber(),
        longitude: c.longitude.toNumber(),
      })),
      // Rondas previas o recorridos inválidos se dibujan rectos.
      route: roundRouteSchema.safeParse(route).data ?? null,
    }));
  }

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

  /** "Calcular recorrido": la ronda completa con sus fallas, sin guardar nada. */
  async previewRoute(input: RoundRoutePreviewInput): Promise<RoundRoutePreviewResponse> {
    await this.resources.findOwnedOrThrow('Site', input.siteId);
    const points = await this.assertCheckpoints(input.siteId, input.checkpointIds);
    return this.computeRoute(input.siteId, input.route, points);
  }

  /** Checks the points and returns their location in the round's order. */
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

  /**
   * Recorrido a guardar. Si el supervisor lo armó y alguna sección no se pudo calcular, no se
   * guarda nada hasta que acepte dejarlas rectas (allowStraight). Sin recorrido (panel anterior
   * o backfill) no hay a quién preguntarle: se guarda recto.
   */
  private async buildRoute(siteId: string, input: RoundInput, points: LngLat[]) {
    const { route, failures } = await this.computeRoute(
      siteId,
      input.route ?? defaultRouteInput(points.length),
      points,
    );
    if (input.route && failures.length > 0 && !input.allowStraight)
      throw new UnprocessableEntityException({
        message: 'No se pudo calcular el recorrido por calles en algunos tramos.',
        failures,
      });
    return route;
  }

  private async computeRoute(siteId: string, input: RouteInput, points: LngLat[]) {
    const site = await this.siteRouting(siteId);
    const issues = validateRouteInput(input, points, site.location);
    if (issues.length > 0)
      throw new BadRequestException(
        issues.map((issue) => ({ ...issue, path: ['route', ...issue.path] })),
      );
    return this.routes.build(input, points, site.profile);
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
