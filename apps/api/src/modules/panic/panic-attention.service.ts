import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ResolvePanicAlertRequest, panicAlertsQuerySchema } from '@garita/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../common/clock';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';

const summaryInclude = {
  site: { select: { id: true, name: true } },
  guard: { select: { firstName: true, lastName: true, phone: true } },
} satisfies Prisma.PanicAlertInclude;
type Summary = Prisma.PanicAlertGetPayload<{ include: typeof summaryInclude }>;
const person = (user: { id: string; firstName: string; lastName: string } | null) =>
  user ? { id: user.id, name: `${user.firstName} ${user.lastName}` } : null;

@Injectable()
export class PanicAttentionService {
  private readonly logger = new Logger(PanicAttentionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {}

  async list(filters: z.infer<typeof panicAlertsQuerySchema>) {
    const where: Prisma.PanicAlertWhereInput = {
      ...(filters.estado ? { status: filters.estado } : {}),
      ...(filters.predio ? { siteId: filters.predio } : {}),
    };
    const [items, total, activeCount] = await Promise.all([
      this.prisma.tenantPrisma.panicAlert.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (filters.pagina - 1) * 25,
        take: 25,
      }),
      this.prisma.tenantPrisma.panicAlert.count({ where }),
      this.prisma.tenantPrisma.panicAlert.count({ where: { status: 'active' } }),
    ]);
    return {
      items: items.map((row) => this.summary(row)),
      total,
      activeCount,
      page: filters.pagina,
      pageSize: 25,
    };
  }

  async detail(id: string) {
    await this.resources.findOwnedOrThrow('PanicAlert', id);
    const row = await this.prisma.tenantPrisma.panicAlert.findUnique({
      where: { id },
      include: {
        ...summaryInclude,
        company: { select: { timezone: true } },
        confirmedBy: { select: { id: true, firstName: true, lastName: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        smsDeliveries: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, userId: true, reason: true, status: true, createdAt: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Alerta no encontrada');
    return {
      ...this.summary(row),
      timezone: row.company.timezone,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      accuracyMeters: row.accuracyMeters === null ? null : Number(row.accuracyMeters),
      confirmedBy: person(row.confirmedBy),
      resolvedBy: person(row.resolvedBy),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      outcome: row.outcome,
      resolutionComment: row.resolutionComment,
      smsDeliveries: row.smsDeliveries.map((delivery) => ({
        ...delivery,
        createdAt: delivery.createdAt.toISOString(),
      })),
    };
  }

  async confirm(id: string, user: AuthenticatedUser) {
    return this.transition(id, user);
  }

  async resolve(id: string, user: AuthenticatedUser, input: ResolvePanicAlertRequest) {
    return this.transition(id, user, input);
  }

  private async transition(
    id: string,
    user: AuthenticatedUser,
    resolution?: ResolvePanicAlertRequest,
  ) {
    await this.resources.findOwnedOrThrow('PanicAlert', id);
    const now = this.clock.now();
    const type = resolution ? 'resolved' : 'confirmed';
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const result = await tx.panicAlert.updateMany({
        where: { id, status: resolution ? 'confirmed' : 'active' },
        data: resolution
          ? {
              status: 'resolved',
              resolvedAt: now,
              resolvedById: user.userId,
              outcome: resolution.outcome,
              resolutionComment: resolution.comment,
            }
          : { status: 'confirmed', confirmedAt: now, confirmedById: user.userId },
      });
      if (!result.count)
        throw new ConflictException(
          resolution
            ? 'Primero confirmá la alerta; solo se puede resolver una alerta confirmada'
            : 'La alerta ya fue confirmada o resuelta',
        );
      await tx.panicAlertEvent.create({
        data: { alertId: id, type, occurredAt: now, data: { userId: user.userId } },
      });
    });
    const alert = await this.detail(id);
    this.realtime.emitToSite(user.companyId, alert.site.id, 'panico.actualizado', {
      alertId: id,
      siteId: alert.site.id,
    });
    this.logger.log({ event: `panic.${type}`, alertId: id, userId: user.userId, occurredAt: now });
    return alert;
  }

  private summary(row: Summary) {
    return {
      id: row.id,
      status: row.status,
      channel: row.channel,
      authenticated: !row.unverified,
      phoneMismatch: row.phoneMismatch,
      triggeredAt: row.triggeredAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      escalatedAt: row.escalatedAt?.toISOString() ?? null,
      site: row.site,
      guard: { name: `${row.guard.firstName} ${row.guard.lastName}`, phone: row.guard.phone },
    };
  }
}
