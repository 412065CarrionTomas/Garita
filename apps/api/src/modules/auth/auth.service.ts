import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AllowedChannel, AuthMeResponse, UserRole } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from './tenant-resource.service';

const channels: Record<UserRole, AllowedChannel[]> = {
  guard: ['mobile'],
  client: ['web'],
  admin: ['web', 'mobile'],
  supervisor: ['web', 'mobile'],
};

export function allowedChannelsForRole(role: UserRole): AllowedChannel[] {
  return [...channels[role]];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResources: TenantResourceService,
  ) {}

  async me(userId: string): Promise<AuthMeResponse> {
    const user = await this.prisma.tenantPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { company: { select: { id: true, name: true } } },
    });
    if (user.status === 'invitation_pending') {
      const validInvitation = await this.prisma.tenantPrisma.invitation.findFirst({
        where: { userId: user.id, usedAt: null, replacedAt: null },
        select: { id: true },
      });
      if (!validInvitation) throw new ForbiddenException('La invitación ya no está vigente');
    }
    const status = user.status === 'invitation_pending' ? 'active' : user.status;
    if (status !== user.status) {
      await this.prisma.tenantPrisma.user.update({ where: { id: user.id }, data: { status } });
      await this.prisma.tenantPrisma.invitation.updateMany({
        where: { userId: user.id, usedAt: null, replacedAt: null },
        data: { usedAt: new Date() },
      });
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status,
      company: user.company,
      allowedChannels: allowedChannelsForRole(user.role),
    };
  }
}
