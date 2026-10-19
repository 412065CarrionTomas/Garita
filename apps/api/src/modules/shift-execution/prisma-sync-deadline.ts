import { Injectable, NotFoundException } from '@nestjs/common';
import { computeSyncDeadline, siteConnectivitySchema } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { SyncDeadlinePort } from './shift-execution.service';

@Injectable()
export class PrismaSyncDeadline implements SyncDeadlinePort {
  constructor(private readonly prisma: PrismaService) {}

  async deadlineForSite(siteId: string, endsAt: Date): Promise<Date> {
    const site = await this.prisma.tenantPrisma.site.findFirst({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Predio no encontrado');
    return computeSyncDeadline(
      endsAt,
      siteConnectivitySchema.parse({ type: site.connectivityType, ...site }),
    );
  }

  async deadlineForShift(id: string): Promise<Date> {
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: { id },
      include: { site: true },
    });
    if (!shift) throw new NotFoundException('Turno no encontrado');
    if (shift.syncDeadlineAt) return shift.syncDeadlineAt;
    // Legacy started shifts retain HU-10's signal defaults instead of adopting later site changes.
    const conn = shift.startedAt
      ? {
          type: shift.connectivityType ?? 'with_signal',
          minutesToSignal: shift.minutesToSignal ?? 0,
          marginMinutes: shift.marginMinutes ?? 30,
        }
      : { type: shift.site.connectivityType, ...shift.site };
    return computeSyncDeadline(shift.endsAt, siteConnectivitySchema.parse(conn));
  }
}
