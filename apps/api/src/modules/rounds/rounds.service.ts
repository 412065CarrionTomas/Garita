import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { previewWindows } from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';

interface RoundInput {
  name: string;
  checkpointIds: string[];
  frequencyMinutes: number;
  windowStartLocal: string;
  windowEndLocal: string;
  graceMinutes: number;
}

@Injectable()
export class RoundsService {
  private readonly logger = new Logger(RoundsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
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
    await this.assertCheckpoints(siteId, input.checkpointIds);
    try {
      const round = await this.prisma.tenantPrisma.round.create({
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
      const version = await this.prisma.tenantPrisma.roundVersion.findFirstOrThrow({
        where: { roundId: round.id, versionNumber: 1 },
      });
      const updated = await this.prisma.tenantPrisma.round.update({
        where: { id: round.id },
        data: { currentVersionId: version.id },
      });
      this.logger.log({ action: 'round.created', roundId: round.id, userId: user.userId });
      return updated;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async update(id: string, input: RoundInput, user: AuthenticatedUser) {
    const round = await this.resources.findOwnedOrThrow('Round', id);
    await this.assertCheckpoints(String(round.siteId), input.checkpointIds);
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

  private async assertCheckpoints(siteId: string, ids: string[]) {
    const checkpoints = await this.prisma.tenantPrisma.checkpoint.findMany({
      where: { id: { in: ids }, siteId, status: 'active' },
      select: { id: true },
    });
    if (checkpoints.length !== ids.length)
      throw new NotFoundException('Uno o más puntos no están activos en este predio');
  }

  private handleUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException('Ya existe una ronda con ese nombre en el predio');
    throw error;
  }
}
