import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  complianceOwner,
  computeCompliance,
  defaultReportPeriod,
  localDateTimeToUtc,
  localReportDay,
  type ComplianceWindow,
  type ReportDetailQuery,
  type ReportQuery,
} from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CLOCK, type Clock } from '../../common/clock';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
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
    return {
      ...period,
      timezone: company.timezone,
      sites,
      siteIds,
      dateRange: {
        gte: localDateTimeToUtc(period.desde, 0, company.timezone),
        lt: localDateTimeToUtc(period.hasta, 0, company.timezone),
      },
    };
  }

  private async measured<T>(
    kind: string,
    input: ReportQuery,
    user: AuthenticatedUser,
    run: (scope: Awaited<ReturnType<ReportsService['scope']>>) => Promise<T>,
  ) {
    const started = performance.now();
    let scope: Awaited<ReturnType<ReportsService['scope']>> | undefined;
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

  private async windows(scope: Awaited<ReturnType<ReportsService['scope']>>) {
    const rows = await this.prisma.tenantPrisma.roundWindowState.findMany({
      where: {
        startsAt: scope.dateRange,
        shift: { siteId: { in: scope.siteIds }, status: { not: 'cancelled' } },
      },
      select: {
        id: true,
        shiftId: true,
        status: true,
        severityLevel: true,
        startsAt: true,
        endsAt: true,
        round: { select: { name: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    // Cargar la historia una vez por turno evita repetirla en cada ventana del mes.
    const shifts = await this.prisma.tenantPrisma.shift.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.shiftId))] } },
      select: {
        id: true,
        status: true,
        site: { select: { id: true, name: true } },
        assignments: {
          select: {
            id: true,
            startsAt: true,
            result: true,
            guard: { select: { id: true, firstName: true, lastName: true, status: true } },
          },
        },
      },
    });
    const byShift = new Map(
      shifts.map((shift) => [
        shift.id,
        {
          ...shift,
          assignments: shift.assignments.map((assignment) => ({
            id: assignment.id,
            startsAt: assignment.startsAt.toISOString(),
            result: assignment.result,
            guard: assignment.guard
              ? {
                  id: assignment.guard.id,
                  name: `${assignment.guard.firstName} ${assignment.guard.lastName}`,
                  status: assignment.guard.status,
                }
              : null,
          })),
        },
      ]),
    );
    return rows.map((row) => {
      const shift = byShift.get(row.shiftId);
      if (!shift) throw new NotFoundException('Turno no encontrado');
      return {
        id: row.id,
        shiftId: row.shiftId,
        roundName: row.round.name,
        status: row.status,
        severityLevel: row.severityLevel,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        shiftStatus: shift.status,
        site: shift.site,
        assignments: shift.assignments,
      };
    });
  }

  private matchesGuard(window: ComplianceWindow, guardId?: string) {
    if (!guardId) return true;
    return (complianceOwner(window)?.id ?? 'unassigned') === guardId;
  }

  report(input: ReportQuery, user: AuthenticatedUser) {
    return this.measured('rounds', input, user, async (scope) => {
      const windows = await this.windows(scope);
      const guards = new Map(
        windows.flatMap((window) =>
          window.assignments.flatMap((assignment) =>
            assignment.guard
              ? [
                  [
                    assignment.guard.id,
                    {
                      id: assignment.guard.id,
                      name: `${assignment.guard.name}${assignment.guard.status !== 'active' ? ' (desactivado)' : ''}`,
                    },
                  ] as const,
                ]
              : [],
          ),
        ),
      );
      return {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        ...computeCompliance(
          windows.filter((window) => this.matchesGuard(window, input.vigilador)),
          scope.timezone,
          scope,
        ),
        filters: {
          sites: scope.sites.map(({ id, name }) => ({ id, name })),
          clients: [...new Map(scope.sites.map((site) => [site.client.id, site.client])).values()],
          guards: [...guards.values()].sort((a, b) => a.name.localeCompare(b.name)),
        },
      };
    });
  }

  detail(input: ReportDetailQuery, user: AuthenticatedUser) {
    return this.measured('detail', input, user, async (scope) => {
      const windows = (await this.windows(scope)).filter(
        (window) =>
          !['pending', 'in_progress', 'late'].includes(window.status) &&
          this.matchesGuard(window, input.vigilador) &&
          (!input.estado || window.status === input.estado) &&
          (!input.dia || localReportDay(window.startsAt, scope.timezone) === input.dia),
      );
      if (input.orden === 'desc') windows.reverse();
      return {
        total: windows.length,
        page: input.page,
        pageSize: input.pageSize,
        items: windows
          .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
          .map((window) => {
            const owner = complianceOwner(window);
            return {
              id: window.id,
              shiftId: window.shiftId,
              roundName: window.roundName,
              site: window.site,
              guard: owner
                ? { id: owner.id, name: owner.name, deactivated: owner.status !== 'active' }
                : null,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              status: window.status,
            };
          }),
      };
    });
  }

  pending(input: { predio?: string }, user: AuthenticatedUser) {
    return this.measured('pending', input, user, async (scope) => {
      const db = this.prisma.tenantPrisma;
      const sites = { in: scope.siteIds };
      const [reviews, incidents, unsynced, unassigned] = await Promise.all([
        db.roundWindowState.aggregate({
          where: { status: 'in_review', shift: { siteId: sites, status: { not: 'cancelled' } } },
          _count: true,
          _min: { inReviewSince: true },
        }),
        db.incident.aggregate({
          where: { siteId: sites, classificationStatus: 'pending' },
          _count: true,
          _min: { createdAt: true },
        }),
        db.notice.aggregate({
          where: { siteId: sites, kind: 'shift_unsynced', status: 'open' },
          _count: true,
          _min: { createdAt: true },
        }),
        db.shift.aggregate({
          where: { siteId: sites, status: 'unassigned', startsAt: { gt: this.clock.now() } },
          _count: true,
          _min: { startsAt: true },
        }),
      ]);
      return {
        inReview: {
          count: reviews._count,
          oldestAt: reviews._min.inReviewSince?.toISOString() ?? null,
        },
        incidents: {
          count: incidents._count,
          oldestAt: incidents._min.createdAt?.toISOString() ?? null,
        },
        unsynced: {
          count: unsynced._count,
          oldestAt: unsynced._min.createdAt?.toISOString() ?? null,
        },
        unassigned: {
          count: unassigned._count,
          nextAt: unassigned._min.startsAt?.toISOString() ?? null,
        },
        message: 'El cliente ve las rondas en revisión como en verificación',
      };
    });
  }

  points(input: ReportQuery, user: AuthenticatedUser) {
    return this.measured('frequent_flags', input, user, async (scope) => {
      const records = await this.prisma.tenantPrisma.checkpointRecord.findMany({
        where: {
          invalidatedAt: null,
          countsForCompliance: true,
          OR: [
            { trustedAt: scope.dateRange },
            { trustedAt: null, occurredAtDevice: scope.dateRange },
          ],
          shift: { siteId: { in: scope.siteIds }, status: { not: 'cancelled' } },
        },
        select: {
          checkpointId: true,
          checkpoint: { select: { name: true, site: { select: { id: true, name: true } } } },
          assignment: { select: { guardId: true } },
          flags: { take: 1, select: { id: true } },
        },
      });
      const points = new Map<
        string,
        {
          id: string;
          name: string;
          site: { id: string; name: string };
          validRecords: number;
          markedRecords: number;
          guards: Map<string, number>;
        }
      >();
      for (const record of records) {
        const point = points.get(record.checkpointId) ?? {
          id: record.checkpointId,
          name: record.checkpoint.name,
          site: record.checkpoint.site,
          validRecords: 0,
          markedRecords: 0,
          guards: new Map<string, number>(),
        };
        point.validRecords++;
        if (record.flags.length) {
          point.markedRecords++;
          if (record.assignment.guardId)
            point.guards.set(
              record.assignment.guardId,
              (point.guards.get(record.assignment.guardId) ?? 0) + 1,
            );
        }
        points.set(point.id, point);
      }
      return {
        items: [...points.values()]
          .filter((point) => point.markedRecords >= 3)
          .map((point) => ({
            id: point.id,
            name: point.name,
            site: point.site,
            validRecords: point.validRecords,
            markedRecords: point.markedRecords,
            proportion: point.markedRecords / point.validRecords,
            guardCount: point.guards.size,
            distribution: [...point.guards.values()].some(
              (count) => count / point.markedRecords >= 0.7,
            )
              ? ('concentrated' as const)
              : ('distributed' as const),
          }))
          .sort(
            (a, b) =>
              b.proportion - a.proportion ||
              b.markedRecords - a.markedRecords ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 10),
      };
    });
  }
}
