import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../auth/tenant-context';
import type { WeeklyScheduleDerivationPort } from '../users/weekly-schedule-derivation.port';
import type { WeeklyScheduleTerminationPort } from '../sites/deactivation-ports';
import { CLOCK, type Clock } from '../../common/clock';
import { Inject } from '@nestjs/common';

@Injectable()
export class ScheduleLifecycleService
  implements WeeklyScheduleDerivationPort, WeeklyScheduleTerminationPort
{
  private readonly logger = new Logger(ScheduleLifecycleService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async deriveForGuard(transaction: unknown, fromGuardId: string, toGuardId: string | null) {
    const tx = transaction as Prisma.TransactionClient;
    const schedules = await tx.shiftSchedule.findMany({
      where: { guardId: fromGuardId, status: 'active' },
      select: { id: true },
    });
    const ids = schedules.map((schedule) => schedule.id);
    const futureCount = await tx.shift.count({
      where: {
        scheduleId: { in: ids },
        startsAt: { gt: this.clock.now() },
        status: { in: ['scheduled', 'unassigned'] },
        startedAt: null,
      },
    });
    const affected = toGuardId
      ? await tx.shift.updateMany({
          where: {
            scheduleId: { in: ids },
            status: { in: ['scheduled', 'unassigned'] },
            startsAt: { gt: this.clock.now() },
            startedAt: null,
            assignments: { some: { guardId: toGuardId, isCurrent: true, active: true } },
          },
          data: { individuallyModified: true },
        })
      : { count: 0 };
    await tx.shiftSchedule.updateMany({
      where: { id: { in: ids } },
      data: toGuardId ? { guardId: toGuardId } : { status: 'finished' },
    });
    this.logger.log({
      action: 'schedule.guard_deactivated',
      userId: this.context.user?.userId,
      schedules: ids.length,
      affected: toGuardId ? affected.count : futureCount,
      derived: Boolean(toGuardId),
    });
  }

  countForSite(siteIds: string[]) {
    return this.prisma.tenantPrisma.shiftSchedule.count({
      where: { siteId: { in: siteIds }, status: 'active' },
    });
  }
  async terminateForSites(transaction: unknown, siteIds: string[]) {
    const tx = transaction as Prisma.TransactionClient;
    const shifts = await tx.shift.count({
      where: {
        siteId: { in: siteIds },
        scheduleId: { not: null },
        startsAt: { gt: this.clock.now() },
        status: 'cancelled',
        cancelledAt: this.clock.now(),
      },
    });
    const result = await tx.shiftSchedule.updateMany({
      where: { siteId: { in: siteIds }, status: 'active' },
      data: { status: 'finished' },
    });
    this.logger.log({
      action: 'schedule.sites_deactivated',
      userId: this.context.user?.userId,
      affected: result.count,
      shifts,
    });
  }
}
