import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
  ) {}

  async listClients(status?: 'active' | 'inactive', page = 1) {
    return this.prisma.tenantPrisma.client.findMany({
      where: status ? { status } : undefined,
      orderBy: { name: 'asc' },
      skip: (page - 1) * 50,
      take: 50,
      include: { _count: { select: { sites: true } } },
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

  async deactivateClient(id: string) {
    await this.resources.findOwnedOrThrow('Client', id);
    return this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.siteSupervisor.deleteMany({ where: { site: { clientId: id } } });
      await tx.site.updateMany({ where: { clientId: id }, data: { status: 'inactive' } });
      return tx.client.update({ where: { id }, data: { status: 'inactive' } });
    });
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
    return client;
  }

  async listSites(clientId?: string, status?: 'active' | 'inactive') {
    const sites = await this.prisma.tenantPrisma.site.findMany({
      where: { ...(clientId ? { clientId } : {}), ...(status ? { status } : {}) },
      take: 200,
      orderBy: { name: 'asc' },
      include: { client: true, supervisors: { include: { user: true } } },
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
      include: { client: true, supervisors: { include: { user: true } } },
    });
    if (!site) throw new NotFoundException('Recurso no encontrado');
    return {
      ...site,
      hasActiveSupervisor: site.supervisors.some(({ user }) => user.status === 'active'),
    };
  }

  async createSite(data: Prisma.SiteUncheckedCreateInput) {
    await this.resources.findOwnedOrThrow('Client', data.clientId);
    try {
      return await this.prisma.tenantPrisma.site.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un predio con ese nombre en el cliente');
      throw error;
    }
  }

  async updateSite(id: string, data: Prisma.SiteUncheckedUpdateInput) {
    await this.resources.findOwnedOrThrow('Site', id);
    if (typeof data.clientId === 'string')
      await this.resources.findOwnedOrThrow('Client', data.clientId);
    try {
      return await this.prisma.tenantPrisma.site.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un predio con ese nombre en el cliente');
      throw error;
    }
  }

  async deactivateSite(id: string) {
    await this.resources.findOwnedOrThrow('Site', id);
    return this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.siteSupervisor.deleteMany({ where: { siteId: id } });
      return tx.site.update({ where: { id }, data: { status: 'inactive' } });
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
      include: { user: true },
    });
  }

  async replaceSupervisors(siteId: string, userIds: string[]) {
    await this.resources.findOwnedOrThrow('Site', siteId);
    const site = await this.prisma.tenantPrisma.site.findFirst({
      where: { id: siteId, status: 'active' },
    });
    if (!site) throw new NotFoundException('Recurso no encontrado');
    const users = await this.prisma.tenantPrisma.user.findMany({
      where: {
        id: { in: userIds },
        role: 'supervisor',
        status: { in: ['active', 'invitation_pending'] },
      },
      select: { id: true },
    });
    if (users.length !== new Set(userIds).size)
      throw new NotFoundException('Supervisor no encontrado');
    return this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.siteSupervisor.deleteMany({ where: { siteId } });
      if (userIds.length)
        await tx.siteSupervisor.createMany({
          data: userIds.map((userId) => ({ companyId: site.companyId, siteId, userId })),
        });
      this.logger.log({
        siteId,
        supervisorIds: userIds,
        reason: 'asignación de supervisores reemplazada',
      });
      return tx.siteSupervisor.findMany({ where: { siteId }, include: { user: true } });
    });
  }

  async activeSupervisors(siteId: string) {
    return this.prisma.tenantPrisma.siteSupervisor.findMany({
      where: { siteId, user: { status: 'active' } },
      include: { user: true },
    });
  }

  async findSitesLeftWithoutActiveSupervisor(supervisorId: string) {
    const records = await this.prisma.tenantPrisma.siteSupervisor.findMany({
      where: { userId: supervisorId },
      include: { site: { include: { supervisors: { include: { user: true } } } } },
    });
    return records
      .filter(({ site }) => !site.supervisors.some(({ user }) => user.status === 'active'))
      .map(({ site }) => site);
  }

  async sitesForSupervisor(userId: string) {
    await this.resources.findOwnedOrThrow('User', userId);
    const sites = await this.prisma.tenantPrisma.site.findMany({
      where: { supervisors: { some: { userId } } },
      include: { supervisors: { include: { user: true } } },
    });
    return sites.map((site) => ({
      ...site,
      hasOtherActiveSupervisor: site.supervisors.some(
        ({ user }) => user.id !== userId && user.status === 'active',
      ),
    }));
  }
}
