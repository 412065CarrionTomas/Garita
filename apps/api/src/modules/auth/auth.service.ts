import { Injectable } from '@nestjs/common';
import type { AuthMeResponse, UserRole } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';

const channels: Record<UserRole, ('web' | 'mobile')[]> = {
  guard: ['mobile'],
  client: ['web'],
  admin: ['web', 'mobile'],
  supervisor: ['web', 'mobile'],
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string): Promise<AuthMeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { company: { select: { id: true, name: true } } },
    });
    const status = user.status === 'invitation_pending' ? 'active' : user.status;
    if (status !== user.status)
      await this.prisma.user.update({ where: { id: user.id }, data: { status } });
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status,
      company: user.company,
      allowedChannels: channels[user.role],
    };
  }
}
