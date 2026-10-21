import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { notificationPayloadSchema } from '@garita/shared';
import type { Job } from 'bullmq';
import type { MulticastMessage } from 'firebase-admin/messaging';
import { z } from 'zod';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { FcmMessaging } from './fcm-messaging';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';

const notificationJobSchema = z
  .object({
    companyId: z.string().min(1),
    userIds: z.array(z.string().min(1)),
    payload: notificationPayloadSchema,
  })
  .strict();
type NotificationJob = z.infer<typeof notificationJobSchema>;

const TITLES: Record<string, string> = {
  incident_new: 'Incidente nuevo',
  round_in_review: 'Ronda en revisión',
  shift_assigned: 'Turno asignado',
  shift_changed: 'Turno modificado',
  shift_reassigned_to_you: 'Turno reasignado',
  shift_removed: 'Turno eliminado',
  shift_cancelled: 'Turno cancelado',
  shift_closed_site_removed: 'Turno cerrado',
  round_missed: 'Ronda incumplida',
  shift_unsynced: 'Turno sin sincronizar',
  shift_not_started: 'Turno no iniciado',
  shift_closed_early: 'Turno cerrado antes de hora',
  shift_without_guard: 'Turno sin vigilador',
  panic: 'Pánico',
};

@Injectable()
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmMessaging,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const input = notificationJobSchema.parse(job.data);
    const payload = input.payload;
    // Queue workers have no request tenant context; scope every system query by company and active user IDs.
    const activeUsers = await this.prisma.systemPrisma.user.findMany({
      where: { id: { in: input.userIds }, companyId: input.companyId, status: 'active' },
      select: { id: true },
    });
    const devices = await this.prisma.systemPrisma.notificationDevice.findMany({
      where: { companyId: input.companyId, userId: { in: activeUsers.map(({ id }) => id) } },
    });
    for (let start = 0; start < devices.length; start += 500) {
      const batch = devices.slice(start, start + 500);
      const response = await this.fcm.sendEachForMulticast(
        this.message(
          batch.map(({ token }) => token),
          payload,
        ),
      );
      const invalid: string[] = [];
      const failures: string[] = [];
      response.responses.forEach((result, index) => {
        if (result.success) return;
        if (
          result.error?.code === 'messaging/registration-token-not-registered' ||
          result.error?.code === 'messaging/invalid-argument'
        ) {
          const token = batch[index]?.token;
          if (token) invalid.push(token);
        } else {
          failures.push(result.error?.code ?? 'unknown');
        }
      });
      if (invalid.length)
        await this.prisma.systemPrisma.notificationDevice.deleteMany({
          where: { token: { in: invalid } },
        });
      this.logger.log({
        event: 'notification_delivery',
        result: 'completed',
        sent: response.successCount,
        failed: response.failureCount,
        removedInvalid: invalid.length,
      });
      if (failures.length) throw new Error(`FCM transient delivery failure: ${failures.join(',')}`);
    }
  }

  private message(tokens: string[], payload: NotificationJob['payload']): MulticastMessage {
    const body = payload.siteName ?? '';
    const appUrl = this.config.get('WEB_APP_URL', { infer: true });
    const link = new URL(payload.link, appUrl);
    if (link.origin !== new URL(appUrl).origin || link.username || link.password)
      throw new Error('Notification link must stay on the panel origin');
    return {
      tokens,
      notification: { title: TITLES[payload.kind] ?? 'Aviso', ...(body ? { body } : {}) },
      data: {
        kind: payload.kind,
        link: link.toString(),
        ...(payload.siteName ? { siteName: payload.siteName } : {}),
        ...(payload.day ? { day: payload.day } : {}),
        ...(payload.time ? { time: payload.time } : {}),
      },
      webpush: { fcmOptions: { link: link.toString() } },
    };
  }
}
