import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ClientUsersController, InvitationsController, UsersController } from './users.controller';
import { ResendInvitationMailer } from './email.service';
import { UsersService } from './users.service';
import { ShiftExecutionModule } from '../shift-execution/shift-execution.module';
import {
  NoopWeeklyScheduleDerivation,
  WEEKLY_SCHEDULE_DERIVATION_PORT,
} from './weekly-schedule-derivation.port';

@Module({
  imports: [PrismaModule, AuthModule, ShiftExecutionModule],
  controllers: [UsersController, InvitationsController, ClientUsersController],
  providers: [
    UsersService,
    ResendInvitationMailer,
    { provide: WEEKLY_SCHEDULE_DERIVATION_PORT, useClass: NoopWeeklyScheduleDerivation },
  ],
})
export class UsersModule {}
