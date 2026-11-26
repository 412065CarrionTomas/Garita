import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { PHOTO_STORAGE_PORT, type PhotoStoragePort } from './photo-storage.port';
import {
  localDateTimeToUtc,
  type IncidentClassificationInput,
  type IncidentFollowUpStatus,
  type IncidentListQuery,
} from '@garita/shared';

type Decision = IncidentClassificationInput & { reason?: string };
type FollowUpKind = 'note' | 'close' | 'reopen';

const OVERDUE_MS = 24 * 60 * 60_000;
const RELATED_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** Estado requerido antes de cada acción y estado resultante. */
export const FOLLOW_UP_TRANSITIONS: Record<
  FollowUpKind,
  { from: IncidentFollowUpStatus; to: IncidentFollowUpStatus }
> = {
  note: { from: 'open', to: 'open' },
  close: { from: 'open', to: 'closed' },
  reopen: { from: 'closed', to: 'open' },
};

const listSelect = {
  id: true,
  type: true,
  description: true,
  createdAt: true,
  occurredAtDevice: true,
  trustedAt: true,
  classificationStatus: true,
  severity: true,
  followUpStatus: true,
  site: { select: { id: true, name: true } },
  guard: { select: { firstName: true, lastName: true, status: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.IncidentSelect;
type ListRow = Prisma.IncidentGetPayload<{ select: typeof listSelect }>;

function personName(person: { firstName: string; lastName: string; status?: string }) {
  return `${person.firstName} ${person.lastName}${person.status === 'deactivated' ? ' (desactivado)' : ''}`;
}

function sortOrder(orden?: string): Prisma.IncidentOrderByWithRelationInput[] {
  const [field, dir] = (orden ?? 'fecha:desc').split(':') as [string, 'asc' | 'desc'];
  // shortcut: ordena por la hora del celular (la fecha mostrada es trustedAt ?? occurredAtDevice y
  // suelen diferir en segundos); si hace falta exactitud, persistir la hora efectiva en una columna.
  const byDate = { occurredAtDevice: dir };
  const primary: Prisma.IncidentOrderByWithRelationInput =
    field === 'tipo'
      ? { type: dir }
      : field === 'predio'
        ? { site: { name: dir } }
        : field === 'gravedad'
          ? { severity: { sort: dir, nulls: 'last' } }
          : byDate;
  return field === 'fecha'
    ? [byDate, { id: dir }]
    : [primary, { occurredAtDevice: 'desc' }, { id: 'desc' }];
}

@Injectable()
export class IncidentClassificationService {
  private readonly logger = new Logger(IncidentClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PHOTO_STORAGE_PORT) private readonly photos: PhotoStoragePort,
  ) {}

  private activeAssignment(user: AuthenticatedUser): Prisma.IncidentWhereInput {
    return user.role === 'supervisor'
      ? { site: { supervisors: { some: { userId: user.userId, user: { status: 'active' } } } } }
      : {};
  }

  private async companyTimezone(user: AuthenticatedUser) {
    const company = await this.prisma.tenantPrisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { timezone: true },
    });
    return company.timezone;
  }

  private queueWhere(user: AuthenticatedUser, predio?: string): Prisma.IncidentWhereInput {
    return {
      classificationStatus: 'pending',
      ...(predio ? { siteId: predio } : {}),
      ...(user.role === 'admin'
        ? { site: { supervisors: { none: { user: { status: 'active' } } } } }
        : this.activeAssignment(user)),
    };
  }

  private toItem(row: ListRow) {
    const now = this.clock.now().getTime();
    const ageMs = now - row.createdAt.getTime();
    return {
      id: row.id,
      type: row.type,
      description: row.description,
      occurredAt: row.trustedAt ?? row.occurredAtDevice,
      createdAt: row.createdAt,
      classificationStatus: row.classificationStatus,
      severity: row.severity,
      followUpStatus: row.followUpStatus,
      photoCount: row._count.photos,
      site: row.site,
      guardName: personName(row.guard),
      overdue: row.classificationStatus === 'pending' && ageMs > OVERDUE_MS,
      ageMs,
    };
  }

  async queueCount(user: AuthenticatedUser) {
    return {
      count: await this.prisma.tenantPrisma.incident.count({ where: this.queueWhere(user) }),
    };
  }

  async queue(user: AuthenticatedUser, predio?: string) {
    const [timezone, rows] = await Promise.all([
      this.companyTimezone(user),
      this.prisma.tenantPrisma.incident.findMany({
        where: this.queueWhere(user, predio),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: listSelect,
      }),
    ]);
    return { timezone, items: rows.map((row) => this.toItem(row)) };
  }

  async list(user: AuthenticatedUser, filters: IncidentListQuery) {
    const timezone = await this.companyTimezone(user);
    const dateRange = {
      ...(filters.desde ? { gte: localDateTimeToUtc(filters.desde, 0, timezone) } : {}),
      ...(filters.hasta ? { lt: localDateTimeToUtc(filters.hasta, 1440, timezone) } : {}),
    };
    const scope = this.activeAssignment(user);
    const and: Prisma.IncidentWhereInput[] = [];
    if (filters.desde || filters.hasta)
      and.push({
        OR: [{ trustedAt: dateRange }, { trustedAt: null, occurredAtDevice: dateRange }],
      });
    // Cada palabra tiene que aparecer en la descripción, el nombre o el apellido ("Pedro Díaz").
    for (const term of filters.q?.split(/\s+/).filter(Boolean) ?? [])
      and.push({
        OR: [
          { description: { contains: term, mode: 'insensitive' } },
          { guard: { firstName: { contains: term, mode: 'insensitive' } } },
          { guard: { lastName: { contains: term, mode: 'insensitive' } } },
        ],
      });
    const where: Prisma.IncidentWhereInput = {
      ...scope,
      ...(filters.predio ? { siteId: filters.predio } : {}),
      ...(filters.tipo ? { type: filters.tipo } : {}),
      ...(filters.clasificacion ? { classificationStatus: filters.clasificacion } : {}),
      ...(filters.gravedad ? { severity: filters.gravedad } : {}),
      ...(filters.seguimiento ? { followUpStatus: filters.seguimiento } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const incidents = this.prisma.tenantPrisma.incident;
    const [rows, total, pending, high, followUpOpen] = await Promise.all([
      incidents.findMany({
        where,
        orderBy: sortOrder(filters.orden),
        skip: (filters.pagina - 1) * filters.porPagina,
        take: filters.porPagina,
        select: listSelect,
      }),
      incidents.count({ where }),
      incidents.count({ where: this.queueWhere(user) }),
      incidents.count({ where: { ...scope, severity: 'high' } }),
      incidents.count({ where: { ...scope, followUpStatus: 'open' } }),
    ]);
    return {
      items: rows.map((row) => this.toItem(row)),
      total,
      page: filters.pagina,
      pageSize: filters.porPagina,
      timezone,
      counts: { pending, high, followUpOpen },
    };
  }

  async detail(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Incident', id);
    const incident = await this.prisma.tenantPrisma.incident.findFirst({
      where: { id, ...this.activeAssignment(user) },
      include: {
        site: { select: { id: true, name: true } },
        guard: { select: { firstName: true, lastName: true, status: true } },
        photos: { orderBy: { uploadedAt: 'asc' } },
        classifications: {
          orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
          include: { decidedBy: { select: { firstName: true, lastName: true } } },
        },
        followUpActions: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { author: { select: { firstName: true, lastName: true } } },
        },
        shift: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            rounds: { select: { round: { select: { name: true } } } },
          },
        },
      },
    });
    if (!incident) throw new NotFoundException('Incidente no encontrado');
    const occurredAt = incident.trustedAt ?? incident.occurredAtDevice;
    const at = (record: { trustedAt: Date | null; occurredAtDevice: Date }) =>
      record.trustedAt ?? record.occurredAtDevice;
    // Último punto válido antes del incidente, comparando la hora efectiva (confiable si la hay).
    const lastValid = (
      where: Prisma.CheckpointRecordWhereInput,
      orderBy: Prisma.CheckpointRecordOrderByWithRelationInput,
    ) =>
      this.prisma.tenantPrisma.checkpointRecord.findFirst({
        where: { shiftId: incident.shiftId, invalidatedAt: null, ...where },
        orderBy,
        select: {
          occurredAtDevice: true,
          trustedAt: true,
          checkpoint: { select: { name: true } },
        },
      });
    const [trustedRecord, deviceRecord, related, timezone] = await Promise.all([
      lastValid({ trustedAt: { lte: occurredAt } }, { trustedAt: 'desc' }),
      lastValid(
        { trustedAt: null, occurredAtDevice: { lte: occurredAt } },
        { occurredAtDevice: 'desc' },
      ),
      this.prisma.tenantPrisma.incident.findMany({
        where: {
          ...this.activeAssignment(user),
          siteId: incident.siteId,
          id: { not: incident.id },
          createdAt: { gte: new Date(this.clock.now().getTime() - RELATED_WINDOW_MS) },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, occurredAtDevice: true, trustedAt: true },
      }),
      this.companyTimezone(user),
    ]);
    const lastRecord =
      trustedRecord && deviceRecord
        ? at(trustedRecord) >= at(deviceRecord)
          ? trustedRecord
          : deviceRecord
        : (trustedRecord ?? deviceRecord);
    const timeline = [
      ...incident.classifications.map((decision) => ({
        kind: 'classification' as const,
        id: decision.id,
        at: decision.decidedAt,
        author: personName(decision.decidedBy),
        classification: decision.classification as 'client_visible' | 'internal',
        severity: decision.severity,
        requiresFollowUp: decision.requiresFollowUp,
        internalComment: decision.internalComment,
        clientNote: decision.clientNote,
        reason: decision.reason,
      })),
      ...incident.followUpActions.map((action) => ({
        kind: action.kind,
        id: action.id,
        at: action.createdAt,
        author: personName(action.author),
        text: action.text,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      id: incident.id,
      type: incident.type,
      description: incident.description,
      occurredAt,
      receivedAt: incident.receivedAt,
      classificationStatus: incident.classificationStatus,
      severity: incident.severity,
      followUpStatus: incident.followUpStatus,
      timezone,
      site: incident.site,
      guardName: personName(incident.guard),
      location:
        incident.latitude != null && incident.longitude != null
          ? {
              latitude: Number(incident.latitude),
              longitude: Number(incident.longitude),
              accuracyMeters: incident.accuracyMeters ? Number(incident.accuracyMeters) : null,
            }
          : null,
      photos: incident.photos.map((photo) => ({
        id: photo.id,
        thumbnailUrl: this.photos.signedUrl(photo.cloudinaryPublicId, 'thumbnail'),
        fullUrl: this.photos.signedUrl(photo.cloudinaryPublicId, 'full'),
      })),
      timeline,
      shiftContext: {
        shiftId: incident.shift.id,
        startsAt: incident.shift.startsAt,
        endsAt: incident.shift.endsAt,
        roundName: incident.shift.rounds.map((r) => r.round.name).join(', ') || null,
        lastCheckpoint: lastRecord
          ? { name: lastRecord.checkpoint.name, at: at(lastRecord) }
          : null,
      },
      relatedIncidents: related.map((row) => ({
        id: row.id,
        type: row.type,
        occurredAt: row.trustedAt ?? row.occurredAtDevice,
      })),
    };
  }

  private async ownedIncident(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Incident', id);
    const incident = await this.prisma.tenantPrisma.incident.findFirst({
      where: { id, ...this.activeAssignment(user) },
      select: { id: true, followUpStatus: true },
    });
    if (!incident) throw new NotFoundException('Incidente no encontrado');
    return incident;
  }

  async decide(id: string, user: AuthenticatedUser, input: Decision) {
    await this.ownedIncident(id, user);
    const decidedAt = this.clock.now();
    const followUpStatus = await this.prisma.systemPrisma.$transaction(async (tx) => {
      // Tenant ownership and active site assignment were checked above; this conditional update serializes concurrent decisions.
      const updated = await tx.incident.updateMany({
        where: {
          id,
          companyId: user.companyId,
          classificationStatus: input.reason ? { not: 'pending' } : 'pending',
        },
        data: { classificationStatus: input.classification, severity: input.severity },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          input.reason
            ? 'El incidente todavía no fue clasificado'
            : 'El incidente ya fue clasificado',
        );
      await tx.incidentClassification.create({
        data: {
          companyId: user.companyId,
          incidentId: id,
          classification: input.classification,
          severity: input.severity,
          requiresFollowUp: input.requiresFollowUp,
          internalComment: input.internalComment,
          clientNote:
            input.classification === 'client_visible'
              ? input.clientNote?.trim()
                ? input.clientNote
                : null
              : null,
          reason: input.reason,
          decidedById: user.userId,
          decidedAt,
        },
      });
      // Solo abre un seguimiento que no existía, condicionado en la misma transacción: no pisa un
      // cierre o una reapertura que llegue en paralelo.
      if (input.requiresFollowUp)
        await tx.incident.updateMany({
          where: { id, companyId: user.companyId, followUpStatus: 'none' },
          data: { followUpStatus: 'open' },
        });
      const current = await tx.incident.findUniqueOrThrow({
        where: { id },
        select: { followUpStatus: true },
      });
      return current.followUpStatus;
    });
    this.logger.log({
      event: 'incident.classified',
      incidentId: id,
      decidedById: user.userId,
      decidedAt,
    });
    return {
      classificationStatus: input.classification,
      severity: input.severity,
      followUpStatus,
      decidedAt,
    };
  }

  async followUp(id: string, user: AuthenticatedUser, kind: FollowUpKind, text: string) {
    await this.ownedIncident(id, user);
    const { from, to } = FOLLOW_UP_TRANSITIONS[kind];
    const at = this.clock.now();
    await this.prisma.systemPrisma.$transaction(async (tx) => {
      const updated = await tx.incident.updateMany({
        where: { id, companyId: user.companyId, followUpStatus: from },
        data: {
          followUpStatus: to,
          ...(kind === 'close' ? { followUpClosedAt: at } : {}),
          ...(kind === 'reopen' ? { followUpClosedAt: null } : {}),
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          from === 'open' ? 'El seguimiento no está abierto' : 'El seguimiento no está cerrado',
        );
      await tx.incidentFollowUpAction.create({
        data: {
          companyId: user.companyId,
          incidentId: id,
          kind,
          text,
          authorId: user.userId,
          createdAt: at,
        },
      });
    });
    this.logger.log({ event: `incident.follow_up.${kind}`, incidentId: id, authorId: user.userId });
    return { followUpStatus: to, at };
  }
}
