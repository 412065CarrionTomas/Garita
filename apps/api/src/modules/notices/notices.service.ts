import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { noticeKey } from '@garita/shared';
import type { NoticesQuery } from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import { type NoticesPort, type RaiseNoticeInput } from '../../common/ports/notices.port';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';

@Injectable()
export class NoticesService implements NoticesPort {
  private readonly logger = new Logger(NoticesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {}

  async raise(input: RaiseNoticeInput): Promise<void> {
    const key = noticeKey(input.kind, input.subjectId);
    let notice;
    try {
      // System jobs have no request context. The caller supplies company and site from the shift.
      notice = await this.prisma.systemPrisma.notice.create({
        data: { ...input, key, details: input.details ?? Prisma.JsonNull },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    this.logger.log({
      event: 'notice.raised',
      noticeId: notice.id,
      kind: notice.kind,
      siteId: notice.siteId,
      shiftId: notice.shiftId,
    });
    this.realtime.emitToSite(input.companyId, input.siteId, 'aviso.nuevo', {
      kind: input.kind,
      siteId: input.siteId,
      shiftId: input.shiftId,
    });
    // TODO(HU-35): consult per-user preferences for MUTABLE_NOTICE_KINDS before push.
    const site = await this.prisma.systemPrisma.site.findUnique({
      where: { id: input.siteId },
      select: { name: true },
    });
    await this.notifications.notifySiteStaff({
      companyId: input.companyId,
      siteId: input.siteId,
      kind: input.kind,
      payload: { kind: input.kind, siteName: site?.name, link: `/avisos/${notice.id}` },
      priority: 'high',
    });
  }

  async resolve(input: Parameters<NoticesPort['resolve']>[0]): Promise<void> {
    const notice = await this.prisma.systemPrisma.notice.findUnique({
      where: { key: noticeKey(input.kind, input.subjectId) },
    });
    if (notice?.companyId !== input.companyId || notice.status !== 'open') return;
    const updated = await this.prisma.systemPrisma.notice.updateMany({
      where: { id: notice.id, companyId: input.companyId, status: 'open' },
      data: { status: 'resolved', resolution: input.resolution, resolvedAt: new Date() },
    });
    if (updated.count)
      this.realtime.emitToSite(input.companyId, notice.siteId, 'aviso.actualizado', {
        noticeId: notice.id,
        siteId: notice.siteId,
      });
  }

  async list(query: NoticesQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
    };
    const [items, openCount] = await Promise.all([
      this.prisma.tenantPrisma.notice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          site: { select: { name: true } },
          shift: { select: { startsAt: true, endsAt: true } },
        },
      }),
      this.prisma.tenantPrisma.notice.count({ where: { status: 'open' } }),
    ]);
    return { items, openCount };
  }

  async detail(id: string) {
    await this.resources.findOwnedOrThrow('Notice', id);
    const notice = await this.prisma.tenantPrisma.notice.findFirst({
      where: { id },
      include: {
        site: { select: { name: true } },
        shift: { select: { startsAt: true, endsAt: true } },
      },
    });
    if (!notice) throw new NotFoundException('Aviso no encontrado');
    return notice;
  }
}
