import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  isReportExportPeriodAllowed,
  REPORT_EXPORT_PERIOD_MESSAGE,
  reportExportHeaderSchema,
  reportQuerySchema,
  incidentReportQuerySchema,
  portalQuerySchema,
  reportResponseSchema,
  reportDetailResponseSchema,
  reportPointsResponseSchema,
  reportPendingResponseSchema,
  incidentReportResponseSchema,
  responseTimesReportSchema,
  panicReportResponseSchema,
  incidentReportDetailResponseSchema,
  panicReportDetailResponseSchema,
  portalSitesSchema,
  portalRoundsSchema,
  portalDaySchema,
  portalIncidentsSchema,
  portalEmergenciesSchema,
  PORTAL_STATUS_LABELS,
  INCIDENT_FOLLOW_UP_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_TYPE_LABELS,
  WEEKDAY_LABELS,
  type ReportQuery,
  type ResponseTimesReport,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantContext } from '../auth/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { IncidentReportsService } from '../reports/incident-reports.service';
import { PortalService } from '../portal/portal.service';
import { renderReportPdf, type PdfSection, type ReportPdf } from './report-pdf';

type Kind = 'rounds' | 'incidents' | 'portal';
const number = (value: number | null, unit = '') =>
  value === null
    ? 'Sin datos'
    : `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${unit}`;
const countSection = (
  title: string,
  rows: { name: string; value: number | null }[],
  percentage = false,
  line = false,
): PdfSection => ({
  title,
  columns: ['Indicador', percentage ? 'Cumplimiento (%)' : 'Cantidad'],
  rows: rows.map((row) => [row.name, number(row.value, percentage ? ' %' : '')]),
  chart: { values: rows.map((row) => row.value), percentage, line },
});

async function allPages<T>(
  read: (page: number) => Promise<{ total: number; items: T[] }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await read(page);
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length)
      throw new Error('El listado cambió durante la exportación; volvé a intentar');
  }
}

