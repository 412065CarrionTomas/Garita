import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ClientUsersController, InvitationsController, UsersController } from './users.controller';
import { ResendInvitationMailer } from './email.service';
import { UsersService } from './users.service';
import { ShiftExecutionModule } from '../shift-execution/shift-execution.module';
import { WEEKLY_SCHEDULE_DERIVATION_PORT } from './weekly-schedule-derivation.port';
import { ShiftSchedulesModule } from '../shift-schedules/shift-schedules.module';
import { ScheduleLifecycleService } from '../shift-schedules/schedule-lifecycle.service';

@Module({
  imports: [PrismaModule, AuthModule, ShiftExecutionModule, ShiftSchedulesModule],
  exports: [UsersService],
  controllers: [UsersController, InvitationsController, ClientUsersController],
  providers: [
    UsersService,
    ResendInvitationMailer,
    { provide: WEEKLY_SCHEDULE_DERIVATION_PORT, useExisting: ScheduleLifecycleService },
  ],
})
export class UsersModule {}
