import { Inject, Injectable } from '@nestjs/common';
import {
  computeIncidentReport,
  computePanicReport,
  computeResponseTimes,
  localDateTimeToUtc,
  localDateWeekday,
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
    dateRange = scope.dateRange,
  ): Prisma.IncidentWhereInput {
    const ranges = [];
    const franja = 'franja' in input ? input.franja : undefined;
    const dia = 'dia' in input ? input.dia : undefined;
    if (franja !== undefined || dia !== undefined) {
      // Un rango por día local: la franja (o el día entero) en la zona de la empresa.
      const day = new Date(`${scope.desde}T00:00:00Z`);
      while (day.toISOString().slice(0, 10) < scope.hasta) {
        const date = day.toISOString().slice(0, 10);
        day.setUTCDate(day.getUTCDate() + 1);
        const nextDate = day.toISOString().slice(0, 10);
        if (dia !== undefined && localDateWeekday(date) !== dia) continue;
        const gte = localDateTimeToUtc(date, (franja ?? 0) * 60, scope.timezone);
        const lt =
          franja === undefined || franja === 22
            ? localDateTimeToUtc(nextDate, 0, scope.timezone)
            : localDateTimeToUtc(date, (franja + 2) * 60, scope.timezone);
        ranges.push({ gte, lt });
      }
      // Sin días que coincidan, ningún incidente (un OR vacío no filtra en Prisma).
      if (!ranges.length) ranges.push({ gte: scope.dateRange.gte, lt: scope.dateRange.gte });
    } else ranges.push(dateRange);
    return {
      siteId: { in: scope.siteIds },
      ...('tipo' in input && input.tipo ? { type: input.tipo } : {}),
      ...('gravedad' in input && input.gravedad ? { severity: input.gravedad } : {}),
      ...('seguimiento' in input && input.seguimiento ? { followUpStatus: 'open' as const } : {}),
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
      const db = this.prisma.tenantPrisma;
      const now = this.clock.now();
      const [rows, previousRows, followUps] = await Promise.all([
        db.incident.findMany({
          where: this.incidentWhere(scope, input),
          select: {
            type: true,
            classificationStatus: true,
            severity: true,
            followUpStatus: true,
            site: { select: named },
            trustedAt: true,
            occurredAtDevice: true,
            receivedAt: true,
          },
        }),
        db.incident.findMany({
          where: this.incidentWhere(scope, input, scope.previous.dateRange),
          select: { severity: true },
        }),
        // El seguimiento abierto no depende del período: es trabajo pendiente hoy.
        db.incident.findMany({
          where: { siteId: { in: scope.siteIds }, followUpStatus: 'open' },
          orderBy: [{ severity: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: 50,
          select: {
            id: true,
            type: true,
            severity: true,
            createdAt: true,
            site: { select: named },
            classifications: {
              where: { requiresFollowUp: true },
              orderBy: { decidedAt: 'asc' },
              take: 1,
              select: { decidedAt: true },
            },
            followUpActions: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true } },
          },
        }),
      ]);
      return {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        ...computeIncidentReport(rows, scope.timezone, now),
        previous: {
          desde: scope.previous.desde,
          hasta: scope.previous.hasta,
          total: previousRows.length,
          highSeverity: previousRows.filter((row) => row.severity === 'high').length,
        },
        openFollowUps: followUps.map((row) => {
          const openedAt = row.classifications[0]?.decidedAt ?? row.createdAt;
          return {
            id: row.id,
            type: row.type,
            site: row.site,
            severity: row.severity,
            openedAt: openedAt.toISOString(),
            ageMs: Math.max(0, now.getTime() - openedAt.getTime()),
            lastAction: row.followUpActions[0]?.text ?? null,
          };
        }),
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
            severity: true,
            followUpStatus: true,
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
          severity: row.severity,
          followUpStatus: row.followUpStatus,
          occurredAt: (row.trustedAt ?? row.occurredAtDevice).toISOString(),
        })),
      };
    });
  }

  responseTimes(input: IncidentReportQuery, user: AuthenticatedUser) {
    return this.scopes.measured('response_times', input, user, async (scope) => {
      const [result, previous] = await Promise.all([
        this.responseSamples(scope, scope.dateRange),
        this.responseSamples(scope, scope.previous.dateRange),
      ]);
      const base = {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        totals: result.totals,
        previousTotals: previous.totals,
        bySite: result.bySite,
      };
      if (user.role === 'admin')
        return { ...base, bySupervisor: result.bySupervisor } satisfies ResponseTimesReport;
      const own = result.bySupervisor.find((row) => row.id === user.userId);
      const current = await this.prisma.tenantPrisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: person,
      });
      return {
        ...base,
        own: own ?? { ...namePerson(current), times: computeResponseTimes([], [], []).totals },
      } satisfies ResponseTimesReport;
    });
  }

  private async responseSamples(scope: ReportScope, dateRange: ReportScope['dateRange']) {
    const db = this.prisma.tenantPrisma;
    const siteId = { in: scope.siteIds };
    const [panics, notices, incidents] = await Promise.all([
      db.panicAlert.findMany({
        where: { siteId, triggeredAt: dateRange },
        select: {
          site: { select: named },
          triggeredAt: true,
          confirmedAt: true,
          escalatedAt: true,
          confirmedBy: { select: person },
        },
      }),
      db.notice.findMany({
        where: { siteId, kind: 'round_missed', createdAt: dateRange },
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
        where: { siteId, receivedAt: dateRange },
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
    return computeResponseTimes(
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
  }

  panic(input: IncidentReportQuery, user: AuthenticatedUser) {
    return this.scopes.measured('panic', input, user, async (scope) => {
      const find = (triggeredAt: ReportScope['dateRange']) =>
        this.prisma.tenantPrisma.panicAlert.findMany({
          where: { siteId: { in: scope.siteIds }, triggeredAt },
          select: { outcome: true, channel: true },
        });
      const [rows, previousRows] = await Promise.all([
        find(scope.dateRange),
        find(scope.previous.dateRange),
      ]);
      const previous = computePanicReport(previousRows);
      return {
        desde: scope.desde,
        hasta: scope.hasta,
        timezone: scope.timezone,
        ...computePanicReport(rows),
        previous: { total: previous.total, falseAlarmProportion: previous.falseAlarmProportion },
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
