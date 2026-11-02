import { Injectable } from '@nestjs/common';
import type { NotificationPreferences } from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}
  async get(user: AuthenticatedUser): Promise<NotificationPreferences> {
    const preference = await this.prisma.tenantPrisma.notificationPreference.findFirst({
      where: { userId: user.userId, kind: 'shift_not_started' },
    });
    return { shift_not_started: preference?.push ?? true };
  }
  async put(
    input: NotificationPreferences,
    user: AuthenticatedUser,
  ): Promise<NotificationPreferences> {
    await this.prisma.tenantPrisma.notificationPreference.upsert({
      where: { userId_kind: { userId: user.userId, kind: 'shift_not_started' } },
      create: {
        companyId: user.companyId,
        userId: user.userId,
        kind: 'shift_not_started',
        push: input.shift_not_started,
      },
      update: { push: input.shift_not_started },
    });
    return input;
  }
}
