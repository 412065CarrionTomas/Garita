import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CLOCK, type Clock } from '../../common/clock';
import {
  IN_PROGRESS_SHIFT_CLOSURE_PORT,
  WEEKLY_SCHEDULE_TERMINATION_PORT,
} from './deactivation-ports';
import type {
  InProgressShiftClosurePort,
  WeeklyScheduleTerminationPort,
} from './deactivation-ports';
import { FIREBASE_IDENTITY_PROVIDER, type FirebaseIdentityProvider } from '../auth/auth.types';
import { ShiftExecutionService } from '../shift-execution/shift-execution.service';

/** Datos mínimos de un supervisor visibles en las respuestas de predios. */
const SUPERVISOR_FIELDS = { id: true, firstName: true, lastName: true, status: true } as const;

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WEEKLY_SCHEDULE_TERMINATION_PORT)
    private readonly weeklySchedules: WeeklyScheduleTerminationPort,
    @Inject(IN_PROGRESS_SHIFT_CLOSURE_PORT)
    private readonly inProgress: InProgressShiftClosurePort,
    private readonly shiftExecution: ShiftExecutionService,
    @Inject(FIREBASE_IDENTITY_PROVIDER) private readonly firebase: FirebaseIdentityProvider,
  ) {}

  async listClients(status?: 'active' | 'inactive', page = 1, user?: AuthenticatedUser) {
    return this.prisma.tenantPrisma.client.findMany({
      where: status ? { status } : undefined,
      orderBy: { name: 'asc' },
      skip: (page - 1) * 50,
      take: 50,
      include: {
        _count: {
          select: {
            sites:
              user?.role === 'supervisor'
                ? { where: { supervisors: { some: { userId: user.userId } } } }
                : true,
          },
        },
      },
    });
  }

  async createClient(data: Prisma.ClientUncheckedCreateInput) {
    try {
      return await this.prisma.tenantPrisma.client.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un cliente con ese nombre');
      throw error;
    }
  }

  async updateClient(id: string, data: Prisma.ClientUpdateInput) {
    await this.resources.findOwnedOrThrow('Client', id);
    try {
      return await this.prisma.tenantPrisma.client.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un cliente con ese nombre');
      throw error;
    }
  }

  async impactClientDeactivation(id: string) {
    await this.resources.findOwnedOrThrow('Client', id);
    const sites = await this.prisma.tenantPrisma.site.findMany({
      where: { clientId: id },
      select: { id: true },
    });
    const impact = await this.deactivationImpact(sites.map((site) => site.id));
    const usersToDeactivate = await this.prisma.tenantPrisma.user.count({
      where: { clientId: id, status: { not: 'deactivated' } },
    });
    return { ...impact, usersToDeactivate };
  }

  async deactivateClient(id: string, confirm: boolean, adminId: string) {
    const impact = await this.impactClientDeactivation(id);
    this.requireConfirmation(impact, confirm);
    const siteIds = (
      await this.prisma.tenantPrisma.site.findMany({
        where: { clientId: id },
        select: { id: true },
      })
    ).map((site) => site.id);
    const guardsToNotify = await this.guardsInProgress(siteIds);
    const { client, users } = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await this.cancelShifts(tx as unknown as Prisma.TransactionClient, siteIds, adminId);
      await this.weeklySchedules.terminateForSites(tx, siteIds);
      await this.inProgress.closeForSites(tx, siteIds, adminId);
      // La actualización del cliente bloquea altas concurrentes hasta terminar la cascada.
      await tx.client.update({ where: { id }, data: { status: 'inactive' } });
      const users = await tx.user.findMany({
        where: { clientId: id, status: { not: 'deactivated' } },
        select: { id: true, firebaseUid: true },
      });
      await tx.notificationDevice.deleteMany({ where: { user: { clientId: id } } });
      await tx.user.updateMany({ where: { clientId: id }, data: { status: 'deactivated' } });
      await tx.invitation.updateMany({
        where: { user: { clientId: id }, usedAt: null, replacedAt: null },
        data: { replacedAt: this.clock.now() },
      });
      // shortcut: auditoría en logs, reemplazar por tabla de auditoría en E6.
      for (const user of users)
        this.logger.log({
          event: 'client_user_deactivated',
          actorUserId: adminId,
          userId: user.id,
          clientId: id,
        });
      await tx.siteSupervisor.deleteMany({ where: { site: { clientId: id } } });
      await tx.site.updateMany({ where: { clientId: id }, data: { status: 'inactive' } });
      await this.removeSiteTags(tx as unknown as Prisma.TransactionClient, siteIds, adminId);
      return {
        client: await tx.client.update({ where: { id }, data: { status: 'inactive' } }),
        users,
      };
    });
    for (const user of users) {
      const results = await Promise.allSettled([
        this.firebase.setDisabled(user.firebaseUid, true),
        this.firebase.revokeRefreshTokens(user.firebaseUid),
      ]);
      results.forEach((result, index) => {
        if (result.status === 'rejected')
          this.logger.error({
            event: 'client_user_firebase_deactivation_failed',
            userId: user.id,
            clientId: id,
            operation: index === 0 ? 'disable' : 'revoke_sessions',
          });
      });
    }
    await this.notifyClosedGuards(guardsToNotify);
    return client;
  }

  async getClient(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Client', id);
    const client = await this.prisma.tenantPrisma.client.findFirst({
      where: { id },
      include: {
        sites: {
          where: {
            status: 'active',
            ...(user.role === 'supervisor'
              ? { supervisors: { some: { userId: user.userId } } }
              : {}),
          },
        },
      },
    });
    if (!client) throw new NotFoundException('Recurso no encontrado');
    return user.role === 'supervisor'
      ? { ...client, _count: { sites: client.sites.length } }
      : client;
  }

  async listSites(clientId?: string, status?: 'active' | 'inactive', user?: AuthenticatedUser) {
    const sites = await this.prisma.tenantPrisma.site.findMany({
      where: { ...(clientId ? { clientId } : {}), ...(status ? { status } : {}) },
      // shortcut: lista completa del cliente, agregar paginación al implementar el portal HU-28.
      take: user?.role === 'client' ? undefined : 200,
      orderBy: { name: 'asc' },
      include: {
        client: true,
        company: { select: { timezone: true } },
        supervisors: { include: { user: { select: SUPERVISOR_FIELDS } } },
      },
    });
    return sites.map((site) => ({
      ...site,
      hasActiveSupervisor: site.supervisors.some(({ user }) => user.status === 'active'),
    }));
  }

  async getSite(id: string) {
    await this.resources.findOwnedOrThrow('Site', id);
    const site = await this.prisma.tenantPrisma.site.findFirst({
      where: { id },
      include: {
        client: true,
        company: { select: { timezone: true } },
        supervisors: { include: { user: { select: SUPERVISOR_FIELDS } } },
      },
    });
    if (!site) throw new NotFoundException('Recurso no encontrado');
    return {
      ...site,
      hasActiveSupervisor: site.supervisors.some(({ user }) => user.status === 'active'),
    };
  }

  async createSite(data: Prisma.SiteUncheckedCreateInput) {
    await this.assertActiveClient(data.clientId);
    try {
      return await this.prisma.tenantPrisma.site.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un predio con ese nombre en el cliente');
      throw error;
    }
  }

  async updateSite(id: string, data: Prisma.SiteUncheckedUpdateInput) {
    const site = await this.resources.findOwnedOrThrow('Site', id);
    await this.assertActiveClient(
      typeof data.clientId === 'string' ? data.clientId : String(site.clientId),
    );
    try {
      return await this.prisma.tenantPrisma.site.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un predio con ese nombre en el cliente');
      throw error;
    }
  }

  async impactSiteDeactivation(id: string) {
    await this.resources.findOwnedOrThrow('Site', id);
    return this.deactivationImpact([id]);
  }

  async deactivateSite(id: string, confirm: boolean, adminId: string) {
    const impact = await this.impactSiteDeactivation(id);
    this.requireConfirmation(impact, confirm);
    const guardsToNotify = await this.guardsInProgress([id]);
    const site = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await this.cancelShifts(tx as unknown as Prisma.TransactionClient, [id], adminId);
      await this.weeklySchedules.terminateForSites(tx, [id]);
      await this.inProgress.closeForSites(tx, [id], adminId);
      await tx.siteSupervisor.deleteMany({ where: { siteId: id } });
      await this.removeSiteTags(tx as unknown as Prisma.TransactionClient, [id], adminId);
      return tx.site.update({ where: { id }, data: { status: 'inactive' } });
    });
    await this.notifyClosedGuards(guardsToNotify);
    return site;
  }

  private async guardsInProgress(siteIds: string[]) {
    return this.prisma.tenantPrisma.shift.findMany({
      where: { siteId: { in: siteIds }, status: 'in_progress' },
      select: {
        id: true,
        assignments: { where: { isCurrent: true }, select: { guardId: true }, take: 1 },
      },
    });
  }

  private async notifyClosedGuards(shifts: Awaited<ReturnType<SitesService['guardsInProgress']>>) {
    for (const shift of shifts)
      await this.shiftExecution.notifyGuardToLeaveAfterCommit(
        shift.id,
        shift.assignments[0]?.guardId ?? null,
      );
  }

  private async deactivationImpact(siteIds: string[]) {
    const shifts = siteIds.length
      ? await this.prisma.tenantPrisma.shift.findMany({
          where: {
            siteId: { in: siteIds },
            status: { in: ['scheduled', 'unassigned', 'uncovered'] },
          },
          select: { id: true, siteId: true, startsAt: true, endsAt: true, status: true },
          orderBy: { startsAt: 'asc' },
        })
      : [];
    const [weeklySchedulesToEnd, inProgressShiftsToClose] = await Promise.all([
      this.weeklySchedules.countForSite(siteIds),
      siteIds.length
        ? this.prisma.tenantPrisma.shift.count({
            where: {
              siteId: { in: siteIds },
              status: 'in_progress',
            },
          })
        : Promise.resolve(0),
    ]);
    return { shiftsToCancel: shifts.length, weeklySchedulesToEnd, inProgressShiftsToClose, shifts };
  }

  private requireConfirmation(
    impact: Awaited<ReturnType<SitesService['deactivationImpact']>> & {
      usersToDeactivate?: number;
    },
    confirm: boolean,
  ) {
    const affected =
      impact.shiftsToCancel +
      impact.weeklySchedulesToEnd +
      impact.inProgressShiftsToClose +
      (impact.usersToDeactivate ?? 0);
    if (affected > 0 && !confirm)
      throw new ConflictException({ code: 'DEACTIVATION_CONFIRMATION_REQUIRED', ...impact });
  }

  private async cancelShifts(
    transaction: Prisma.TransactionClient,
    siteIds: string[],
    adminId: string,
  ): Promise<void> {
    if (!siteIds.length) return;
    const shifts = await transaction.shift.findMany({
      where: {
        siteId: { in: siteIds },
        status: { in: ['scheduled', 'unassigned', 'uncovered'] },
      },
      select: { id: true },
    });
    const shiftIds = shifts.map(({ id }) => id);
    if (!shiftIds.length) return;
    await transaction.shiftAssignment.updateMany({
      where: { shiftId: { in: shiftIds }, active: true },
      data: { active: false },
    });
    await transaction.shift.updateMany({
      where: { id: { in: shiftIds } },
      data: {
        status: 'cancelled',
        cancelledAt: this.clock.now(),
        cancelledById: adminId,
        cancellationReason: 'Baja del predio',
      },
    });
  }

  private async assertActiveClient(id: string) {
    const client = await this.resources.findOwnedOrThrow('Client', id);
    if (client.status !== 'active') throw new ConflictException('El cliente está dado de baja');
  }

  private async removeSiteTags(tx: Prisma.TransactionClient, siteIds: string[], adminId: string) {
    await tx.nfcTag.updateMany({
      where: { checkpoint: { siteId: { in: siteIds } }, status: 'active' },
      data: { status: 'removed', endedAt: this.clock.now(), endedById: adminId },
    });
  }

  async assertSiteIsActive(siteId: string, user: AuthenticatedUser) {
    const site = await this.prisma.tenantPrisma.site.findFirst({
      where: { id: siteId, status: 'active' },
    });
    if (
      !site ||
      (user.role === 'supervisor' &&
        !(await this.prisma.tenantPrisma.siteSupervisor.findFirst({
          where: { siteId, userId: user.userId },
        })))
    )
      throw new NotFoundException('Recurso no encontrado');
    return site;
  }

  async getSupervisors(siteId: string) {
    await this.resources.findOwnedOrThrow('Site', siteId);
    return this.prisma.tenantPrisma.siteSupervisor.findMany({
      where: { siteId },
      include: { user: { select: SUPERVISOR_FIELDS } },
    });
  }

  async replaceSupervisors(siteId: string, userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    await this.resources.findOwnedOrThrow('Site', siteId);
    const site = await this.prisma.tenantPrisma.site.findFirst({
      where: { id: siteId, status: 'active' },
    });
    if (!site) throw new NotFoundException('Recurso no encontrado');
    const users = await this.prisma.tenantPrisma.user.findMany({
      where: {
        id: { in: uniqueUserIds },
        role: 'supervisor',
        status: { in: ['active', 'invitation_pending'] },
      },
      select: { id: true },
    });
    if (users.length !== uniqueUserIds.length)
      throw new NotFoundException('Supervisor no encontrado');
    return this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.siteSupervisor.deleteMany({ where: { siteId } });
      if (uniqueUserIds.length)
        await tx.siteSupervisor.createMany({
          data: uniqueUserIds.map((userId) => ({ companyId: site.companyId, siteId, userId })),
        });
      this.logger.log({
        siteId,
        supervisorIds: uniqueUserIds,
        reason: 'asignación de supervisores reemplazada',
      });
      return tx.siteSupervisor.findMany({ where: { siteId }, include: { user: true } });
    });
  }

  async activeSupervisors(siteId: string) {
    return this.prisma.tenantPrisma.siteSupervisor.findMany({
      where: { siteId, user: { status: 'active' } },
      include: { user: { select: SUPERVISOR_FIELDS } },
    });
  }

  async availableSupervisors() {
    return this.prisma.tenantPrisma.user.findMany({
      where: { role: 'supervisor', status: { in: ['active', 'invitation_pending'] } },
      select: { id: true, firstName: true, lastName: true, status: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findSitesLeftWithoutActiveSupervisor(supervisorId: string) {
    const records = await this.prisma.tenantPrisma.siteSupervisor.findMany({
      where: { userId: supervisorId },
      include: {
        site: { include: { supervisors: { include: { user: { select: SUPERVISOR_FIELDS } } } } },
      },
    });
    return records
      .filter(({ site }) => !site.supervisors.some(({ user }) => user.status === 'active'))
      .map(({ site }) => site);
  }

  async sitesForSupervisor(userId: string) {
    await this.resources.findOwnedOrThrow('User', userId);
    const sites = await this.prisma.tenantPrisma.site.findMany({
      where: { supervisors: { some: { userId } } },
      include: { supervisors: { include: { user: { select: SUPERVISOR_FIELDS } } } },
    });
    return sites.map((site) => ({
      ...site,
      hasOtherActiveSupervisor: site.supervisors.some(
        ({ user }) => user.id !== userId && user.status === 'active',
      ),
    }));
  }
}
