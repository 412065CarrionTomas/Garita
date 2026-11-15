import { Inject, Injectable } from '@nestjs/common';
import {
  computeIncidentReport,
  computePanicReport,
  computeResponseTimes,
  localDateTimeToUtc,
  type IncidentReportQuery,
  type IncidentReportDetailQuery,
  type PanicReportDetailQuery,
  type ResponseTimesReport,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { Prisma } from '../../generated/prisma/client';
import { ReportScopeService, type ReportScope } from './incident-reports-scope.service';

const named = { id: true, name: true } as const;
const person = { id: true, firstName: true, lastName: true } as const;
const namePerson = (user: { id: string; firstName: string; lastName: string }) => ({
  id: user.id,
  name: `${user.firstName} ${user.lastName}`,
});

@Injectable()
export class IncidentReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private incidentWhere(
    scope: ReportScope,
    input: IncidentReportDetailQuery | IncidentReportQuery,
  ): Prisma.IncidentWhereInput {
    const ranges = [];
    if ('franja' in input && input.franja !== undefined) {
      const day = new Date(`${scope.desde}T00:00:00Z`);
      while (day.toISOString().slice(0, 10) < scope.hasta) {
        const date = day.toISOString().slice(0, 10);
        const gte = localDateTimeToUtc(date, input.franja * 60, scope.timezone);
        day.setUTCDate(day.getUTCDate() + 1);
        const lt =
          input.franja === 22
            ? localDateTimeToUtc(day.toISOString().slice(0, 10), 0, scope.timezone)
            : localDateTimeToUtc(date, (input.franja + 2) * 60, scope.timezone);
        ranges.push({ gte, lt });
      }
    } else ranges.push(scope.dateRange);
    return {
      siteId: { in: scope.siteIds },
      ...('tipo' in input && input.tipo ? { type: input.tipo } : {}),
      ...('clasificacion' in input && input.clasificacion
        ? { classificationStatus: input.clasificacion }
        : {}),
      OR: ranges.flatMap((range) => [
        { trustedAt: range },
        { trustedAt: null, occurredAtDevice: range },
      ]),
    };
  }

  incidents(input: IncidentReportQuery, user: AuthenticatedUser) {
    return this.scopes.measured('incidents', input, user, async (scope) => {
      const rows = await this.prisma.tenantPrisma.incident.findMany({
        where: this.incidentWhere(scope, input),
        select: {
          type: true,
          classificationStatus: true,
          site: { select: named },
          trustedAt: true,
          occurredAtDevice: true,
          receivedAt: true,
        },
      });
      return {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        ...computeIncidentReport(rows, scope.timezone, this.clock.now()),
        filters: {
          sites: scope.sites.map(({ id, name }) => ({ id, name })),
          clients: [...new Map(scope.sites.map((site) => [site.client.id, site.client])).values()],
        },
      };
    });
  }

  incidentDetail(input: IncidentReportDetailQuery, user: AuthenticatedUser) {
    return this.scopes.measured('incident_detail', input, user, async (scope) => {
      const db = this.prisma.tenantPrisma;
      const where = this.incidentWhere(scope, input);
      const [total, rows] = await Promise.all([
        db.incident.count({ where }),
        db.incident.findMany({
          where,
          orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          select: {
            id: true,
            site: { select: named },
            type: true,
            classificationStatus: true,
            trustedAt: true,
            occurredAtDevice: true,
          },
        }),
      ]);
      return {
        total,
        page: input.page,
        pageSize: input.pageSize,
        items: rows.map((row) => ({
          id: row.id,
          site: row.site,
          type: row.type,
          classificationStatus: row.classificationStatus,
          occurredAt: (row.trustedAt ?? row.occurredAtDevice).toISOString(),
        })),
      };
    });
  }

  responseTimes(input: IncidentReportQuery, user: AuthenticatedUser) {
    return this.scopes.measured('response_times', input, user, async (scope) => {
      const db = this.prisma.tenantPrisma;
      const siteId = { in: scope.siteIds };
      const [panics, notices, incidents] = await Promise.all([
        db.panicAlert.findMany({
          where: { siteId, triggeredAt: scope.dateRange },
          select: {
            site: { select: named },
            triggeredAt: true,
            confirmedAt: true,
            escalatedAt: true,
            confirmedBy: { select: person },
          },
        }),
        db.notice.findMany({
          where: { siteId, kind: 'round_missed', createdAt: scope.dateRange },
          select: {
            site: { select: named },
            createdAt: true,
            views: {
              where: { user: { role: 'supervisor' } },
              orderBy: [{ seenAt: 'asc' }, { userId: 'asc' }],
              take: 1,
              select: { seenAt: true, user: { select: person } },
            },
          },
        }),
        db.incident.findMany({
          where: { siteId, receivedAt: scope.dateRange },
          select: {
            site: { select: named },
            receivedAt: true,
            classifications: {
              orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
              take: 1,
              select: { decidedAt: true, decidedBy: { select: person } },
            },
          },
        }),
      ]);
      const result = computeResponseTimes(
        panics.map((row) => ({
          ...row,
          confirmedBy: row.confirmedBy ? namePerson(row.confirmedBy) : null,
        })),
        notices.map((row) => ({
          site: row.site,
          startedAt: row.createdAt,
          responses: row.views.map((view) => ({ at: view.seenAt, by: namePerson(view.user) })),
        })),
        incidents.map((row) => ({
          site: row.site,
          startedAt: row.receivedAt,
          responses: row.classifications.map((decision) => ({
            at: decision.decidedAt,
            by: namePerson(decision.decidedBy),
          })),
        })),
      );
      const base = {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        totals: result.totals,
        bySite: result.bySite,
      };
      if (user.role === 'admin')
        return { ...base, bySupervisor: result.bySupervisor } satisfies ResponseTimesReport;
      const own = result.bySupervisor.find((row) => row.id === user.userId);
      const current = await db.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: person,
      });
      return {
        ...base,
        own: own ?? { ...namePerson(current), times: computeResponseTimes([], [], []).totals },
      } satisfies ResponseTimesReport;
    });
  }

  panic(input: IncidentReportQuery, user: AuthenticatedUser) {
    return this.scopes.measured('panic', input, user, async (scope) => {
      const rows = await this.prisma.tenantPrisma.panicAlert.findMany({
        where: { siteId: { in: scope.siteIds }, triggeredAt: scope.dateRange },
        select: { outcome: true, channel: true },
      });
      return {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        ...computePanicReport(rows),
      };
    });
  }

  panicDetail(input: PanicReportDetailQuery, user: AuthenticatedUser) {
    return this.scopes.measured('panic_detail', input, user, async (scope) => {
      const db = this.prisma.tenantPrisma;
      const where = {
        siteId: { in: scope.siteIds },
        triggeredAt: scope.dateRange,
        ...(input.resultado
          ? { outcome: input.resultado === 'unresolved' ? null : input.resultado }
          : {}),
        ...(input.canal ? { channel: input.canal } : {}),
      };
      const [total, rows] = await Promise.all([
        db.panicAlert.count({ where }),
        db.panicAlert.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ triggeredAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            site: { select: named },
            triggeredAt: true,
            channel: true,
            outcome: true,
          },
        }),
      ]);
      return {
        total,
        page: input.page,
        pageSize: input.pageSize,
        items: rows.map((row) => ({ ...row, triggeredAt: row.triggeredAt.toISOString() })),
      };
    });
  }
}