@Injectable()
export class ReportExportsService {
  private readonly logger = new Logger(ReportExportsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly incidents: IncidentReportsService,
    private readonly portal: PortalService,
    private readonly context: TenantContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async export(kind: Kind, raw: unknown, user: AuthenticatedUser) {
    const started = performance.now();
    const generatedAt = this.clock.now();
    const correlationId = this.context.current?.correlationId ?? 'unknown';
    const auditInput = z
      .object({
        desde: z.iso.date().optional().catch(undefined),
        hasta: z.iso.date().optional().catch(undefined),
        predio: z.string().min(1).max(100).optional().catch(undefined),
      })
      .safeParse(raw);
    let periodStart = auditInput.success ? auditInput.data.desde : undefined;
    let periodEnd = auditInput.success ? auditInput.data.hasta : undefined;
    let siteIds = auditInput.success && auditInput.data.predio ? [auditInput.data.predio] : [];
    let result: 'ok' | 'failed' = 'failed';
    let bytes = 0;
    let download: { pdf: Buffer; filename: string } | undefined;
    let failure: unknown;
    try {
      if (
        periodStart &&
        periodEnd &&
        periodStart < periodEnd &&
        !isReportExportPeriodAllowed(periodStart, periodEnd)
      )
        throw new BadRequestException(REPORT_EXPORT_PERIOD_MESSAGE);
      const schema =
        kind === 'portal'
          ? portalQuerySchema
          : kind === 'rounds'
            ? reportQuerySchema
            : incidentReportQuerySchema;
      const input = parseOrBadRequest(schema, raw);
      const report =
        kind === 'portal'
          ? await this.clientReport(input, user)
          : kind === 'rounds'
            ? await this.roundsReport(input, user)
            : await this.incidentsReport(input, user);
      periodStart = report.desde;
      periodEnd = report.hasta;
      siteIds = report.siteIds;
      if (!isReportExportPeriodAllowed(report.desde, report.hasta))
        throw new BadRequestException(REPORT_EXPORT_PERIOD_MESSAGE);
      const pdf = await renderReportPdf({ ...report, generatedAt });
      bytes = pdf.length;
      result = 'ok';
      download = {
        pdf,
        filename: `garita-${kind === 'rounds' ? 'cumplimiento' : kind === 'incidents' ? 'incidentes' : 'portal'}-${report.desde}-${report.hasta}.pdf`,
      };
    } catch (error) {
      failure = error;
    }
    try {
      await this.prisma.tenantPrisma.reportExport.create({
        data: {
          companyId: user.companyId,
          userId: user.userId,
          role: user.role,
          siteIds,
          periodStart,
          periodEnd,
          reportType: kind,
          result,
          correlationId,
          createdAt: generatedAt,
        },
      });
    } catch (error) {
      // El PDF ya está generado: un fallo de auditoría se registra pero no bloquea la descarga.
      this.logger.error({
        event: 'report_export.audit_failed',
        correlationId,
        error: String(error),
      });
    }
    this.logger[result === 'ok' ? 'log' : 'error']({
      event: 'report_export.metric',
      correlationId,
      userId: user.userId,
      role: user.role,
      reportType: kind,
      result,
      siteIds,
      desde: periodStart,
      hasta: periodEnd,
      elapsedMs: performance.now() - started,
      bytes,
      rssBytes: process.memoryUsage().rss,
    });
    if (result === 'failed' || !download) throw failure;
    return download;
  }

  private date(value: string, timezone: string) {
    return new Date(value).toLocaleString('es-AR', { timeZone: timezone });
  }

  // Excepción aprobada: solo metadatos faltantes, después de autorizar los predios en el servicio existente.
  private async staffHeader(
    input: ReportQuery,
    user: AuthenticatedUser,
    visibleSites: { id: string }[],
  ) {
    const db = this.prisma.tenantPrisma;
    const [company, sites] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } }),
      db.site.findMany({
        where: {
          id: {
            in: visibleSites
              .filter((site) => !input.predio || site.id === input.predio)
              .map((site) => site.id),
          },
          ...(input.cliente ? { clientId: input.cliente } : {}),
        },
        select: { id: true, name: true, client: { select: { name: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      siteIds: sites.map((site) => site.id),
      header: reportExportHeaderSchema.parse({
        company: company.name,
        clients: [...new Set(sites.map((site) => site.client.name))],
        sites: sites.map((site) => site.name),
      }),
    };
  }

  private async roundsReport(input: ReportQuery, user: AuthenticatedUser) {
    const report = reportResponseSchema.parse(await this.reports.report(input, user));
    const period = { ...input, desde: report.desde, hasta: report.hasta };
    const header = await this.staffHeader(period, user, report.filters.sites);
    const points = reportPointsResponseSchema.parse(
      await this.reports.points(
        { desde: report.desde, hasta: report.hasta, predio: input.predio },
        user,
      ),
    );
    const pending = reportPendingResponseSchema.parse(
      await this.reports.pending({ predio: input.predio }, user),
    );
    const details = await allPages(async (page) =>
      reportDetailResponseSchema.parse(
        await this.reports.detail({ ...period, page, pageSize: 100 }, user),
      ),
    );
    const totals = report.totals;
    const sections: PdfSection[] = [
      countSection(
        'Porcentaje de cumplimiento',
        [{ name: 'Cumplimiento del período', value: totals.percentage }],
        true,
      ),
      countSection('Rondas por estado', [
        { name: 'Completas sin demora', value: totals.complete - totals.complete_late },
        { name: 'Completas con demora', value: totals.complete_late },
        { name: 'Incompletas', value: totals.incomplete },
        { name: 'No realizadas', value: totals.not_done },
        { name: 'En revisión (fuera del porcentaje)', value: totals.in_review },
        { name: 'Pendientes de sincronizar (fuera del porcentaje)', value: totals.pending_sync },
      ]),
      {
        title: 'Resumen de indicadores',
        columns: ['Indicador', 'Cantidad'],
        rows: [
          ['Completas', String(totals.complete)],
          ['Evaluadas', String(totals.evaluated)],
          ['Sin observaciones', String(totals.withoutObservations)],
          ['Observaciones medias', String(totals.media)],
          ['Observaciones leves', String(totals.leve)],
          ['Validadas', String(totals.validated)],
        ],
      },
      countSection(
        'Evolución diaria del cumplimiento',
        report.daily.map((day) => ({ name: day.name, value: day.totals.percentage })),
        true,
        true,
      ),
      countSection(
        'Comparación de cumplimiento por predio',
        report.bySite.map((site) => ({ name: site.name, value: site.totals.percentage })),
        true,
      ),
      {
        title: 'Cumplimiento por predio',
        columns: ['Predio', 'A tiempo', 'Tardías', 'Incompletas', 'No realizadas', 'Evaluadas'],
        rows: report.bySite.map((site) => [
          site.name,
          String(site.totals.complete - site.totals.complete_late),
          String(site.totals.complete_late),
          String(site.totals.incomplete),
          String(site.totals.not_done),
          String(site.totals.evaluated),
        ]),
      },
      countSection(
        'Comparación de cumplimiento por vigilador',
        report.byGuard.map((guard) => ({
          name: `${guard.name}${guard.deactivated ? ' (desactivado)' : ''}`,
          value: guard.totals.percentage,
        })),
        true,
      ),
      {
        title:
          'Puntos con marcas frecuentes (período y predio; sin filtro de cliente ni vigilador)',
        columns: ['Punto / predio', 'Válidos', 'Marcados', 'Proporción', 'Distribución'],
        rows: points.items.map((point) => [
          `${point.name} / ${point.site.name}`,
          String(point.validRecords),
          String(point.markedRecords),
          number(point.proportion * 100, ' %'),
          point.distribution === 'concentrated'
            ? 'Concentradas'
            : `Repartidas (${point.guardCount} vigiladores)`,
        ]),
      },
      {
        title: 'Pendientes actuales del predio (independientes del período)',
        columns: ['Indicador', 'Cantidad', 'Fecha más antigua / próxima'],
        rows: [
          [
            'Rondas en revisión',
            String(pending.inReview.count),
            pending.inReview.oldestAt
              ? this.date(pending.inReview.oldestAt, report.timezone)
              : 'Sin datos',
          ],
          [
            'Incidentes pendientes',
            String(pending.incidents.count),
            pending.incidents.oldestAt
              ? this.date(pending.incidents.oldestAt, report.timezone)
              : 'Sin datos',
          ],
          [
            'Sin sincronizar',
            String(pending.unsynced.count),
            pending.unsynced.oldestAt
              ? this.date(pending.unsynced.oldestAt, report.timezone)
              : 'Sin datos',
          ],
          [
            'Sin vigilador',
            String(pending.unassigned.count),
            pending.unassigned.nextAt
              ? this.date(pending.unassigned.nextAt, report.timezone)
              : 'Sin datos',
          ],
        ],
      },
      {
        title: 'Listado de rondas del período',
        columns: ['Predio / ronda', 'Vigilador', 'Inicio / fin', 'Estado'],
        rows: details.map((row) => [
          `${row.site.name} / ${row.roundName}`,
          row.guard
            ? `${row.guard.name}${row.guard.deactivated ? ' (desactivado)' : ''}`
            : 'Sin vigilador',
          `${this.date(row.startsAt, report.timezone)} / ${this.date(row.endsAt, report.timezone)}`,
          {
            complete: 'Completa',
            complete_late: 'Completa con demora',
            incomplete: 'Incompleta',
            not_done: 'No realizada',
            in_review: 'En revisión',
            pending_sync: 'Pendiente de sincronizar',
            pending: 'Pendiente',
            in_progress: 'En curso',
            late: 'Tarde',
          }[row.status],
        ]),
      },
    ];
    return {
      ...header,
      title: 'Reporte de cumplimiento',
      desde: report.desde,
      hasta: report.hasta,
      timezone: report.timezone,
      sections,
    };
  }

  private timeSections(report: ResponseTimesReport): PdfSection[] {
    const groups = [
      {
        title: 'Resumen de tiempos de respuesta',
        rows: [{ name: 'Equipo', times: report.totals }],
      },
      { title: 'Tiempos por predio', rows: report.bySite },
      ...('bySupervisor' in report
        ? [{ title: 'Comparación por supervisor', rows: report.bySupervisor }]
        : [{ title: 'Tus tiempos', rows: [report.own] }]),
    ];
    return groups.map((group) => ({
      title: group.title,
      columns: [
        'Nombre / indicador',
        'Promedio',
        'Máximo',
        'Con respuesta',
        'Sin respuesta',
        'Escaladas',
      ],
      rows: group.rows.flatMap((row) =>
        // Rondas incumplidas se reporta en Cumplimiento.
        (
          [
            ['panic', 'Pánico'],
            ['classification', 'Clasificación de incidentes'],
          ] as const
        ).map(([key, label]) => {
          const times = row.times[key];
          return [
            `${row.name} / ${label}`,
            number(times.averageMs === null ? null : times.averageMs / 60000, ' min'),
            number(times.maximumMs === null ? null : times.maximumMs / 60000, ' min'),
            String(times.count),
            String(times.unanswered),
            String(times.escalated),
          ];
        }),
      ),
    }));
  }

  private async incidentsReport(input: ReportQuery, user: AuthenticatedUser) {
    const report = incidentReportResponseSchema.parse(await this.incidents.incidents(input, user));
    const period = { ...input, desde: report.desde, hasta: report.hasta };
    const header = await this.staffHeader(period, user, report.filters.sites);
    const times = responseTimesReportSchema.parse(await this.incidents.responseTimes(period, user));
    const panic = panicReportResponseSchema.parse(await this.incidents.panic(period, user));
    const incidents = await allPages(async (page) =>
      incidentReportDetailResponseSchema.parse(
        await this.incidents.incidentDetail({ ...period, page, pageSize: 100 }, user),
      ),
    );
    const alerts = await allPages(async (page) =>
      panicReportDetailResponseSchema.parse(
        await this.incidents.panicDetail({ ...period, page, pageSize: 100 }, user),
      ),
    );
    const sections: PdfSection[] = [
      {
        title: 'Resumen de incidentes',
        columns: ['Indicador', 'Valor'],
        rows: [
          ['Total', String(report.total)],
          ['Total del período anterior', String(report.previous.total)],
          ['Gravedad alta', String(report.highSeverity)],
          ['Gravedad alta del período anterior', String(report.previous.highSeverity)],
          ['Con seguimiento abierto hoy', String(report.openFollowUpsTotal)],
        ],
      },
      countSection('Incidentes por tipo', report.byType),
      countSection('Incidentes por gravedad', report.bySeverity),
      {
        title: 'Incidentes por día y franja de dos horas',
        columns: ['Día', ...report.byTimeBand.map((band) => band.name.slice(0, 2))],
        rows: report.byWeekdayTimeBand.map((counts, day) => [
          WEEKDAY_LABELS[day] ?? '',
          ...counts.map(String),
        ]),
      },
      countSection('Incidentes por predio', report.bySite),
      ...this.timeSections(times),
      countSection('Pánico por resultado', panic.byOutcome),
      countSection('Pánico por canal', panic.byChannel),
      {
        title: 'Resumen de pánico',
        columns: ['Indicador', 'Valor'],
        rows: [
          ['Total', String(panic.total)],
          [
            'Proporción de falsas alarmas sobre todas las alertas',
            number(
              panic.falseAlarmProportion === null ? null : panic.falseAlarmProportion * 100,
              ' %',
            ),
          ],
        ],
      },
      {
        title: 'Listado de incidentes del período',
        columns: ['Predio', 'Tipo', 'Ocurrencia', 'Clasificación', 'Gravedad', 'Seguimiento'],
        rows: incidents.map((row) => [
          row.site.name,
          INCIDENT_TYPE_LABELS[row.type],
          this.date(row.occurredAt, report.timezone),
          { pending: 'Pendiente', client_visible: 'Visible para el cliente', internal: 'Interno' }[
            row.classificationStatus
          ],
          row.severity ? INCIDENT_SEVERITY_LABELS[row.severity] : 'Sin clasificar',
          INCIDENT_FOLLOW_UP_LABELS[row.followUpStatus],
        ]),
      },
      {
        title:
          report.openFollowUpsTotal > report.openFollowUps.length
            ? `Seguimiento abierto hoy: los ${String(report.openFollowUps.length)} más prioritarios de ${String(report.openFollowUpsTotal)}`
            : `Seguimiento abierto hoy (${String(report.openFollowUpsTotal)})`,
        columns: ['Predio', 'Tipo', 'Gravedad', 'Abierto desde', 'Última acción'],
        rows: report.openFollowUps.map((row) => [
          row.site.name,
          INCIDENT_TYPE_LABELS[row.type],
          row.severity ? INCIDENT_SEVERITY_LABELS[row.severity] : 'Sin clasificar',
          this.date(row.openedAt, report.timezone),
          row.lastAction ?? 'Sin acciones',
        ]),
      },
      {
        title: 'Listado de alertas del período',
        columns: ['Predio', 'Activación', 'Canal', 'Resultado'],
        rows: alerts.map((row) => [
          row.site.name,
          this.date(row.triggeredAt, report.timezone),
          row.channel === 'sms' ? 'SMS' : 'Internet',
          row.outcome === null
            ? 'Sin resolver'
            : { real_emergency: 'Emergencia real', false_alarm: 'Falsa alarma', test: 'Prueba' }[
                row.outcome
              ],
        ]),
      },
    ];
    return {
      ...header,
      title: 'Reporte de incidentes y respuesta',
      desde: report.desde,
      hasta: report.hasta,
      timezone: report.timezone,
      sections,
    };
  }

  private async clientReport(
    input: ReportQuery,
    user: AuthenticatedUser,
  ): Promise<Omit<ReportPdf, 'generatedAt'> & { siteIds: string[] }> {
    const report = portalRoundsSchema.parse(await this.portal.rounds(input, user));
    const sites = portalSitesSchema
      .parse(await this.portal.sites(user))
      .filter((site) => !input.predio || site.id === input.predio);
    const db = this.prisma.tenantPrisma;
    const [company, client] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } }),
      db.client.findFirst({ where: { id: user.clientId ?? '' }, select: { name: true } }),
    ]);
    // An inactive client is invisible to its own policy: answer 404, not a Prisma error.
    if (!client) throw new NotFoundException('Cliente no encontrado');
    const header = reportExportHeaderSchema.parse({
      company: company.name,
      clients: [client.name],
      sites: sites.map((site) => site.name),
    });
    const period = { desde: report.desde, hasta: report.hasta, predio: input.predio };
    const incidents = await allPages(async (page) =>
      portalIncidentsSchema.parse(
        await this.portal.incidents({ ...period, page, pageSize: 100 }, user),
      ),
    );
    const emergencies = await allPages(async (page) =>
      portalEmergenciesSchema.parse(
        await this.portal.emergencies({ ...period, page, pageSize: 100 }, user),
      ),
    );
    const rounds: z.infer<typeof portalDaySchema>['items'] = [];
    for (const day of report.daily) {
      if (day.totals.evaluated + day.totals.en_verificacion === 0) continue;
      rounds.push(
        ...(await allPages(async (page) =>
          portalDaySchema.parse(
            await this.portal.day(
              { fecha: day.date, predio: input.predio, page, pageSize: 100 },
              user,
            ),
          ),
        )),
      );
    }
    const sections: PdfSection[] = [
      {
        title: 'Resumen de cumplimiento',
        columns: ['Indicador', 'Valor'],
        rows: [
          ['Cumplimiento', number(report.totals.percentage, ' %')],
          ['Evaluadas', String(report.totals.evaluated)],
          ['Rondas en verificación', String(report.totals.en_verificacion)],
          ['Verificación', report.verificationMessage],
        ],
      },
      countSection(
        'Rondas por estado',
        (['completa', 'incompleta', 'no_realizada'] as const).map((key) => ({
          name: PORTAL_STATUS_LABELS[key],
          value: report.totals[key],
        })),
      ),
      countSection(
        'Evolución diaria del cumplimiento',
        report.daily.map((day) => ({ name: day.date, value: day.totals.percentage })),
        true,
        true,
      ),
      {
        title: 'Listado de rondas del período',
        columns: ['Predio', 'Inicio', 'Fin', 'Estado'],
        rows: rounds.map((row) => [
          row.site.name,
          this.date(row.startsAt, report.timezone),
          this.date(row.endsAt, report.timezone),
          PORTAL_STATUS_LABELS[row.status],
        ]),
      },
      {
        title: 'Incidentes compartidos',
        columns: ['Predio / tipo', 'Ocurrencia', 'Nota para el cliente', 'Fotos'],
        rows: incidents.map((row) => [
          `${row.site.name} / ${INCIDENT_TYPE_LABELS[row.type]}`,
          this.date(row.occurredAt, report.timezone),
          row.clientNote ?? 'Sin nota para el cliente.',
          `${row.photoCount} fotos. Se consultan en el portal.`,
        ]),
      },
      {
        title: 'Emergencias reales',
        columns: ['Predio', 'Activación', 'Tiempo de respuesta de la empresa'],
        rows: emergencies.map((row) => [
          row.site.name,
          this.date(row.triggeredAt, report.timezone),
          number(row.responseTimeMs / 1000, ' segundos'),
        ]),
      },
    ];
    return {
      title: 'Reporte del portal del cliente',
      header,
      siteIds: sites.map((site) => site.id),
      desde: report.desde,
      hasta: report.hasta,
      timezone: report.timezone,
      sections,
    };
  }
}
