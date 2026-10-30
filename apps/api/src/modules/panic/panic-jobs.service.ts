import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PANIC_ESCALATION_SECONDS } from '@garita/shared';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { SMS_PORT, type SmsPort } from '../../common/ports/sms.port';
import { PrismaService } from '../prisma/prisma.service';
import { buildStaffPanicSms } from './panic-sms-message';

export const PANIC_SMS_QUEUE = 'panic-sms';
export const PANIC_ESCALATION_QUEUE = 'panic-escalation';
export const panicJobSchema = z
  .object({ companyId: z.string().min(1), alertId: z.uuid() })
  .strict();
export const panicSmsJobSchema = panicJobSchema.extend({
  reason: z.enum(['initial', 'escalation']),
});
type PanicJob = z.infer<typeof panicJobSchema>;
type SmsJob = z.infer<typeof panicSmsJobSchema>;
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

@Injectable()
export class PanicJobsService {
  private readonly logger = new Logger(PanicJobsService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    @Inject(SMS_PORT) private readonly sms: SmsPort,
    @InjectQueue(PANIC_SMS_QUEUE) private readonly smsQueue: Queue,
    @InjectQueue(PANIC_ESCALATION_QUEUE) private readonly escalationQueue: Queue,
  ) {}

  async schedule(input: PanicJob, receivedAt: Date) {
    await this.escalationQueue.add('escalate', input, {
      jobId: input.alertId,
      delay: Math.max(
        0,
        receivedAt.getTime() + PANIC_ESCALATION_SECONDS * 1000 - this.clock.now().getTime(),
      ),
    });
    await this.smsQueue.add(
      'send',
      { ...input, reason: 'initial' },
      { jobId: `${input.alertId}-initial` },
    );
  }

  async sendSms(input: SmsJob) {
    // Jobs have no tenant request; every system query is explicitly scoped to company and alert/site.
    const alert = await this.prisma.systemPrisma.panicAlert.findFirst({
      where: { id: input.alertId, companyId: input.companyId },
      include: { site: { select: { name: true } }, company: { select: { timezone: true } } },
    });
    if (!alert) return;
    const supervisors = await this.prisma.systemPrisma.user.findMany({
      where: {
        companyId: input.companyId,
        status: 'active',
        role: 'supervisor',
        siteAssignments: { some: { siteId: alert.siteId, site: { companyId: input.companyId } } },
      },
      select: { id: true, phone: true },
    });
    const admins =
      input.reason === 'escalation' ||
      !supervisors.some((user) => phoneSchema.safeParse(user.phone).success)
        ? await this.prisma.systemPrisma.user.findMany({
            where: { companyId: input.companyId, status: 'active', role: 'admin' },
            select: { id: true, phone: true },
          })
        : [];
    const recipients = [
      ...new Map([...supervisors, ...admins].map((user) => [user.id, user])).values(),
    ];
    const message = buildStaffPanicSms(alert.site.name, alert.triggeredAt, alert.company.timezone);
    let failed = false;
    for (const user of recipients) {
      const key = { alertId: alert.id, userId: user.id, reason: input.reason };
      const existing = await this.prisma.systemPrisma.panicSmsDelivery.findUnique({
        where: { alertId_userId_reason: key },
      });
      if (existing && existing.status !== 'failed') continue;
      let status: 'accepted' | 'failed' | 'skipped' = 'skipped';
      if (phoneSchema.safeParse(user.phone).success && user.phone) {
        try {
          status = (
            await this.sms.sendPanicAlert({
              phone: user.phone,
              companyId: input.companyId,
              alertId: alert.id,
              message,
            })
          ).sent
            ? 'accepted'
            : 'skipped';
        } catch {
          status = 'failed';
          failed = true;
          this.logger.error({ event: 'panic.sms_failed', alertId: alert.id, userId: user.id });
        }
      }
      await this.prisma.systemPrisma.$transaction(async (tx) => {
        await tx.panicSmsDelivery.upsert({
          where: { alertId_userId_reason: key },
          create: {
            ...key,
            companyId: input.companyId,
            phone: user.phone ?? '',
            status,
            createdAt: this.clock.now(),
          },
          update: { status },
        });
        await tx.panicAlertEvent.create({
          data: {
            alertId: alert.id,
            type: 'sms_sent',
            occurredAt: this.clock.now(),
            data: { userId: user.id, status, reason: input.reason },
          },
        });
      });
      this.logger.log({
        event: 'panic.sms_processed',
        alertId: alert.id,
        userId: user.id,
        status,
        reason: input.reason,
      });
    }
    if (failed) throw new Error('No se pudieron procesar todos los SMS de pánico');
  }

  async escalate(input: PanicJob) {
    // Background work explicitly scopes system access; no Firebase/shift credential context exists here.
    const alert = await this.prisma.systemPrisma.panicAlert.findFirst({
      where: { id: input.alertId, companyId: input.companyId },
      include: { site: { select: { name: true } } },
    });
    if (alert?.status !== 'active') return;
    const now = this.clock.now();
    if (now.getTime() < alert.receivedAt.getTime() + PANIC_ESCALATION_SECONDS * 1000) return;
    const eventId = `${alert.id}-escalation`;
    if (!alert.escalatedAt) {
      const changed = await this.prisma.systemPrisma.$transaction(async (tx) => {
        const result = await tx.panicAlert.updateMany({
          where: { id: alert.id, companyId: input.companyId, status: 'active', escalatedAt: null },
          data: { escalatedAt: now },
        });
        if (result.count)
          await tx.panicAlertEvent.create({
            data: {
              id: eventId,
              alertId: alert.id,
              type: 'escalated',
              occurredAt: now,
              data: { delivered: false },
            },
          });
        return result.count;
      });
      if (!changed) return;
      this.logger.log({
        event: 'panic.escalated',
        alertId: alert.id,
        delaySeconds: (now.getTime() - alert.receivedAt.getTime()) / 1000,
      });
    }
    const event = await this.prisma.systemPrisma.panicAlertEvent.findUnique({
      where: { id: eventId, alert: { companyId: input.companyId } },
    });
    if (!event || z.object({ delivered: z.boolean() }).parse(event.data).delivered) return;
    await this.smsQueue.add(
      'send',
      { ...input, reason: 'escalation' },
      { jobId: `${alert.id}-escalation` },
    );
    // TODO(HU-43): panic notifications for ongoing shifts must remain enabled under suspension.
    await this.notifications.notifySiteStaff({
      companyId: input.companyId,
      siteId: alert.siteId,
      kind: 'panic',
      priority: 'high',
      payload: {
        kind: 'panic',
        siteName: alert.site.name,
        body: 'Alerta de pánico',
        link: `/alertas-panico/${alert.id}`,
      },
    });
    this.realtime.emitToSite(input.companyId, alert.siteId, 'panico.actualizado', {
      alertId: alert.id,
      siteId: alert.siteId,
    });
    await this.prisma.systemPrisma.panicAlertEvent.update({
      where: { id: eventId },
      data: { data: { delivered: true } },
    });
  }
}
