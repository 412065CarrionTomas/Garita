import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CheckpointUsagePort {
  findActiveRoundsUsing(checkpointId: string): Promise<{ id: string; name: string }[]>;
  /** Cuántas rondas activas usa cada punto del predio (los que no están en ninguna, no vienen). */
  countActiveRoundsBySite(siteId: string): Promise<Map<string, number>>;
}

export const CHECKPOINT_USAGE_PORT = Symbol('CHECKPOINT_USAGE_PORT');

/** Looks up active rounds through their current immutable version. */
@Injectable()
export class PrismaCheckpointUsageAdapter implements CheckpointUsagePort {
  constructor(private readonly prisma: PrismaService) {}
  findActiveRoundsUsing(checkpointId: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.tenantPrisma.round.findMany({
      where: { status: 'active', currentVersion: { checkpoints: { some: { checkpointId } } } },
      select: { id: true, name: true },
    });
  }
  async countActiveRoundsBySite(siteId: string): Promise<Map<string, number>> {
    const uses = await this.prisma.tenantPrisma.roundVersionCheckpoint.findMany({
      where: { checkpoint: { siteId }, roundVersion: { currentFor: { is: { status: 'active' } } } },
      select: { checkpointId: true },
    });
    const counts = new Map<string, number>();
    for (const { checkpointId } of uses)
      counts.set(checkpointId, (counts.get(checkpointId) ?? 0) + 1);
    return counts;
  }
}
