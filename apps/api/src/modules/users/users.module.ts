import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { InvitationsController, UsersController } from './users.controller';
import { ResendInvitationMailer } from './email.service';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController, InvitationsController],
  providers: [UsersService, ResendInvitationMailer],
})
export class UsersModule {}
