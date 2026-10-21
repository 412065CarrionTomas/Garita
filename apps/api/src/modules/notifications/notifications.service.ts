import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { notificationPayloadSchema } from '@garita/shared';
import type { NotificationKind, NotificationPayload, RegisterDeviceRequest } from '@garita/shared';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_SEND_JOB, NOTIFICATIONS_QUEUE } from './notifications.constants';
import type { NotificationsPort } from '../../common/ports/notifications.port';

@Injectable()
export class NotificationsService implements NotificationsPort {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async register(input: RegisterDeviceRequest, user: AuthenticatedUser) {
    // Token uniqueness spans tenants, so this system-level upsert transfers ownership atomically.
    const device = await this.prisma.systemPrisma.notificationDevice.upsert({
      where: { token: input.token },
      create: { ...input, companyId: user.companyId, userId: user.userId },
      update: { ...input, companyId: user.companyId, userId: user.userId, lastSeenAt: new Date() },
    });
    this.logger.log({
      event: 'notification_device_registered',
      userId: user.userId,
      deviceId: device.id,
    });
    return this.present(device);
  }

  async list(user: AuthenticatedUser) {
    const devices = await this.prisma.tenantPrisma.notificationDevice.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return devices.map((device) => this.present(device));
  }

  async remove(id: string, user: AuthenticatedUser) {
    const result = await this.prisma.tenantPrisma.notificationDevice.deleteMany({
      where: { id, userId: user.userId },
    });
    if (!result.count) throw new NotFoundException('Dispositivo no encontrado');
    return { ok: true as const };
  }

  async notifySiteStaff(input: {
    companyId: string;
    siteId: string;
    kind: NotificationKind;
    payload: NotificationPayload;
    priority?: 'normal' | 'high';
  }): Promise<void> {
    // This port has no request context; recipients are resolved with explicit company and site constraints.
    const payload = notificationPayloadSchema.parse(input.payload);
    if (payload.kind !== input.kind) throw new Error('Notification kind must match its payload');
    const users = await this.prisma.systemPrisma.user.findMany({
      where: {
        companyId: input.companyId,
        status: 'active',
        OR: [
          { role: 'admin' },
          {
            role: 'supervisor',
            siteAssignments: {
              some: {
                siteId: input.siteId,
                site: { companyId: input.companyId, status: 'active' },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    this.logger.log({
      event: 'notification_enqueued',
      kind: input.kind,
      recipientCount: users.length,
    });
    await this.enqueue(
      input.companyId,
      users.map(({ id }) => id),
      payload,
      input.priority,
    );
  }

  async notifyUsers(input: {
    companyId: string;
    userIds: string[];
    kind: NotificationKind;
    payload: NotificationPayload;
    priority?: 'normal' | 'high';
  }): Promise<void> {
    // This port has no request context; recipients are resolved with explicit company and active status.
    const payload = notificationPayloadSchema.parse(input.payload);
    if (payload.kind !== input.kind) throw new Error('Notification kind must match its payload');
    const users = await this.prisma.systemPrisma.user.findMany({
      where: { companyId: input.companyId, id: { in: input.userIds }, status: 'active' },
      select: { id: true },
    });
    this.logger.log({
      event: 'notification_enqueued',
      kind: input.kind,
      recipientCount: users.length,
    });
    await this.enqueue(
      input.companyId,
      users.map(({ id }) => id),
      payload,
      input.priority,
    );
  }

  private async enqueue(
    companyId: string,
    userIds: string[],
    payload: NotificationPayload,
    priority: 'normal' | 'high' = 'normal',
  ) {
    if (!userIds.length) return;
    await this.queue.add(
      NOTIFICATION_SEND_JOB,
      { companyId, userIds, payload },
      { priority: priority === 'high' ? 1 : 10 },
    );
  }

  private present(device: {
    id: string;
    kind: 'web' | 'app';
    platform: 'android' | 'ios' | 'web';
    label: string | null;
    createdAt: Date;
    lastSeenAt: Date;
  }) {
    return {
      id: device.id,
      kind: device.kind,
      platform: device.platform,
      label: device.label,
      createdAt: device.createdAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
    };
  }
}
