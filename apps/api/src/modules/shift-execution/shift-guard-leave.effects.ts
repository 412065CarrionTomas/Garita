import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildShiftNotification } from '@garita/shared';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { SMS_PORT, type SmsPort } from '../../common/ports/sms.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { PrismaService } from '../prisma/prisma.service';
import { NoopShiftExecutionEffects } from './shift-execution-effects.port';

@Injectable()
export class ShiftGuardLeaveEffects extends NoopShiftExecutionEffects {
  private readonly logger = new Logger(ShiftGuardLeaveEffects.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(SMS_PORT) private readonly sms: SmsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
  ) {
    super();
  }

  override async offerCoverage(shiftId?: string): Promise<void> {
    if (!shiftId) return;
    const shift = await this.prisma.tenantPrisma.shift.findUnique({
      where: { id: shiftId },
      select: { companyId: true, siteId: true, status: true, closedEarly: true, closeReason: true },
    });
    if (shift?.status !== 'closed' || !shift.closedEarly || shift.closeReason === 'baja del predio')
      return;
    this.realtime.emitToSite(shift.companyId, shift.siteId, 'turno.actualizado', {
      shiftId,
      siteId: shift.siteId,
    });
  }

  override async notifyGuardToLeave(
    _transaction?: unknown,
    shiftId?: string,
    guardId?: string | null,
  ): Promise<void> {
    if (!shiftId || !guardId) return;
    const shift = await this.prisma.tenantPrisma.shift.findUnique({
      where: { id: shiftId },
      select: {
        companyId: true,
        startsAt: true,
        status: true,
        closeReason: true,
        site: { select: { company: { select: { timezone: true } } } },
      },
    });
    if (shift?.status !== 'closed' || shift.closeReason !== 'baja del predio') return;
    const notification = buildShiftNotification({
      kind: 'shift_closed_site_removed',
      shiftId,
      startsAt: shift.startsAt,
      timezone: shift.site.company.timezone,
    });
    try {
      await this.notifications.notifyUsers({
        companyId: shift.companyId,
        userIds: [guardId],
        kind: notification.kind,
        payload: notification.payload,
        priority: notification.priority,
      });
      this.logger.log({
        event: 'shift_notification_enqueued',
        shiftId,
        guardId,
        kind: notification.kind,
      });
    } catch (error) {
      this.logger.error({ event: 'shift_notification_failed', shiftId, guardId, error });
    }
    const guard = await this.prisma.tenantPrisma.user.findUnique({
      where: { id: guardId },
      select: { phone: true },
    });
    if (guard?.phone) {
      try {
        await this.sms.sendShiftClosed({
          phone: guard.phone,
          shiftId,
          guardId,
          message: 'Tu turno terminó por la baja del predio.',
        });
      } catch (error) {
        this.logger.error({ event: 'shift_sms_failed', shiftId, guardId, error });
      }
    }
  }
}
