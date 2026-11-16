import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePanicAlertRequest,
  UpdatePanicLocationRequest,
  PanicAlertStateResponse,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { PrismaService } from '../prisma/prisma.service';
import type { ShiftCredentialPayload } from '../sync/shift-credential.service';
import { completePanicSmsTwin } from './panic-sms-twin';
import { panicShortId } from '@garita/shared';

export interface SmsPanicOrigin {
  inboundId: string;
  shortId: string | null;
  unverified: boolean;
  phoneMismatch: boolean;
  receivedAt: Date;
}
import { PanicJobsService } from './panic-jobs.service';

@Injectable()
export class PanicService {
  private readonly logger = new Logger(PanicService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    private readonly jobs: PanicJobsService,
  ) {}

  async create(
    input: CreatePanicAlertRequest,
    credential: ShiftCredentialPayload,
    sms?: SmsPanicOrigin,
  ): Promise<PanicAlertStateResponse> {
    if (input.shiftId !== credential.shiftId)
      throw new ForbiddenException('Credencial de otro turno');
    const now = this.clock.now();
    // The credential creates the tenant context, but this system transaction must scope every lookup explicitly.
    const result = await this.prisma.systemPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${credential.shiftId}))::text`;
      if (sms) {
        const linked = await tx.smsInbound.findUniqueOrThrow({ where: { id: sms.inboundId } });
        if (linked.alertId) {
          const alert = await tx.panicAlert.findUniqueOrThrow({ where: { id: linked.alertId } });
          return { alert, changed: false };
        }
        const existing = sms.shortId
          ? await tx.panicAlert.findFirst({
              where: {
                shiftId: credential.shiftId,
                companyId: credential.companyId,
                OR: [
                  { shortId: sms.shortId },
                  {
                    id: {
                      gte: `${sms.shortId.toLowerCase()}-0000-0000-0000-000000000000`,
                      lte: `${sms.shortId.toLowerCase()}-ffff-ffff-ffff-ffffffffffff`,
                    },
                  },
                  {
                    events: {
                      some: { id: { startsWith: sms.shortId.toLowerCase() }, type: 'activation' },
                    },
                  },
                ],
              },
            })
          : null;
        if (existing) {
          if (sms.phoneMismatch && !existing.phoneMismatch)
            await tx.panicAlert.update({
              where: { id: existing.id },
              data: { phoneMismatch: true },
            });
          await tx.smsInbound.update({
            where: { id: sms.inboundId },
            data: { alertId: existing.id, processedAt: now },
          });
          return { alert: existing, changed: false };
        }
      }
      const duplicate = await tx.panicAlert.findUnique({ where: { id: input.alertId } });
      if (duplicate) {
        if (
          duplicate.companyId !== credential.companyId ||
          duplicate.shiftId !== credential.shiftId ||
          duplicate.assignmentId !== credential.assignmentId ||
          duplicate.guardId !== credential.userId
        )
          throw new NotFoundException('Alerta no encontrada');
        return { alert: duplicate, changed: false };
      }
      const repeatedActivation = await tx.panicAlertEvent.findUnique({
        where: { id: input.alertId },
        include: { alert: true },
      });
      if (repeatedActivation) {
        if (
          repeatedActivation.alert.companyId !== credential.companyId ||
          repeatedActivation.alert.shiftId !== credential.shiftId ||
          repeatedActivation.alert.assignmentId !== credential.assignmentId ||
          repeatedActivation.alert.guardId !== credential.userId
        )
          throw new NotFoundException('Alerta no encontrada');
        return { alert: repeatedActivation.alert, changed: false };
      }
      const shift = await tx.shift.findFirst({
        where: { id: credential.shiftId, companyId: credential.companyId },
        include: {
          site: { select: { name: true } },
          assignments: {
            where: {
              id: credential.assignmentId,
              guardId: credential.userId,
              isCurrent: true,
              active: true,
            },
            take: 1,
          },
        },
      });
      if (!shift?.assignments[0])
        throw new ForbiddenException('El turno no pertenece al vigilador');
      if (shift.status !== 'in_progress') throw new ConflictException('El turno no está en curso');
      const twin = sms ? null : await completePanicSmsTwin(tx, input, credential, now);
      if (twin) return { ...twin, siteName: shift.site.name };
      const active = await tx.panicAlert.findFirst({
        where: { companyId: credential.companyId, shiftId: shift.id, status: { not: 'resolved' } },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        if (sms) {
          await tx.smsInbound.update({
            where: { id: sms.inboundId },
            data: { alertId: active.id, processedAt: now },
          });
          return { alert: active, changed: false };
        }
        const alert = await tx.panicAlert.update({
          where: { id: active.id },
          data: {
            activationCount: { increment: 1 },
            events: {
              create: {
                id: input.alertId,
                type: 'activation',
                occurredAt: now,
                data: { deviceAlertId: input.alertId },
              },
            },
          },
        });
        return { alert, changed: true, siteName: shift.site.name };
      }
      const alert = await tx.panicAlert.create({
        data: {
          id: input.alertId,
          shortId: sms ? sms.shortId : panicShortId(input.alertId),
          channel: sms ? 'sms' : 'internet',
          unverified: sms?.unverified ?? false,
          phoneMismatch: sms?.phoneMismatch ?? false,
          companyId: credential.companyId,
          siteId: shift.siteId,
          shiftId: shift.id,
          assignmentId: credential.assignmentId,
          guardId: credential.userId,
          triggeredAt: input.clock?.trustedAt
            ? new Date(input.clock.trustedAt)
            : new Date(input.occurredAtDevice),
          receivedAt: sms?.receivedAt ?? now,
          locationStatus: input.location.status,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          timeStatus: input.clock?.timeStatus,
          events: {
            create: {
              id: input.alertId,
              type: 'created',
              occurredAt: now,
              data: { channel: sms ? 'sms' : 'internet' },
            },
          },
        },
      });
      if (sms)
        await tx.smsInbound.update({
          where: { id: sms.inboundId },
          data: { alertId: alert.id, processedAt: now },
        });
      return { alert, changed: true, siteName: shift.site.name };
    });
    if (result.changed) {
      const deliveries = await Promise.allSettled([
        this.notifications.notifySiteStaff({
          companyId: credential.companyId,
          siteId: result.alert.siteId,
          kind: 'panic',
          priority: 'high',
          payload: {
            kind: 'panic',
            siteName: result.siteName,
            body: 'Alerta de pánico',
            link: `/alertas-panico/${result.alert.id}`,
          },
        }),
        Promise.resolve().then(() => {
          this.realtime.emitToSite(
            credential.companyId,
            result.alert.siteId,
            'panico.actualizado',
            { alertId: result.alert.id, siteId: result.alert.siteId },
          );
        }),
      ]);
      if (deliveries.some((delivery) => delivery.status === 'rejected'))
        this.logger.warn({ event: 'panic.delivery_failed', alertId: result.alert.id });
      this.logger.log({ event: 'panic.activation', alertId: result.alert.id });
    }
    // Repeated HTTP delivery also repairs a queue outage after the transaction committed.
    await this.jobs.schedule(
      { companyId: credential.companyId, alertId: result.alert.id },
      result.alert.receivedAt,
    );
    return this.response(result.alert);
  }

  async updateLocation(
    alertId: string,
    input: UpdatePanicLocationRequest,
    credential: ShiftCredentialPayload,
  ): Promise<PanicAlertStateResponse> {
    const alert = await this.owned(alertId, credential);
    const next = input.location;
    if (
      next.status !== 'ok' ||
      next.latitude === null ||
      next.longitude === null ||
      next.accuracyMeters === null ||
      (alert.accuracyMeters !== null && Number(alert.accuracyMeters) <= next.accuracyMeters)
    )
      return this.response(alert);
    const now = this.clock.now();
    const updated = await this.prisma.tenantPrisma.panicAlert.update({
      where: { id: alertId },
      data: {
        locationStatus: next.status,
        latitude: next.latitude,
        longitude: next.longitude,
        accuracyMeters: next.accuracyMeters,
        events: { create: { type: 'location_updated', occurredAt: now } },
      },
    });
    this.realtime.emitToSite(credential.companyId, updated.siteId, 'panico.actualizado', {
      alertId: updated.id,
      siteId: updated.siteId,
    });
    this.logger.log({ event: 'panic.location_updated', alertId });
    return this.response(updated);
  }

  async repairSmsDelivery(alertId: string): Promise<void> {
    // System webhook retry repairs a committed SMS alert after a queue outage.
    this.logger.log({ event: 'panic.sms_retry', alertId });
    const alert = await this.prisma.systemPrisma.panicAlert.findUniqueOrThrow({
      where: { id: alertId },
    });
    await this.jobs.schedule({ companyId: alert.companyId, alertId: alert.id }, alert.receivedAt);
  }

  async state(
    alertId: string,
    credential: ShiftCredentialPayload,
  ): Promise<PanicAlertStateResponse> {
    return this.response(await this.owned(alertId, credential));
  }

  private async owned(alertId: string, credential: ShiftCredentialPayload) {
    const alert = await this.prisma.tenantPrisma.panicAlert.findFirst({
      where: {
        id: alertId,
        companyId: credential.companyId,
        shiftId: credential.shiftId,
        assignmentId: credential.assignmentId,
        guardId: credential.userId,
      },
    });
    if (!alert) throw new NotFoundException('Alerta no encontrada');
    return alert;
  }

  private response(alert: {
    id: string;
    status: 'active' | 'confirmed' | 'resolved';
    receivedAt: Date;
    confirmedAt: Date | null;
  }): PanicAlertStateResponse {
    return {
      alertId: alert.id,
      status: alert.status,
      receivedAt: alert.receivedAt.toISOString(),
      confirmedAt: alert.confirmedAt?.toISOString() ?? null,
    };
  }
}
