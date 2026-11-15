import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computePortalCompliance,
  defaultReportPeriod,
  localDateTimeToUtc,
  portalRoundStatus,
  portalSitesSchema,
  portalRoundsSchema,
  portalDaySchema,
  portalIncidentsSchema,
  portalPhotosSchema,
  portalEmergenciesSchema,
  type PortalQuery,
  type PortalListQuery,
  type PortalDayQuery,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PHOTO_STORAGE_PORT, type PhotoStoragePort } from '../incidents/photo-storage.port';

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PHOTO_STORAGE_PORT) private readonly photos: PhotoStoragePort,
  ) {}

  private async scope(input: PortalQuery, user: AuthenticatedUser) {
    if (user.role !== 'client' || !user.clientId) throw new ForbiddenException();
    if (input.predio) await this.resources.findOwnedOrThrow('Site', input.predio);
    const db = this.prisma.tenantPrisma;
    const [company, sites] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { timezone: true } }),
      db.site.findMany({
        where: input.predio ? { id: input.predio } : {},
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const period =
      input.desde && input.hasta
        ? { desde: input.desde, hasta: input.hasta }
        : defaultReportPeriod(this.clock.now(), company.timezone);
    return {
      ...period,
      timezone: company.timezone,
      sites,
      siteIds: sites.map((site) => site.id),
      dateRange: {
        gte: localDateTimeToUtc(period.desde, 0, company.timezone),
        lt: localDateTimeToUtc(period.hasta, 0, company.timezone),
      },
    };
  }

  private async measured<T>(
    kind: string,
    input: PortalQuery,
    user: AuthenticatedUser,
    run: (scope: Awaited<ReturnType<PortalService['scope']>>) => T | Promise<T>,
  ) {
    const started = performance.now();
    let scope: Awaited<ReturnType<PortalService['scope']>> | undefined;
    try {
      scope = await this.scope(input, user);
      return await run(scope);
    } finally {
      const elapsedMs = performance.now() - started;
      this.logger[elapsedMs >= 3000 ? 'warn' : 'log']({
        event: 'portal.query',
        kind,
        userId: user.userId,
        clientId: user.clientId,
        siteIds: scope?.siteIds ?? [],
        desde: scope?.desde ?? input.desde,
        hasta: scope?.hasta ?? input.hasta,
        elapsedMs,
      });
    }
  }

  sites(user: AuthenticatedUser) {
    return this.measured('sites', {}, user, (scope) => portalSitesSchema.parse(scope.sites));
  }

  rounds(input: PortalQuery, user: AuthenticatedUser) {
    return this.measured('rounds', input, user, async (scope) => {
      const rows = await this.prisma.tenantPrisma.roundWindowState.findMany({
        where: { startsAt: scope.dateRange, shift: { siteId: { in: scope.siteIds } } },
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          shift: { select: { site: { select: { id: true, name: true } } } },
        },
      });
      return portalRoundsSchema.parse(
        computePortalCompliance(
          rows.map((row) => ({
            status: row.status,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            site: row.shift.site,
          })),
          scope.timezone,
          { desde: scope.desde, hasta: scope.hasta },
        ),
      );
    });
  }

  day(input: PortalDayQuery, user: AuthenticatedUser) {
    const next = new Date(`${input.fecha}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return this.measured(
      'day',
      {
        desde: input.fecha,
        hasta: next.toISOString().slice(0, 10),
        predio: input.predio,
      },
      user,
      async (scope) => {
        // La traducción compartida es la única regla de visibilidad de estados.
        const rows = await this.prisma.tenantPrisma.roundWindowState.findMany({
          where: { startsAt: scope.dateRange, shift: { siteId: { in: scope.siteIds } } },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          select: {
            status: true,
            startsAt: true,
            endsAt: true,
            shift: { select: { site: { select: { id: true, name: true } } } },
          },
        });
        const visible = rows.flatMap((row) => {
          const status = portalRoundStatus(row.status);
          return status
            ? [
                {
                  startsAt: row.startsAt.toISOString(),
                  endsAt: row.endsAt.toISOString(),
                  site: row.shift.site,
                  status,
                },
              ]
            : [];
        });
        return portalDaySchema.parse({
          total: visible.length,
          page: input.page,
          pageSize: input.pageSize,
          items: visible.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
        });
      },
    );
  }

  incidents(input: PortalListQuery, user: AuthenticatedUser) {
    return this.measured('incidents', input, user, async (scope) => {
      const where = {
        siteId: { in: scope.siteIds },
        OR: [
          { trustedAt: scope.dateRange },
          { trustedAt: null, occurredAtDevice: scope.dateRange },
        ],
      };
      const db = this.prisma.tenantPrisma;
      const [total, rows] = await Promise.all([
        db.incident.count({ where }),
        db.incident.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          select: {
            id: true,
            type: true,
            trustedAt: true,
            occurredAtDevice: true,
            site: { select: { id: true, name: true } },
            classifications: {
              orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { clientNote: true },
            },
            _count: { select: { photos: true } },
          },
        }),
      ]);
      return portalIncidentsSchema.parse({
        total,
        page: input.page,
        pageSize: input.pageSize,
        items: rows.map((row) => ({
          id: row.id,
          type: row.type,
          occurredAt: (row.trustedAt ?? row.occurredAtDevice).toISOString(),
          site: row.site,
          clientNote: row.classifications[0]?.clientNote ?? null,
          photoCount: row._count.photos,
        })),
      });
    });
  }

  incidentPhotos(id: string, user: AuthenticatedUser) {
    return this.measured('photos', {}, user, async (scope) => {
      await this.resources.findOwnedOrThrow('Incident', id);
      const row = await this.prisma.tenantPrisma.incident.findFirst({
        where: { id, siteId: { in: scope.siteIds } },
        select: {
          photos: {
            orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
            select: { cloudinaryPublicId: true },
          },
        },
      });
      if (!row) throw new NotFoundException('Recurso no encontrado');
      return portalPhotosSchema.parse(
        row.photos.map((photo) => ({
          thumbnailUrl: this.photos.signedUrl(photo.cloudinaryPublicId, 'thumbnail'),
          fullUrl: this.photos.signedUrl(photo.cloudinaryPublicId, 'full'),
        })),
      );
    });
  }

  emergencies(input: PortalListQuery, user: AuthenticatedUser) {
    return this.measured('emergencies', input, user, async (scope) => {
      const where = {
        siteId: { in: scope.siteIds },
        triggeredAt: scope.dateRange,
        confirmedAt: { not: null },
      };
      const db = this.prisma.tenantPrisma;
      const [total, rows] = await Promise.all([
        db.panicAlert.count({ where }),
        db.panicAlert.findMany({
          where,
          orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          select: {
            triggeredAt: true,
            confirmedAt: true,
            site: { select: { id: true, name: true } },
          },
        }),
      ]);
      return portalEmergenciesSchema.parse({
        total,
        page: input.page,
        pageSize: input.pageSize,
        items: rows.map((row) => {
          if (!row.confirmedAt) throw new Error('Emergencia sin confirmación');
          return {
            triggeredAt: row.triggeredAt.toISOString(),
            site: row.site,
            // A device clock ahead of the server can put triggeredAt after confirmedAt.
            responseTimeMs: Math.max(0, row.confirmedAt.getTime() - row.triggeredAt.getTime()),
          };
        }),
      });
    });
  }
}
