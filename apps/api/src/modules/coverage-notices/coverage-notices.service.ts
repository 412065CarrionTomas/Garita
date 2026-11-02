import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  computeStartWindow,
  siteConnectivitySchema,
  SHIFT_NOT_STARTED_TOLERANCE_MINUTES,
  SHIFT_WITHOUT_GUARD_LEAD_MINUTES,
  SHIFT_START_MARGIN_MINUTES,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { NOTICES_PORT, type NoticesPort } from '../../common/ports/notices.port';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoverageNoticesService {
  private readonly logger = new Logger(CoverageNoticesService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTICES_PORT) private readonly notices: NoticesPort,
  ) {}

  isCompanySuspended(_companyId: string): Promise<boolean> {
    // TODO(HU-43): consultar la suspensión de la empresa cuando esté implementada.
    return Promise.resolve(false);
  }

  async sweep(): Promise<void> {
    const now = this.clock.now();
    // El job no tiene request: descubre predios y acota cada consulta por empresa y predio.
    this.logger.log({ event: 'coverage_notices.sweep_system_query' });
    const sites = await this.prisma.systemPrisma.site.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        companyId: true,
        connectivityType: true,
        minutesToSignal: true,
        marginMinutes: true,
      },
    });
    for (const site of sites) {
      if (await this.isCompanySuspended(site.companyId)) continue;
      const connectivity = siteConnectivitySchema.parse({
        type: site.connectivityType,
        minutesToSignal: site.minutesToSignal,
        marginMinutes: site.marginMinutes,
      });
      const shifts = await this.prisma.systemPrisma.shift.findMany({
        where: {
          companyId: site.companyId,
          siteId: site.id,
          status: { in: ['scheduled', 'unassigned'] },
          endsAt: { gt: now },
          startsAt: {
            lte: new Date(
              now.getTime() +
                (SHIFT_WITHOUT_GUARD_LEAD_MINUTES +
                  Math.max(
                    SHIFT_START_MARGIN_MINUTES,
                    connectivity.minutesToSignal + connectivity.marginMinutes,
                  )) *
                  60_000,
            ),
          },
        },
        include: {
          assignments: {
            where: { isCurrent: true, active: true },
            include: { guard: { select: { status: true } } },
            take: 1,
          },
        },
      });
      for (const shift of shifts) {
        const assignment = shift.assignments[0];
        const withoutGuard =
          shift.status === 'unassigned' || assignment?.guard?.status === 'invitation_pending';
        if (withoutGuard) {
          if (
            now.getTime() <
            computeStartWindow(shift.startsAt, connectivity).getTime() -
              SHIFT_WITHOUT_GUARD_LEAD_MINUTES * 60_000
          )
            continue;
          await this.notices.raise({
            companyId: site.companyId,
            siteId: site.id,
            shiftId: shift.id,
            kind: 'shift_without_guard',
            subjectId: shift.id,
          });
        } else if (
          assignment?.result === 'scheduled' &&
          assignment.guard?.status === 'active' &&
          now.getTime() >=
            assignment.startsAt.getTime() + SHIFT_NOT_STARTED_TOLERANCE_MINUTES * 60_000
        ) {
          await this.notices.raise({
            companyId: site.companyId,
            siteId: site.id,
            shiftId: shift.id,
            kind: 'shift_not_started',
            subjectId: assignment.id,
            details: { startsAt: assignment.startsAt.toISOString() },
          });
        }
      }
    }
  }

  async notifyEarlyClose(shiftId: string, guardId: string, _reason: string | null): Promise<void> {
    // Efecto posterior al commit, también invocado por sincronización: IDs y pertenencia provienen del turno.
    this.logger.log({ event: 'coverage_notices.early_close_system_lookup', shiftId });
    const shift = await this.prisma.systemPrisma.shift.findUnique({
      where: { id: shiftId },
      include: { site: { select: { company: { select: { timezone: true } } } } },
    });
    if (!shift?.closedEarly || shift.closeReason === 'baja del predio') return;
    const event = await this.prisma.systemPrisma.shiftEvent.findFirst({
      where: {
        companyId: shift.companyId,
        shiftId,
        type: shift.closedBy === 'admin' ? 'admin_close' : 'close',
        assignment: {
          guardId,
          result: 'closed_early',
          shift: { companyId: shift.companyId, siteId: shift.siteId },
        },
      },
      orderBy: { receivedAt: 'desc' },
    });
    if (!event || event.occurredAt >= shift.endsAt) return;
    const actor = event.actorUserId
      ? await this.prisma.systemPrisma.user.findFirst({
          where: { id: event.actorUserId, companyId: shift.companyId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const late = event.receivedAt.getTime() - event.occurredAt.getTime() > 60_000;
    const time = (value: Date) =>
      new Intl.DateTimeFormat('es-AR', {
        timeZone: shift.site.company.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(value);
    await this.notices.raise({
      companyId: shift.companyId,
      siteId: shift.siteId,
      shiftId,
      kind: 'shift_closed_early',
      subjectId: event.assignmentId,
      details: {
        reason: event.reason,
        closedBy: event.type === 'admin_close' ? 'admin' : 'guard',
        closedByUserId: event.actorUserId,
        closedByName: actor ? `${actor.firstName} ${actor.lastName}` : null,
        closedAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
        late,
      },
      ...(late
        ? {
            pushBody: `Cerrado a las ${time(event.occurredAt)}, recibido a las ${time(event.receivedAt)}`,
          }
        : {}),
    });
  }
}
