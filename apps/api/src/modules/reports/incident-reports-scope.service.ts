import { Inject, Injectable, Logger } from '@nestjs/common';
import { defaultReportPeriod, localDateTimeToUtc, type ReportQuery } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CLOCK, type Clock } from '../../common/clock';

@Injectable()
export class ReportScopeService {
  private readonly logger = new Logger('ReportsService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
  private async scope(input: ReportQuery, user: AuthenticatedUser) {
    if (input.predio) await this.resources.findOwnedOrThrow('Site', input.predio);
    if (input.cliente) await this.resources.findOwnedOrThrow('Client', input.cliente);
    if (input.vigilador && input.vigilador !== 'unassigned')
      await this.resources.findOwnedOrThrow('User', input.vigilador);
    const db = this.prisma.tenantPrisma;
    const [company, sites] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { timezone: true } }),
      db.site.findMany({
        select: {
          id: true,
          name: true,
          clientId: true,
          client: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    const period =
      input.desde && input.hasta
        ? { desde: input.desde, hasta: input.hasta }
        : defaultReportPeriod(this.clock.now(), company.timezone);
    const siteIds = sites
      .filter(
        (site) =>
          (!input.predio || site.id === input.predio) &&
          (!input.cliente || site.clientId === input.cliente),
      )
      .map((site) => site.id);
    // Período anterior de igual cantidad de días, para comparar.
    const days = Math.round(
      (Date.parse(`${period.hasta}T00:00:00Z`) - Date.parse(`${period.desde}T00:00:00Z`)) /
        86_400_000,
    );
    const start = new Date(`${period.desde}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days);
    const previous = { desde: start.toISOString().slice(0, 10), hasta: period.desde };
    return {
      ...period,
      timezone: company.timezone,
      sites,
      siteIds,
      dateRange: {
        gte: localDateTimeToUtc(period.desde, 0, company.timezone),
        lt: localDateTimeToUtc(period.hasta, 0, company.timezone),
      },
      previous: {
        ...previous,
        dateRange: {
          gte: localDateTimeToUtc(previous.desde, 0, company.timezone),
          lt: localDateTimeToUtc(previous.hasta, 0, company.timezone),
        },
      },
    };
  }

  async measured<T>(
    kind: string,
    input: ReportQuery,
    user: AuthenticatedUser,
    run: (scope: Awaited<ReturnType<ReportScopeService['scope']>>) => Promise<T>,
  ) {
    const started = performance.now();
    let scope: Awaited<ReturnType<ReportScopeService['scope']>> | undefined;
    try {
      scope = await this.scope(input, user);
      return await run(scope);
    } finally {
      const elapsedMs = performance.now() - started;
      this.logger[elapsedMs > 10_000 ? 'warn' : 'log']({
        event: 'reports.query',
        kind,
        userId: user.userId,
        role: user.role,
        siteIds: scope?.siteIds ?? [],
        desde: scope?.desde ?? input.desde,
        hasta: scope?.hasta ?? input.hasta,
        elapsedMs,
      });
    }
  }
}

export type ReportScope = Parameters<Parameters<ReportScopeService['measured']>[3]>[0];
