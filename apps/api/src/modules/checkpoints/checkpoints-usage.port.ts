import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CheckpointUsagePort {
  findActiveRoundsUsing(checkpointId: string): Promise<{ id: string; name: string }[]>;
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
}
