import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { PHOTO_STORAGE_PORT, type PhotoStoragePort } from './photo-storage.port';

interface Decision {
  classification: 'client_visible' | 'internal';
  internalComment: string;
  clientNote?: string;
  reason?: string;
}
interface Filters {
  predio?: string;
  desde?: string;
  hasta?: string;
  tipo?: Prisma.IncidentWhereInput['type'];
  clasificacion?: Prisma.IncidentWhereInput['classificationStatus'];
  pagina: number;
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

  private queueWhere(user: AuthenticatedUser, predio?: string): Prisma.IncidentWhereInput {
    return {
      classificationStatus: 'pending',
      ...(predio ? { siteId: predio } : {}),
      ...(user.role === 'admin'
        ? { site: { supervisors: { none: { user: { status: 'active' } } } } }
        : this.activeAssignment(user)),
    };
  }

  async queueCount(user: AuthenticatedUser) {
    return {
      count: await this.prisma.tenantPrisma.incident.count({ where: this.queueWhere(user) }),
    };
  }

  async queue(user: AuthenticatedUser, predio?: string) {
    const rows = await this.prisma.tenantPrisma.incident.findMany({
      where: this.queueWhere(user, predio),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        description: true,
        createdAt: true,
        site: { select: { id: true, name: true } },
        guard: { select: { firstName: true, lastName: true, status: true } },
      },
    });
    const overdueBefore = this.clock.now().getTime() - 24 * 60 * 60_000;
    return rows.map((row) => ({ ...row, overdue: row.createdAt.getTime() < overdueBefore }));
  }

  async list(user: AuthenticatedUser, filters: Filters) {
    const where: Prisma.IncidentWhereInput = {
      ...this.activeAssignment(user),
      ...(filters.predio ? { siteId: filters.predio } : {}),
      ...(filters.tipo ? { type: filters.tipo } : {}),
      ...(filters.clasificacion ? { classificationStatus: filters.clasificacion } : {}),
      ...(filters.desde || filters.hasta
        ? {
            createdAt: {
              ...(filters.desde ? { gte: new Date(`${filters.desde}T00:00:00.000Z`) } : {}),
              ...(filters.hasta
                ? { lt: new Date(Date.parse(`${filters.hasta}T00:00:00.000Z`) + 86_400_000) }
                : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.tenantPrisma.incident.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filters.pagina - 1) * 25,
        take: 25,
        select: {
          id: true,
          type: true,
          description: true,
          createdAt: true,
          classificationStatus: true,
          site: { select: { id: true, name: true } },
          guard: { select: { firstName: true, lastName: true, status: true } },
        },
      }),
      this.prisma.tenantPrisma.incident.count({ where }),
    ]);
    return { items, total, page: filters.pagina, pageSize: 25 };
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
      },
    });
    if (!incident) throw new NotFoundException('Incidente no encontrado');
    const { photos, guard, ...rest } = incident;
    return {
      ...rest,
      guard: {
        name: `${guard.firstName} ${guard.lastName}${guard.status === 'deactivated' ? ' (desactivado)' : ''}`,
      },
      photos: photos.map((photo) => ({
        id: photo.id,
        uploadedAt: photo.uploadedAt,
        thumbnailUrl: this.photos.signedUrl(photo.cloudinaryPublicId, 'thumbnail'),
        fullUrl: this.photos.signedUrl(photo.cloudinaryPublicId, 'full'),
      })),
    };
  }

  async decide(id: string, user: AuthenticatedUser, input: Decision) {
    await this.resources.findOwnedOrThrow('Incident', id);
    const incident = await this.prisma.tenantPrisma.incident.findFirst({
      where: { id, ...this.activeAssignment(user) },
      select: { id: true, companyId: true },
    });
    if (!incident) throw new NotFoundException('Incidente no encontrado');
    const decidedAt = this.clock.now();
    await this.prisma.systemPrisma.$transaction(async (tx) => {
      // Tenant ownership and active site assignment were checked above; this conditional update serializes concurrent decisions.
      const updated = await tx.incident.updateMany({
        where: {
          id,
          companyId: user.companyId,
          classificationStatus: input.reason ? { not: 'pending' } : 'pending',
        },
        data: { classificationStatus: input.classification },
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
          internalComment: input.internalComment,
          clientNote: input.classification === 'client_visible' ? input.clientNote : null,
          reason: input.reason,
          decidedById: user.userId,
          decidedAt,
        },
      });
    });
    this.logger.log({
      event: 'incident.classified',
      incidentId: id,
      decidedById: user.userId,
      decidedAt,
    });
    return { classificationStatus: input.classification, decidedAt };
  }
}
