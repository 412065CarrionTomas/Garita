import { Injectable, Logger } from '@nestjs/common';
import {
  computeStartWindow,
  computeSyncDeadline,
  siteConnectivitySchema,
  type SiteConnectivity,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';

@Injectable()
export class SiteConnectivityService {
  private readonly logger = new Logger(SiteConnectivityService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
  ) {}

  async get(id: string): Promise<SiteConnectivity> {
    const site = await this.resources.findOwnedOrThrow('Site', id);
    return siteConnectivitySchema.parse({
      type: site.connectivityType,
      minutesToSignal: site.minutesToSignal,
      marginMinutes: site.marginMinutes,
    });
  }

  async update(id: string, conn: SiteConnectivity, actorId: string) {
    await this.resources.findOwnedOrThrow('Site', id);
    await this.prisma.tenantPrisma.site.update({
      where: { id },
      data: {
        connectivityType: conn.type,
        minutesToSignal: conn.minutesToSignal,
        marginMinutes: conn.marginMinutes,
      },
    });
    this.logger.log({ event: 'site.connectivity_updated', siteId: id, actorId, ...conn });
    return conn;
  }

  async simulate(id: string, startsAt: Date, endsAt: Date) {
    const conn = await this.get(id);
    return {
      startFrom: computeStartWindow(startsAt, conn).toISOString(),
      syncDeadline: computeSyncDeadline(endsAt, conn).toISOString(),
    };
  }
}
